import { create } from 'zustand'
import { translate } from '../../i18n/index.js'
import { createId } from '../../utils/id.js'
import { showToast } from '../../components/base/toastState.js'
import { ApiError, streamMessage } from '../api/client.js'
import {
  blobToDataUrl,
  recognizeWithOpenAIVision,
  streamOpenAIMessage,
  streamResponsesMessage,
} from '../api/openai.js'
import { getApiOrigin } from '../api/origin.js'
import type { ChatModel, CreateMessageRequest } from '../api/types.js'
import { extractFileIds, getFileErrorCode, isImageRejectedError, isRetryableApiError } from '../api/errors.js'
import { cancelUpload, describeUploadError, uploadAttachment, useUploads } from '../attachments.js'
import { normalizeImageIfNeeded, markImageRejected } from '../imageNormalize.js'
import { allowsVision, matchesRefusalKeyword, useSettings } from '../settings.js'
import { toggleReadAloud } from '../speech/readAloud.js'
import { recordTurnTokenUsage } from '../tokenUsage.js'
import { appendBranch, getVisibleMessages, normalizeSession, selectVersion } from './branches.js'
import { buildLocalTitle } from './title.js'
import * as db from './db.js'
import {
  clearAllDrafts,
  clearDraft,
  clearSentDraft,
  getDraft,
  prepareDraftMessage,
} from './drafts.js'
import { createLatestReminder } from './latestReminder.js'
import { buildCrossChatMemory } from './memory.js'
import {
  buildSummaryPrompt,
  estimateHistoryTokens,
  formatCompactionContext,
  planCompaction,
  SUMMARY_MAX_CHARS,
  SUMMARY_SYSTEM_PROMPT,
} from './compaction.js'
import { extractMemoriesFromTurn, formatSavedMemories } from './savedMemory.js'
import {
  applyEvent,
  canContinueReply,
  getContextRounds,
  getReplyText,
  settleReply,
  toRequestMessages,
} from './reply.js'
import {
  toSessionSummary,
  type AssistantMessage,
  type FileAttachment,
  type Message,
  type Session,
  type SessionSummary,
  type UserMessage,
} from './types.js'

/** deepseek-flash 同时支持深度思考与图片输入 */
const MODEL: ChatModel = 'deepseek-flash'
/** 保留最近打开的详情；当前会话、生成中及尚未成功保存的会话不淘汰。 */
const SESSION_CACHE_LIMIT = 5
/** 安全审核级别 */
const SAFETY_CHECK = { level: 'high' } as const
/** 服务端判定 file_id 失效后，重新补传并重发的最多次数（不含首次请求） */
const FILE_RETRY_LIMIT = 2
/** 退避基数，第 n 次重试等待 2^n 倍；连续失败达到上限就放弃，把原始报错展示出来 */
const FILE_RETRY_BASE_DELAY = 1000

/** 根据配置组装服务端工具声明：read_url 与 web_search 各自独立开关。 */
const serverTools = (search: boolean, readUrl: boolean): CreateMessageRequest['tools'] => {
  const tools: NonNullable<CreateMessageRequest['tools']> = []
  if (readUrl) {
    tools.push({ type: 'deepseek_read_url', name: 'deepseek_read_url' })
  }
  if (search) {
    tools.push({ type: 'deepseek_web_search', name: 'deepseek_web_search' })
  }
  return tools
}

/** 允许自动补标题的请求；手动重命名后取消本轮标题写入，包含主动清空标题的情况。 */
const titleRequests = new Set<AbortController>()

type ChatState = {
  ready: boolean
  initError: boolean
  /** 历史导入或全部删除期间锁定交互，提交成功前仍展示原有记录。 */
  importingHistory: boolean
  /** 仅列表元数据，按 updatedAt 降序；流式消息更新不会改变此数组。 */
  sessions: SessionSummary[]
  sessionCache: Record<string, Session>
  sessionLoadErrors: Record<string, boolean>
  sessionSaveErrors: Record<string, boolean>
  /** null 表示新对话（欢迎页） */
  activeId: string | null
  /** 正在生成回复的会话 */
  streaming: Record<string, AbortController>
  /** 正在压缩上下文的会话：发送前把长历史总结成摘要，等待时间可能明显长于普通请求 */
  compacting: Record<string, boolean>
}

export const useChatStore = create<ChatState>(() => ({
  ready: false,
  initError: false,
  importingHistory: false,
  sessions: [],
  sessionCache: {},
  sessionLoadErrors: {},
  sessionSaveErrors: {},
  activeId: null,
  streaming: {},
  compacting: {},
}))

const { getState: get, setState: set } = useChatStore

/** 置顶的永远在前，其余按最近更新排序 */
const sortSessions = (sessions: SessionSummary[]) =>
  [...sessions].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) {
      return a.pinned ? -1 : 1
    }
    return b.updatedAt - a.updatedAt
  })

const getSession = (id: string) => {
  const cache = get().sessionCache
  return Object.hasOwn(cache, id) ? cache[id] : undefined
}

const getStreamController = (id: string) => {
  const streams = get().streaming
  return Object.hasOwn(streams, id) ? streams[id] : undefined
}

const sameSummary = (a: SessionSummary, b: SessionSummary) =>
  a.title === b.title &&
  a.createdAt === b.createdAt &&
  a.updatedAt === b.updatedAt &&
  Boolean(a.pinned) === Boolean(b.pinned) &&
  Boolean(a.archived) === Boolean(b.archived) &&
  (a.archivedAt ?? 0) === (b.archivedAt ?? 0)

const sessionAccess = new Map<string, number>()
const unsavedSessions = new Set<string>()
/** 保存失败时保留原件，重试成功后才释放。 */
const pendingFiles = new Map<string, db.StoredFile[]>()
const deletingSessions = new Set<string>()
const deletionTasks = new Set<Promise<boolean>>()
const streamFlushes = new Map<string, () => void>()
let accessSequence = 0
let historyEpoch = 0
let initTask: Promise<void> | undefined
const sessionLoads = new Map<string, { promise: Promise<void> }>()

const touchSession = (id: string) => sessionAccess.set(id, ++accessSequence)

const trimSessionCache = () => {
  const state = get()
  const ids = Object.keys(state.sessionCache)
  if (ids.length <= SESSION_CACHE_LIMIT) {
    return
  }
  const removable = ids
    .filter(
      (id) =>
        id !== state.activeId &&
        !Object.hasOwn(state.streaming, id) &&
        !unsavedSessions.has(id) &&
        !deletingSessions.has(id)
    )
    .sort((a, b) => (sessionAccess.get(a) ?? 0) - (sessionAccess.get(b) ?? 0))
  const evicted = new Set(removable.slice(0, ids.length - SESSION_CACHE_LIMIT))
  for (const id of evicted) {
    sessionAccess.delete(id)
  }
  if (evicted.size > 0) {
    set({
      sessionCache: Object.fromEntries(
        Object.entries(state.sessionCache).filter(([id]) => !evicted.has(id))
      ),
    })
  }
}

const updateSession = (id: string, update: (session: Session) => Session) =>
  set((state) => {
    const previous = Object.hasOwn(state.sessionCache, id) ? state.sessionCache[id] : undefined
    if (!previous) {
      return state
    }
    const session = update(previous)
    if (session === previous) {
      return state
    }
    return {
      sessionCache: { ...state.sessionCache, [id]: session },
      sessions: sameSummary(previous, session)
        ? state.sessions
        : sortSessions(
            state.sessions.map((summary) =>
              summary.id === id ? toSessionSummary(session) : summary
            )
          ),
    }
  })

const updateReply = (sessionId: string, reply: AssistantMessage) =>
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.id === reply.id
        ? { ...reply, parentId: message.parentId, selectedChildId: message.selectedChildId }
        : message
    ),
  }))

const persist = (sessionId: string) => {
  const session = getSession(sessionId)
  if (session) {
    unsavedSessions.add(sessionId)
    if (deletingSessions.has(sessionId)) {
      return
    }
    const epoch = historyEpoch
    const files = pendingFiles.get(sessionId)
    void db
      .saveSession(session, files)
      .then(() => {
        if (epoch !== historyEpoch || !getSession(sessionId)) {
          return
        }
        if (pendingFiles.get(sessionId) === files) {
          pendingFiles.delete(sessionId)
        }
        if (getSession(sessionId) === session) {
          unsavedSessions.delete(sessionId)
          set((state) => ({
            sessionSaveErrors: Object.fromEntries(
              Object.entries(state.sessionSaveErrors).filter(([id]) => id !== sessionId)
            ),
          }))
          trimSessionCache()
        }
      })
      .catch((error: unknown) => {
        db.reportStorageError('save session')(error)
        if (epoch === historyEpoch && getSession(sessionId)) {
          set((state) => ({
            sessionSaveErrors: { ...state.sessionSaveErrors, [sessionId]: true },
          }))
        }
      })
  }
}

export const retrySaveSessions = () => {
  if (!get().importingHistory) {
    unsavedSessions.forEach(persist)
  }
}

/** 离开前先合并尚未绘制的增量；隐藏期间浏览器可能暂停动画帧。 */
export const bindChatPersistence = () => {
  const save = () => {
    if (get().importingHistory) {
      return
    }
    for (const [id, flush] of streamFlushes) {
      flush()
      persist(id)
    }
    for (const id of unsavedSessions) {
      if (!streamFlushes.has(id)) {
        persist(id)
      }
    }
  }
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      save()
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', save)
  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', save)
  }
}

/** 按当前开关创建回复：深度思考对应 thinking，智能搜索控制 deepseek_web_search。 */
const createReply = (): AssistantMessage => {
  const { thinking, search, model } = useSettings.getState()
  return {
    id: createId(),
    role: 'assistant',
    createdAt: Date.now(),
    model: model.trim() || MODEL,
    thinking,
    search,
    prefix: true,
    status: 'pending',
    blocks: [],
  }
}

/** 命中本地拒答关键词时直接生成拒答消息，不发起 API 请求。 */
const createRefusedReply = (): AssistantMessage => {
  const { refusalMessage, model } = useSettings.getState()
  const text = refusalMessage.trim() || translate('replyRefused')
  return {
    id: createId(),
    role: 'assistant',
    createdAt: Date.now(),
    model: model.trim() || MODEL,
    thinking: false,
    search: false,
    prefix: false,
    status: 'done',
    stopReason: 'refusal',
    blocks: [{ type: 'text', text, isTemplate: true }],
  }
}

/** 仍在生成中的回复（页面关闭或导出时未结束）按「已停止」处理 */
const settleInterrupted = (session: Session): Session => {
  if (
    !session.messages.some(
      (m) => m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming')
    )
  ) {
    return session
  }
  const { keepRefusedContent } = useSettings.getState()
  return {
    ...session,
    messages: session.messages.map((m) =>
      m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming')
        ? settleReply(m, 'stopped', session.updatedAt, undefined, keepRefusedContent)
        : m
    ),
  }
}

export const initChat = (): Promise<void> => {
  if (get().ready) {
    return Promise.resolve()
  }
  if (initTask) {
    return initTask
  }
  const epoch = historyEpoch
  set({ initError: false })
  initTask = (async () => {
    try {
      const summaries = await db.loadSessionSummaries()
      if (epoch === historyEpoch) {
        set({ ready: true, sessions: sortSessions(summaries) })
      }
    } catch (error) {
      if (epoch === historyEpoch) {
        set({ initError: true })
        db.reportStorageError('read local sessions')(error)
      }
    } finally {
      if (epoch === historyEpoch) {
        initTask = undefined
      }
    }
  })()
  return initTask
}

/** 同一会话合并并发读取；切换只改变 activeId，旧请求不会把界面切回去。 */
export const ensureSessionLoaded = (id: string): Promise<void> => {
  if (getSession(id)) {
    return Promise.resolve()
  }
  const pending = sessionLoads.get(id)
  if (pending) {
    return pending.promise
  }
  const epoch = historyEpoch
  set((state) => ({ sessionLoadErrors: { ...state.sessionLoadErrors, [id]: false } }))
  const load = { promise: Promise.resolve() }
  sessionLoads.set(id, load)
  load.promise = (async () => {
    try {
      const stored = await db.loadSession(id)
      if (epoch !== historyEpoch || sessionLoads.get(id) !== load) {
        return
      }
      const summary = get().sessions.find((session) => session.id === id)
      if (!summary) {
        return
      }
      if (!stored) {
        throw new Error(`Session ${id} is missing from local storage`)
      }
      const settled = settleInterrupted(normalizeSession(stored))
      // 读取期间可能已在列表重命名，保留最新元数据，不能让旧读取覆盖它。
      const session = sameSummary(settled, summary) ? settled : { ...settled, ...summary }
      // 老会话可能没有标题：载入时用首条提问补一个，避免列表里堆满「新对话」
      if (!session.title.trim()) {
        const firstUser = session.messages.find((message) => message.role === 'user')
        if (firstUser) {
          session.title = buildLocalTitle(firstUser)
        }
      }
      touchSession(id)
      set((state) => ({ sessionCache: { ...state.sessionCache, [id]: session } }))
      if (session !== stored) {
        persist(id)
      }
      trimSessionCache()
    } catch (error) {
      if (epoch === historyEpoch && sessionLoads.get(id) === load) {
        set((state) => ({ sessionLoadErrors: { ...state.sessionLoadErrors, [id]: true } }))
        db.reportStorageError('read session')(error)
      }
    } finally {
      if (sessionLoads.get(id) === load) {
        sessionLoads.delete(id)
      }
    }
  })()
  return load.promise
}

/** 等所有回复的收尾（落盘）完成 */
const waitForIdle = (sessionId?: string) =>
  new Promise<void>((resolve) => {
    const isIdle = (state: ChatState) =>
      sessionId === undefined
        ? Object.keys(state.streaming).length === 0
        : !Object.hasOwn(state.streaming, sessionId)
    if (isIdle(get())) {
      resolve()
      return
    }
    const unsubscribe = useChatStore.subscribe((state) => {
      if (isIdle(state)) {
        unsubscribe()
        resolve()
      }
    })
  })

/**
 * 替换历史对话：先写入暂存，成功后原子替换旧记录；写入为空即删除全部会话与附件。
 * 期间停止生成并禁止修改会话；失败时清除暂存，保留原有记录。
 */
export const replaceHistory = async (write: () => Promise<void>): Promise<number> => {
  if (get().importingHistory) {
    throw new Error('History replacement is already in progress')
  }
  set({ importingHistory: true })
  try {
    for (const controller of Object.values(get().streaming)) {
      controller.abort()
    }
    // 已开始的单条删除先同步到内存，避免本次替换失败后列表残留已被删除的记录。
    await Promise.all(deletionTasks)
    historyEpoch += 1
    initTask = undefined
    sessionLoads.clear()
    await waitForIdle()
    await db.clearStaging()
    let summaries: SessionSummary[]
    try {
      await write()
      summaries = await db.commitStaging()
    } catch (error) {
      await db.clearStaging().catch(db.reportStorageError('clear unfinished history replacement'))
      throw error
    }
    sessionAccess.clear()
    unsavedSessions.clear()
    pendingFiles.clear()
    clearAllDrafts()
    set({
      ready: true,
      initError: false,
      sessions: sortSessions(summaries),
      sessionCache: {},
      sessionLoadErrors: {},
      sessionSaveErrors: {},
      activeId: null,
    })
    return summaries.length
  } finally {
    set({ importingHistory: false })
    retrySaveSessions()
    const { activeId, ready } = get()
    // 替换失败时恢复被取消的详情读取，原有记录继续可用。
    if (activeId !== null) {
      void ensureSessionLoaded(activeId)
    } else if (!ready) {
      void initChat()
    }
  }
}

export const newChat = () => {
  if (!get().importingHistory) {
    set({ activeId: null })
    trimSessionCache()
  }
}

export const selectSession = (id: string) => {
  if (!get().importingHistory && get().sessions.some((session) => session.id === id)) {
    touchSession(id)
    set({ activeId: id })
    void ensureSessionLoaded(id)
    trimSessionCache()
  }
}

/** 切换置顶；只改会话元数据，不触发消息重排 */
export const setSessionPinned = (id: string, pinned: boolean) => {
  set((state) => {
    const session = Object.hasOwn(state.sessionCache, id) ? state.sessionCache[id] : undefined
    return {
      ...(session
        ? { sessionCache: { ...state.sessionCache, [id]: { ...session, pinned } } }
        : {}),
      sessions: sortSessions(
        state.sessions.map((summary) => (summary.id === id ? { ...summary, pinned } : summary))
      ),
    }
  })
  const session = getSession(id)
  if (session) {
    persist(id)
  } else {
    void db.updateSessionMeta(id, { pinned })
  }
}

/**
 * 归档 / 取消归档。
 * 归档只是打标记：会话仍留在本地存储里，随时可以从归档页拉回对话历史。
 * 归档时顺带取消置顶，避免恢复后跑到列表最前面。
 */
export const setSessionArchived = (id: string, archived: boolean) => {
  const archivedAt = archived ? Date.now() : 0
  // archivedAt 用 0 清掉而不是留旧值：恢复后再归档要拿到新的归档时间，
  // 否则归档页会按上一次的旧时间排序。
  const patch = {
    archived,
    archivedAt,
    ...(archived ? { pinned: false } : {}),
  }
  set((state) => {
    const session = Object.hasOwn(state.sessionCache, id) ? state.sessionCache[id] : undefined
    return {
      ...(session ? { sessionCache: { ...state.sessionCache, [id]: { ...session, ...patch } } } : {}),
      sessions: sortSessions(
        state.sessions.map((summary) => (summary.id === id ? { ...summary, ...patch } : summary))
      ),
      // 归档的是当前打开的会话：退回欢迎页，不然会停在归档里的对话上
      ...(archived && state.activeId === id ? { activeId: null } : {}),
    }
  })
  const session = getSession(id)
  if (session) {
    persist(id)
  } else {
    void db
      .updateSessionMeta(id, patch)
      .catch(db.reportStorageError('archive session'))
  }
}

export const renameSession = (id: string, title: string) => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return
  }
  const controller = getStreamController(id)
  if (controller) {
    titleRequests.delete(controller)
  }
  if (getSession(id)) {
    updateSession(id, (session) => ({ ...session, title }))
    persist(id)
  } else {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, title } : session
      ),
    }))
    void db.renameSession(id, title).catch(db.reportStorageError('rename session'))
  }
}

/**
 * 删除会话；本地原件仅在没有其他会话引用时清理。远端文件不删：导入、编辑、重新生成都会复用同一个附件，
 * 同一服务端文件可能被多个会话引用，不维护引用计数。
 */
export const removeSession = (id: string): Promise<boolean> => {
  const task = removeSessionData(id).finally(() => deletionTasks.delete(task))
  deletionTasks.add(task)
  return task
}

const removeSessionData = async (id: string): Promise<boolean> => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return false
  }
  const epoch = historyEpoch
  deletingSessions.add(id)
  try {
    getStreamController(id)?.abort()
    // 等本会话的流收尾，避免删除之后又被收尾保存写回来。
    await waitForIdle(id)
    if (epoch !== historyEpoch) {
      return false
    }
    await db.deleteSession(id)
    if (epoch !== historyEpoch) {
      return true
    }
    sessionLoads.delete(id)
    sessionAccess.delete(id)
    unsavedSessions.delete(id)
    pendingFiles.delete(id)
    clearDraft(id)
    set((state) => ({
      sessions: state.sessions.filter((session) => session.id !== id),
      sessionCache: Object.fromEntries(
        Object.entries(state.sessionCache).filter(([key]) => key !== id)
      ),
      sessionLoadErrors: Object.fromEntries(
        Object.entries(state.sessionLoadErrors).filter(([key]) => key !== id)
      ),
      sessionSaveErrors: Object.fromEntries(
        Object.entries(state.sessionSaveErrors).filter(([key]) => key !== id)
      ),
      activeId: state.activeId === id ? null : state.activeId,
    }))
    return true
  } catch (error) {
    db.reportStorageError('delete session')(error)
    return false
  } finally {
    deletingSessions.delete(id)
    // 删除失败时保留会话，并保存停止生成后的最新状态。
    if (getSession(id)) {
      if (get().importingHistory) {
        unsavedSessions.add(id)
      } else {
        persist(id)
      }
    }
  }
}

export const stopReply = (sessionId: string) => getStreamController(sessionId)?.abort()

type SubmittedPromptFile = {
  id: string
  serverId: string | null
  name: string
  size: number
  isImage: boolean
  mimeType: string
  blob?: Blob
}

const submitPrompt = (
  targetSessionId: string | null,
  text: string,
  files: SubmittedPromptFile[],
): { sessionId: string; replyId: string } | null => {
  const now = Date.now()
  let sessionId = targetSessionId
  if (
    sessionId !== null &&
    (deletingSessions.has(sessionId) || getStreamController(sessionId) || !getSession(sessionId))
  ) {
    return null
  }
  if (sessionId === null) {
    const session: Session = {
      id: createId(),
      title: '',
      createdAt: now,
      updatedAt: now,
      messages: [],
      rootMessageId: null,
    }
    sessionId = session.id
    touchSession(session.id)
    set((state) => ({
      sessions: [toSessionSummary(session), ...state.sessions],
      sessionCache: { ...state.sessionCache, [session.id]: session },
      activeId: session.id,
    }))
  }
  const current = getSession(sessionId)
  if (!current) {
    return null
  }
  const history = getVisibleMessages(current)
  const question: UserMessage = {
    id: createId(),
    role: 'user',
    content: text,
    files: files.map(({ id, serverId, name, size, isImage, mimeType }) => ({
      id,
      serverId,
      name,
      size,
      isImage,
      mimeType,
    })),
    createdAt: now,
  }
  const localRefused = matchesRefusalKeyword(question.content)
  const reply = localRefused ? createRefusedReply() : createReply()
  // 先落一个本地标题：OpenAI 兼容 / 第三方中转不会下发服务端标题，没有兜底列表就全是一片「新对话」
  const localTitle = buildLocalTitle(question)
  updateSession(sessionId, (session) => {
    const next = appendBranch(session, history.at(-1)?.id ?? null, [question, reply])
    return {
      ...next,
      updatedAt: now,
      title: next.title.trim() ? next.title : localTitle,
    }
  })
  const blobs = files.flatMap(({ id, blob }) => (blob ? [{ id, blob }] : []))
  if (blobs.length > 0) {
    pendingFiles.set(sessionId, [...(pendingFiles.get(sessionId) ?? []), ...blobs])
  }
  persist(sessionId)
  if (!localRefused) {
    void streamReply(sessionId, reply, { history, question })
  }
  return { sessionId, replyId: reply.id }
}

/**
 * 提交指定会话的最新草稿；null 表示新建会话。
 * 同步接收成功才清空草稿，附件原件由会话接管；保存失败仍通过保存入口重试。
 */
/**
 * 把界面的四档思考程度翻译成各协议真正认识的字段。
 * - off  : 关闭思考（thinking.type = disabled / reasoning.effort = none）
 * - low  : 轻度
 * - high : 深度（服务端默认值）
 * - max  : 最高
 *
 * 三种协议写法不同，之前只给 DeepSeek 原生协议发了 output_config，
 * OpenAI 兼容与 Responses 路径完全没带，所以那两种接口下切换档位毫无效果。
 */
const EFFORT_MAP = {
  off: 'none',
  low: 'low',
  high: 'high',
  max: 'max',
} as const

const buildReasoningPayload = (
  effort: 'off' | 'low' | 'high' | 'max',
  protocol: 'deepseek' | 'openai' | 'responses' | 'local'
): Pick<CreateMessageRequest, 'output_config' | 'reasoning_effort' | 'reasoning' | 'enable_thinking'> => {
  const mapped = EFFORT_MAP[effort]
  if (protocol === 'responses') {
    // Responses API：reasoning.effort，none 即关闭
    return { reasoning: { effort: mapped } }
  }
  if (protocol === 'openai' || protocol === 'local') {
    // OpenAI 兼容网关写法不一：OpenAI 官方认 reasoning_effort；
    // DeepSeek V3.2 等国产网关认 enable_thinking（布尔）。
    // 两个都带上，各自取自己认识的字段；关闭时 enable_thinking=false，
    // reasoning_effort 给 minimal（OpenAI o 系列的最小档）。
    return {
      ...(effort === 'off'
        ? {}
        : { reasoning_effort: mapped === 'none' ? 'minimal' : mapped }),
      enable_thinking: effort !== 'off',
    }
  }
  // DeepSeek 原生（Anthropic 格式）：off 返回空对象——thinking.type=disabled 已关闭思考；
  // 非 off 时发 output_config.effort 控制强度
  return effort === 'off' ? {} : { output_config: { effort: mapped === 'none' ? 'low' : mapped } }
}

export const sendMessage = (targetSessionId: string | null) => {
  if (get().importingHistory || !get().ready) {
    return false
  }
  const prepared = prepareDraftMessage(getDraft(targetSessionId), useUploads.getState().tasks)
  if (!prepared) {
    return false
  }
  const submitted = submitPrompt(targetSessionId, prepared.text, prepared.files)
  if (!submitted) {
    return false
  }
  clearSentDraft(targetSessionId)
  return true
}

/** 重新生成当前路径上的回答：在原问题下新增版本，不覆盖旧回答和后续对话。 */
export const regenerateReply = (sessionId: string, messageId?: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const index =
    messageId === undefined ? path.length - 1 : path.findIndex((m) => m.id === messageId)
  const question = path[index - 1]
  if (question?.role !== 'user' || path[index]?.role !== 'assistant') {
    return
  }
  const history = path.slice(0, index - 1)
  const localRefused = matchesRefusalKeyword(question.content)
  const reply = localRefused ? createRefusedReply() : createReply()
  updateSession(sessionId, (s) => ({
    ...appendBranch(s, question.id, [reply]),
    updatedAt: Date.now(),
  }))
  persist(sessionId)
  if (!localRefused) {
    void streamReply(sessionId, reply, { history, question })
  }
}

/** 编辑提问后新增同父版本，保留原文件；旧问题的所有回答与后续对话仍可切回。 */
export const editMessage = (sessionId: string, messageId: string, content: string): boolean => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return false
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return false
  }
  const path = getVisibleMessages(session)
  const index = path.findIndex((message) => message.id === messageId)
  const previous = path[index]
  const text = content.trim()
  if (previous?.role !== 'user' || (!text && previous.files.length === 0)) {
    return false
  }
  const question: UserMessage = {
    id: createId(),
    role: 'user',
    content: text,
    files: previous.files,
    createdAt: Date.now(),
  }
  const localRefused = matchesRefusalKeyword(question.content)
  const reply = localRefused ? createRefusedReply() : createReply()
  updateSession(sessionId, (s) => ({
    ...appendBranch(s, path[index - 1]?.id ?? null, [question, reply]),
    updatedAt: Date.now(),
  }))
  persist(sessionId)
  if (!localRefused) {
    void streamReply(sessionId, reply, { history: path.slice(0, index), question })
  }
  return true
}

/** 编辑助手回复并形成新的同父分支版本；旧回答与后续分支仍可切回。 */
export const editAssistantMessage = (
  sessionId: string,
  messageId: string,
  content: string
): boolean => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return false
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return false
  }
  const path = getVisibleMessages(session)
  const index = path.findIndex((message) => message.id === messageId)
  const previous = path[index]
  const text = content.trim()
  if (previous?.role !== 'assistant' || !text) {
    return false
  }
  const edited: AssistantMessage = {
    id: createId(),
    role: 'assistant',
    createdAt: Date.now(),
    model: previous.model,
    thinking: previous.thinking,
    search: previous.search,
    latestReminder: previous.latestReminder,
    prefix: true,
    status: 'done',
    stopReason: 'end_turn',
    blocks: [{ type: 'text', text }],
  }
  updateSession(sessionId, (s) => ({
    ...appendBranch(s, path[index - 1]?.id ?? null, [edited]),
    updatedAt: Date.now(),
  }))
  persist(sessionId)
  return true
}

export const selectMessageVersion = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  if (getStreamController(sessionId)) {
    return
  }
  updateSession(sessionId, (session) => selectVersion(session, messageId))
  persist(sessionId)
}

/** 继续最后一条未完成的回答：保留原消息与开关，仅将新流的内容追加到原块之后。 */
export const continueReply = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const question = path.at(-2)
  const previous = path.at(-1)
  const { thinking, search, model, allowRefusedContext } = useSettings.getState()
  if (
    question?.role !== 'user' ||
    previous?.role !== 'assistant' ||
    previous.id !== messageId ||
    !canContinueReply(previous, allowRefusedContext)
  ) {
    return
  }
  const reply: AssistantMessage = {
    ...previous,
    // 未记录请求配置的回复，续写时使用默认模型和当前开关。
    model: previous.model ?? (model.trim() || MODEL),
    thinking: previous.thinking ?? thinking,
    search: previous.search ?? search,
    status: 'pending',
    stopReason: undefined,
    stopDetails: undefined,
    error: undefined,
  }
  updateReply(sessionId, reply)
  updateSession(sessionId, (s) => ({ ...s, updatedAt: Date.now() }))
  persist(sessionId)
  void streamReply(sessionId, reply, { history: path.slice(0, -2), question, prefix: previous })
}

/** 附件补传失败后重试：保留原回答位置，重新补传并请求 */
export const retryUpload = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const index = path.findIndex((message) => message.id === messageId)
  const question = path[index - 1]
  const previous = path[index]
  if (
    question?.role !== 'user' ||
    previous?.role !== 'assistant' ||
    previous.error?.kind !== 'upload'
  ) {
    return
  }
  const reply: AssistantMessage = { ...previous, status: 'pending', error: undefined }
  updateReply(sessionId, reply)
  persist(sessionId)
  void streamReply(sessionId, reply, { history: path.slice(0, index - 1), question })
}

type Request = {
  history: Message[]
  question: UserMessage
  prefix?: AssistantMessage
}

/** 把补传得到的 serverId 写回会话里所有引用同一附件的消息（编辑、重新生成会共用附件） */
const saveServerIds = (sessionId: string, serverIds: Map<string, string>) => {
  if (serverIds.size === 0) {
    return
  }
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.role === 'user' && message.files.some((file) => serverIds.has(file.id))
        ? {
            ...message,
            files: message.files.map((file) =>
              serverIds.has(file.id) ? { ...file, serverId: serverIds.get(file.id) ?? null } : file
            ),
          }
        : message
    ),
  }))
  persist(sessionId)
}

/**
 * 附件的服务端 id：已有直接用；正在上传的等待同一任务；否则读取本地原件补传。
 * 本地也没有原件（导入的文档附件只有元数据）时返回 null，该附件只展示、不进入请求。
 */
const ensureServerId = async (apiKey: string, file: FileAttachment): Promise<string | null> => {
  if (file.serverId) {
    return file.serverId
  }
  const task = useUploads.getState().tasks[file.id]
  if (task?.status === 'done') {
    return task.serverId
  }
  const blob = await db.loadFile(file.id)
  if (!blob) {
    return null
  }
  return uploadAttachment(apiKey, file.id, blob, file.name, file.isImage)
}

/** 用会话里的最新消息替换请求快照：重传前会重置附件的 serverId，快照必须跟着更新 */
const refreshRequest = (sessionId: string, request: Request): Request => {
  const session = getSession(sessionId)
  if (!session) {
    return request
  }
  const byId = new Map(session.messages.map((message) => [message.id, message]))
  const pick = <T extends Message>(message: T): T =>
    (byId.get(message.id) as T | undefined) ?? message
  return {
    history: request.history.map(pick),
    question: pick(request.question),
    prefix: request.prefix,
  }
}

/**
 * 发送前补齐附件的 serverId。
 * - 本轮提问的附件并行补齐，任一失败则整体失败，已成功的照常写回，重试时复用成功结果；
 * - 历史轮次（仅进入上下文的）中没有 serverId 的附件，多为导入的图片：从最新的消息往前逐张补传，
 *   失败静默跳过，该附件不进入本次请求，下次发送时再试。
 */
const prepareFiles = async (sessionId: string, request: Request, signal: AbortSignal) => {
  const epoch = historyEpoch
  // 服务端判定 file_id 失效时会清掉会话里的 serverId，先用最新消息替换请求快照，
  // 否则快照里仍是旧 id，补传会直接复用它。
  request = refreshRequest(sessionId, request)
  const apiKey = useSettings.getState().apiKey ?? ''
  const serverIds = new Map<string, string>()
  // 停止生成立即生效；上传本身不取消（输入框与其他消息可能共用同一任务），完成后照常写回 serverId
  const aborted = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  const uploads = Promise.allSettled(
    request.question.files.map(async (file) => {
      const serverId = await ensureServerId(apiKey, file)
      if (serverId) {
        serverIds.set(file.id, serverId)
      }
    })
  )
  void uploads.then(() => {
    if (epoch === historyEpoch) {
      saveServerIds(sessionId, serverIds)
    }
  })
  const results = await Promise.race([uploads, aborted])
  const failed = results.find((result) => result.status === 'rejected')
  if (failed) {
    throw failed.reason
  }

  const { allowRefusedContext } = useSettings.getState()
  const pending = new Map<string, FileAttachment>()
  for (const [user] of getContextRounds(request.history, allowRefusedContext).toReversed()) {
    for (const file of user.files) {
      if (!file.serverId && !serverIds.has(file.id) && !pending.has(file.id)) {
        pending.set(file.id, file)
      }
    }
  }
  for (const file of pending.values()) {
    signal.throwIfAborted()
    try {
      const serverId = await Promise.race([ensureServerId(apiKey, file), aborted])
      if (serverId) {
        serverIds.set(file.id, serverId)
        saveServerIds(sessionId, new Map([[file.id, serverId]]))
      }
    } catch {
      signal.throwIfAborted()
    }
  }

  // 用补齐后的会话重新取历史与提问，保证请求里都是 serverId
  const session = getSession(sessionId)
  const resolve = <T extends Message>(message: T): T =>
    (session?.messages.find((m) => m.id === message.id) as T | undefined) ?? message
  return {
    history: request.history.map(resolve),
    question: resolve(request.question),
    prefix: request.prefix,
  }
}

/** 本次请求实际会用到的服务端 file_id */
const collectServerFileIds = (request: Request): Set<string> => {
  const ids = new Set<string>()
  const add = (files: FileAttachment[]) => {
    for (const file of files) {
      if (file.serverId) {
        ids.add(file.serverId)
      }
    }
  }
  add(request.question.files)
  const { allowRefusedContext } = useSettings.getState()
  for (const [user] of getContextRounds(request.history, allowRefusedContext)) {
    add(user.files)
  }
  return ids
}

/**
 * 服务端判定 file_id 失效或图片内容被拒（超限/格式不支持）时，清掉对应附件的 serverId
 * 并丢弃旧的上传任务，下一次补齐会重新读取本地原件上传——图片路径现在会先归一化再传。
 * 报错里点名了 file_id 就只重置这些，没点名（如 invalid file_id / 图片超限）则重置本次请求用到的全部附件。
 */
const reuploadInvalidatedFiles = (sessionId: string, request: Request, error: unknown): boolean => {
  if (!(error instanceof ApiError)) {
    return false
  }
  const imageRejected = isImageRejectedError(error)
  if (!imageRejected && !getFileErrorCode(error)) {
    return false
  }
  const mentioned = imageRejected ? [] : extractFileIds(error.message)
  // 重试时原始快照里还是上一轮已被清掉的 serverId，先换成会话里的最新消息；
  // 图片被拒（超限/格式）时重置本次请求用到的全部图片附件，归一化后补传。
  const targets =
    mentioned.length > 0
      ? new Set(mentioned)
      : collectServerFileIds(refreshRequest(sessionId, request))
  const session = getSession(sessionId)
  if (targets.size === 0 || !session) {
    return false
  }
  const localIds: string[] = []
  const messages = session.messages.map((message) => {
    if (message.role !== 'user') {
      return message
    }
    let changed = false
    const files = message.files.map((file) => {
      if (!file.serverId || !targets.has(file.serverId)) {
        return file
      }
      localIds.push(file.id)
      changed = true
      return { ...file, serverId: null }
    })
    return changed ? { ...message, files } : message
  })
  if (localIds.length === 0) {
    return false
  }
  // 图片被服务端拒过（超限/格式）：标记后下次发送强制归一化，不再按头部判定直传
  if (imageRejected) {
    localIds.forEach(markImageRejected)
  }
  updateSession(sessionId, (current) => ({ ...current, messages }))
  // 上传任务里可能还留着同一个失效的 serverId，清掉后 ensureServerId 才会重新上传
  localIds.forEach(cancelUpload)
  persist(sessionId)
  return true
}

/** 重传前的退避等待；停止生成时立即返回，由调用方按已停止收尾 */
const waitForRetry = (attempt: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    function onAbort() {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(
      () => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      },
      FILE_RETRY_BASE_DELAY * 2 ** attempt
    )
    signal.addEventListener('abort', onAbort, { once: true })
  })

const TEXT_MIME_RE =
  /^text\/|application\/(json|xml|javascript|typescript|x-yaml|yaml|csv|markdown)/i
const TEXT_EXT_RE =
  /\.(txt|md|markdown|json|csv|tsv|yaml|yml|xml|html|htm|css|js|jsx|ts|tsx|py|go|rs|java|c|cpp|h|hpp|sh|sql|log|ini|toml|env)$/i

const findLocalBlob = async (sessionId: string, fileId: string): Promise<Blob | undefined> => {
  const pending = pendingFiles.get(sessionId)?.find((item) => item.id === fileId)?.blob
  return pending ?? (await db.loadFile(fileId))
}

/**
 * 读取并预处理本轮及历史附件（供 OpenAI 兼容或自定义图片识别/文字识别渠道使用）：
 * - 自定义图片识别渠道：用外部视觉模型把图片转为文字描述并附加到提问；
 * - 自定义文字识别渠道 / OpenAI 内联：把纯文本文件或图片数据转为请求内联块。
 */
const prepareInlineAttachments = async (
  sessionId: string,
  request: Request,
  signal: AbortSignal
): Promise<{
  question: UserMessage
  inlineImages: Map<string, string>
  inlineTexts: Map<string, string>
}> => {
  const settings = useSettings.getState()
  const inlineImages = new Map<string, string>()
  const inlineTexts = new Map<string, string>()
  const extraNotes: string[] = []
  const strippedFileIds = new Set<string>()

  const allFiles: FileAttachment[] = [...request.question.files]
  for (const [user] of getContextRounds(request.history, settings.allowRefusedContext)) {
    allFiles.push(...user.files)
  }

  for (const file of allFiles) {
    signal.throwIfAborted()
    const key = file.serverId ?? file.id
    const isCurrentQuestionFile = request.question.files.some((f) => f.id === file.id)
    const blob = await findLocalBlob(sessionId, file.id)
    if (!blob) {
      continue
    }

    // 图片与文档都交给原模型处理，不再有独立的识图 / OCR 渠道
    if (file.isImage) {
      // 先按官方 Vision 限制归一化（冷门格式转 WebP、超大图等比缩小），
      // 失败时退回原件；base64 内联路径必须走这里，避免 48MiB 请求体与 8192px 限制报错。
      const normalized = await normalizeImageIfNeeded(blob, file.mimeType, file.id)
      const dataUrl = await blobToDataUrl(normalized.blob)
      const modelSeesImages = allowsVision(
        settings.visionSupport,
        settings.model,
        settings.chatProtocol
      )
      if (!modelSeesImages && isCurrentQuestionFile) {
        // 模型不支持看图时，仍用同一模型尝试转成文字描述，避免直接发图报错
        const desc = await recognizeWithOpenAIVision({
          baseUrl: getApiOrigin(),
          apiKey: settings.apiKey ?? '',
          model: settings.model,
          prompt: `请详细识别并描述这张图片（${file.name}）中的关键内容、文字与细节，供后续对话回答使用。`,
          dataUrl,
          signal,
        })
        if (desc) {
          extraNotes.push(`[图片内容（${file.name}）：${desc}]`)
        }
        strippedFileIds.add(file.id)
      } else if (settings.chatProtocol !== 'deepseek') {
        inlineImages.set(key, dataUrl)
      }
      continue
    }

    // 非图片文件：能直接读文本的就内联，其余交给模型
    const isTextReadable = TEXT_MIME_RE.test(file.mimeType) || TEXT_EXT_RE.test(file.name)
    if (settings.chatProtocol !== 'deepseek' && isTextReadable && blob.size <= 512 * 1024) {
      const content = await blob.text()
      inlineTexts.set(key, `[文件：${file.name}]\n${content.slice(0, 12000)}`)
    }
  }

  const question: UserMessage =
    extraNotes.length === 0 && strippedFileIds.size === 0
      ? request.question
      : {
          ...request.question,
          content: [request.question.content, ...extraNotes].filter(Boolean).join('\n\n'),
          files: request.question.files.filter((file) => !strippedFileIds.has(file.id)),
        }

  return { question, inlineImages, inlineTexts }
}

/** 调用模型把指定轮次压成摘要；失败时抛错，由调用方降级处理 */
const summarizeRounds = async ({
  covered,
  previousSummary,
  apiKey,
  model,
  signal,
}: {
  covered: Parameters<typeof buildSummaryPrompt>[0]
  previousSummary?: string
  apiKey: string
  model: ChatModel
  signal: AbortSignal
}): Promise<string> => {
  const settings = useSettings.getState()
  const body = {
    model,
    system: SUMMARY_SYSTEM_PROMPT,
    messages: [{ role: 'user' as const, content: buildSummaryPrompt(covered, previousSummary) }],
    thinking: { type: 'disabled' as const },
    temperature: 0,
    max_tokens: 1200,
  }
  const origin = settings.apiOrigin || getApiOrigin()
  // 压缩摘要与主链路统一走流式（同一套传输，避免两套路径各自踩坑）
  const events =
    settings.chatProtocol === 'responses'
      ? streamResponsesMessage(
          origin,
          apiKey,
          body,
          signal,
          new Map(),
          new Map(),
          settings.customHeaders
        )
      : settings.chatProtocol === 'openai' || settings.chatProtocol === 'local'
        ? streamOpenAIMessage(
            origin,
            apiKey,
            body,
            signal,
            new Map(),
            new Map(),
            settings.customHeaders
          )
        : streamMessage(apiKey, body, signal)

  let output = ''
  for await (const event of events) {
    if (event.type === 'content_block_start' && event.content_block.type === 'text') {
      output += event.content_block.text
    } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      output += event.delta.text
    }
  }
  const summary = output.trim()
  if (!summary) {
    throw new Error('compaction returned empty summary')
  }
  return summary.length > SUMMARY_MAX_CHARS ? `${summary.slice(0, SUMMARY_MAX_CHARS)}…` : summary
}

/** 当前会话已压缩的摘要，转成注入 system 的文本；没压缩过返回空串 */
const getCompactionContext = (sessionId: string): string => {
  const summary = getSession(sessionId)?.compaction?.summary
  return summary ? formatCompactionContext(summary) : ''
}

/**
 * 上下文接近模型窗口（80%）时，把较早轮次压成摘要并记到会话上。
 * 压缩只影响后续请求里发送的内容，本地消息保持完整，界面仍可向上翻阅。
 * 任何失败都静默降级：带着原文继续请求，最多被服务端按超限拒掉，不影响其它功能。
 */
const compactLocks = new Map<string, Promise<void>>()

const maybeCompactContext = async (
  sessionId: string,
  history: Message[],
  model: ChatModel,
  signal: AbortSignal
): Promise<void> => {
  if (!useSettings.getState().autoCompactContext) {
    return
  }
  const running = compactLocks.get(sessionId)
  if (running) {
    await running
    return
  }
  const settings = useSettings.getState()
  const task = (async () => {
    set((state) => ({ compacting: { ...state.compacting, [sessionId]: true } }))
    try {
      // 单轮压缩可能不够（保留的最近几轮本身就很长），最多再补压 2 次。
      for (let pass = 0; pass < 3; pass += 1) {
        const session = getSession(sessionId)
        const plan = session
          ? planCompaction({
              history,
              compaction: session.compaction,
              model,
              allowRefused: settings.allowRefusedContext,
              contextWindow: settings.contextWindow,
            })
          : null
        if (!plan) {
          return
        }
        const summary = await summarizeRounds({
          covered: plan.covered,
          previousSummary: session?.compaction?.summary,
          apiKey: settings.apiKey ?? '',
          model,
          signal,
        })
        updateSession(sessionId, (current) => ({
          ...current,
          compaction: {
            summary,
            throughMessageId: plan.throughMessageId,
            tokens: estimateHistoryTokens(history, { summary } as never),
            compactedAt: Date.now(),
            count: (current.compaction?.count ?? 0) + 1,
          },
        }))
        persist(sessionId)
        showToast({ key: 'contextCompactedToast' })
      }
    } catch {
      // 压缩失败不打断对话：继续用原文请求
    } finally {
      compactLocks.delete(sessionId)
      set((state) => ({
        compacting: Object.fromEntries(
          Object.entries(state.compacting).filter(([id]) => id !== sessionId)
        ),
      }))
    }
  })()
  compactLocks.set(sessionId, task)
  await task
}

/**
 * 请求并消费流：先补齐附件的 serverId（或预处理识别），再发请求；流式增量按动画帧刷新内存，完成、失败或停止后落盘。
 * 补传失败时回复记为 upload 错误，可重试。
 * 服务端判定 file_id 失效时重新补传后重发，退避重试且次数有上限，超过则按原始报错收尾。
 */
const streamReply = async (sessionId: string, initial: AssistantMessage, request: Request) => {
  const controller = new AbortController()
  if (!getSession(sessionId)?.title) {
    titleRequests.add(controller)
  }
  set((state) => ({ streaming: { ...state.streaming, [sessionId]: controller } }))
  let reply = initial
  let frame = 0
  let flushTimer = 0
  const flush = () => {
    cancelAnimationFrame(frame)
    frame = 0
    if (flushTimer) {
      window.clearTimeout(flushTimer)
      flushTimer = 0
    }
    updateReply(sessionId, reply)
  }
  /**
   * rAF 在 Android WebView 后台标签页或掉帧时会被浏览器暂停/合并，
   * 增量会攒好几条才一起刷出来（表现为「输出一下子蹦出一大堆」）。
   * 改成时间驱动：rAF 可用就按帧刷，两帧内没刷出来就退化为 66ms 定时器兜底，
   * 保证增量最多延迟 66ms 上屏，观感是连续打字而不是突然蹦一大段。
   */
  let lastFlushAt = 0
  const scheduleFlush = () => {
    if (frame || flushTimer) {
      return
    }
    const now = performance.now()
    if (now - lastFlushAt >= 66) {
      lastFlushAt = now
      flush()
      return
    }
    flushTimer = window.setTimeout(() => {
      flushTimer = 0
      lastFlushAt = performance.now()
      flush()
    }, 66 - (now - lastFlushAt))
    frame = requestAnimationFrame(() => {
      if (flushTimer) {
        window.clearTimeout(flushTimer)
        flushTimer = 0
      }
      lastFlushAt = performance.now()
      flush()
    })
  }
  streamFlushes.set(sessionId, flush)

  try {
    for (let attempt = 0; ; attempt += 1) {
      /** 附件补齐前出错属于上传失败，请求还没有发出 */
      let preparing = true
      let receivedContent = false
      try {
        const settings = useSettings.getState()
        const turnModel = initial.model ?? (settings.model.trim() || MODEL)
        const useDeepSeekFiles = settings.chatProtocol === 'deepseek'
        const prepared = useDeepSeekFiles
          ? await prepareFiles(sessionId, request, controller.signal)
          : {
              history: request.history,
              question: request.question,
              prefix: request.prefix,
            }
        // 上下文接近上限时先把较早轮次压成摘要，再组装请求；压缩失败就带着原文继续（可能报超限）。
        await maybeCompactContext(sessionId, prepared.history, turnModel, controller.signal)
        const inlinePrepared = useDeepSeekFiles
          ? {
              question: prepared.question,
              inlineImages: new Map<string, string>(),
              inlineTexts: new Map<string, string>(),
            }
          : await prepareInlineAttachments(sessionId, prepared, controller.signal)
        preparing = false
        // 附件就绪后获取本轮信息；续写沿用原回答快照，重新生成的快照独立保存。
        const latestReminder = settings.sendLatestReminder
          ? prepared.prefix
            ? prepared.prefix.latestReminder
            : createLatestReminder(settings)
          : undefined
        reply = { ...reply, ...(latestReminder ? { latestReminder } : {}) }
        updateReply(sessionId, reply)
        persist(sessionId)
        const messages = toRequestMessages(
          prepared.history,
          inlinePrepared.question,
          prepared.prefix,
          initial.thinking ?? false,
          latestReminder,
          settings.allowRefusedContext,
          settings.chatProtocol !== 'deepseek',
          getSession(sessionId)?.compaction?.throughMessageId
        )
        const baseSystem = settings.systemPrompt.trim()
        const compactionContext = getCompactionContext(sessionId)
        const savedMemoryContext = settings.savedMemoryEnabled ? formatSavedMemories() : ''
        const memoryContext = settings.crossChatMemory
          ? await buildCrossChatMemory({
              currentSessionId: sessionId,
              query: inlinePrepared.question.content,
              sessions: get().sessions,
              sessionCache: get().sessionCache,
              maxSessions: settings.crossChatMemoryLimit,
              allowRefused: settings.allowRefusedContext,
              signal: controller.signal,
            })
          : ''
        if (controller.signal.aborted) {
          reply = settleReply(reply, 'stopped', Date.now(), undefined, settings.keepRefusedContent)
          break
        }
        const system = [baseSystem, compactionContext, savedMemoryContext, memoryContext]
          .filter(Boolean)
          .join('\n\n')
        const tools = serverTools(initial.search ?? false, settings.readUrl)
        // 思考程度：off 也要发协议字段——第三方网关认 enable_thinking:false /
        // reasoning.effort:none，不发就按各自默认继续思考（2.7.4 修复）；
        // DeepSeek 原生协议 off 返回空对象，由 thinking.type=disabled 关闭。
        const effort = settings.thinkingEffort
        const thinkingEnabled = effort !== 'off'
        const selectedModel = initial.model ?? (settings.model.trim() || MODEL)
        let requestModel = selectedModel
        /**
         * v2.8.2：官方 pro 模型在开启思考时不支持图片/文件输入——服务端会把图片
         * 变成 "[Unsupported Image]"，或直接报 "images are not supported by this model"。
         * 2.7.8 加的「深度思考自动切 pro」会让用户开着思考发图时踩这个坑。
         * 这里按官方模型能力兜底：官方协议 + 本轮带图片/文件 + 当前是 pro → 用回 flash
         * （flash 同时支持图片与思考），保证图片/文件能被识别。
         */
        if (settings.chatProtocol === 'deepseek') {
          const hasMedia = messages.some(
            (message) =>
              typeof message.content !== 'string' &&
              message.content.some((block) => block.type === 'image' || block.type === 'document')
          )
          if (hasMedia && /pro/i.test(requestModel)) {
            requestModel = 'deepseek-flash'
            showToast({ key: 'visionFlashFallback' })
          }
        }
        const requestBody: CreateMessageRequest = {
          model: requestModel,
          ...(system ? { system } : {}),
          messages,
          thinking: { type: thinkingEnabled ? 'enabled' : 'disabled' },
          ...buildReasoningPayload(effort, settings.chatProtocol),
          ...(settings.safetyCheck ? { safety_check: SAFETY_CHECK } : {}),
          ...(tools && tools.length > 0 ? { tools } : {}),
          ...(settings.temperature !== null ? { temperature: settings.temperature } : {}),
          ...(settings.topP !== null ? { top_p: settings.topP } : {}),
          ...(settings.maxTokens !== null ? { max_tokens: settings.maxTokens } : {}),
          ...(settings.autoTitle && titleRequests.has(controller)
            ? { title: { enabled: true } }
            : {}),
        }
        /**
         * v2.7.7 起恢复真流式（参考官方 chat-demo）：
         * 2.7.1 曾因部分网关流式不稳改成非流式 + 打字机伪装，但那样「一下子蹦出来」
         * 的观感反而更差，且白等完整生成。现在按官方做法：边收边渲染，
         * 渲染节流交给 Markdown 层（useThrottleMarkdownRender），不再有打字机。
         */
        const events =
          settings.chatProtocol === 'responses'
            ? streamResponsesMessage(
                settings.apiOrigin || getApiOrigin(),
                settings.apiKey ?? '',
                requestBody,
                controller.signal,
                inlinePrepared.inlineImages,
                inlinePrepared.inlineTexts,
                settings.customHeaders
              )
            : settings.chatProtocol === 'openai' || settings.chatProtocol === 'local'
              ? streamOpenAIMessage(
                  settings.apiOrigin || getApiOrigin(),
                  settings.apiKey ?? '',
                  requestBody,
                  controller.signal,
                  inlinePrepared.inlineImages,
                  inlinePrepared.inlineTexts,
                  settings.customHeaders
                )
              : streamMessage(settings.apiKey ?? '', requestBody, controller.signal)
        const blockIndexes = new Map<number, number>()
        for await (const event of events) {
          receivedContent ||= event.type === 'content_block_start'
          if (
            event.type === 'message_delta' &&
            (event.delta.stop_reason === 'end_turn' || event.delta.stop_reason === 'max_tokens') &&
            event.delta.title?.trim() &&
            titleRequests.has(controller) &&
            !controller.signal.aborted &&
            !get().importingHistory
          ) {
            const title = event.delta.title.trim()
            // 服务端标题优先；本地兜底标题会被它覆盖
            updateSession(sessionId, (session) => ({ ...session, title }))
            titleRequests.delete(controller)
          }
          reply = applyEvent(reply, event, Date.now(), blockIndexes)
          scheduleFlush()
        }
        reply = settleReply(reply, 'done', Date.now(), undefined, settings.keepRefusedContent)

        if (
          settings.autoExtractMemory &&
          settings.savedMemoryEnabled &&
          reply.stopReason !== 'refusal' &&
          inlinePrepared.question.content.trim()
        ) {
          void extractMemoriesFromTurn({
            apiKey: settings.apiKey ?? '',
            model: initial.model ?? (settings.model.trim() || MODEL),
            protocol: settings.chatProtocol,
            baseUrl: settings.apiOrigin,
            customHeaders: settings.customHeaders,
            userText: inlinePrepared.question.content,
            assistantText: getReplyText(reply),
          })
        }
        if (
          useSettings.getState().autoPlayVoice &&
          !controller.signal.aborted &&
          reply.stopReason !== 'refusal' &&
          get().activeId === sessionId
        ) {
          const spokenText = getReplyText(reply).trim()
          if (spokenText) {
            toggleReadAloud(reply.id, spokenText, () => {})
          }
        }
        break
      } catch (error) {
        const { keepRefusedContent } = useSettings.getState()
        if (controller.signal.aborted) {
          reply = settleReply(reply, 'stopped', Date.now(), undefined, keepRefusedContent)
          break
        }
        if (preparing) {
          reply = settleReply(reply, 'error', Date.now(), {
            kind: 'upload',
            message: '',
            localMessage: describeUploadError(error),
            retryable: isRetryableApiError(error),
          })
          break
        }
        // 附件失效：重新补传后重发。收到过内容块（含丢弃的客户端工具）后不自动重发。
        if (
          attempt < FILE_RETRY_LIMIT &&
          !receivedContent &&
          reuploadInvalidatedFiles(sessionId, request, error)
        ) {
          await waitForRetry(attempt, controller.signal)
          if (controller.signal.aborted) {
            reply = settleReply(reply, 'stopped', Date.now(), undefined, keepRefusedContent)
            break
          }
          continue
        }
        if (error instanceof ApiError && error.kind === 'interrupted' && reply.stopReason) {
          // 已收到 message_delta 的结束原因，只是缺了结尾的 message_stop
          reply = settleReply(reply, 'done', Date.now(), undefined, keepRefusedContent)
        } else if (error instanceof ApiError) {
          reply = settleReply(
            reply,
            'error',
            Date.now(),
            {
              kind: error.kind,
              message: error.message,
              status: error.status,
              localMessage: error.localMessage,
            },
            keepRefusedContent
          )
        } else {
          reply = settleReply(
            reply,
            'error',
            Date.now(),
            {
              kind: 'protocol',
              message: error instanceof Error ? error.message : String(error),
            },
            keepRefusedContent
          )
        }
        break
      }
    }
  } finally {
    titleRequests.delete(controller)
    streamFlushes.delete(sessionId)
    cancelAnimationFrame(frame)
    if (flushTimer) {
      window.clearTimeout(flushTimer)
      flushTimer = 0
    }
    if (reply.usage) {
      recordTurnTokenUsage(reply.usage)
    }
    updateReply(sessionId, reply)
    set((state) => ({
      streaming: Object.fromEntries(
        Object.entries(state.streaming).filter(([id]) => id !== sessionId)
      ),
    }))
    persist(sessionId)
  }
}
