import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { createId } from '../../utils/id.js'
import { toSessionSummary, type Session, type SessionSummary } from './types.js'

/** IndexedDB 存储结构版本；新增或调整存储、索引时递增。 */
const DB_VERSION = 11

/** 文件原件按附件的本地 id 存储，所有引用同一 id 的消息共用一份；用于缩略图、打开查看，以及没有 serverId 时补传。 */
export type StoredFile = {
  id: string
  blob: Blob
}

/** 文件引用留在摘要中，删除会话时通过索引判断原件是否仍被引用。 */
type StoredSessionSummary = SessionSummary & { fileIds: string[] }

interface ChatDB extends DBSchema {
  /** 当前使用的会话，界面读写都在这里 */
  sessions: { key: string; value: Session }
  sessionSummaries: {
    key: string
    value: StoredSessionSummary
    indexes: { fileIds: string }
  }
  /** 当前使用的文件原件 */
  files: { key: string; value: StoredFile }
  /**
   * 历史导入的暂存：导入过程中会话与原件只写入这两个存储，`sessions` / `files` 保持不变；
   * 全部校验通过后在一个事务中替换正式数据并清空暂存，失败时只清空暂存。
   */
  sessionsStaging: { key: string; value: Session }
  filesStaging: { key: string; value: StoredFile }
}

let dbPromise: Promise<IDBPDatabase<ChatDB>> | null = null

const storedSummary = (session: Session): StoredSessionSummary => ({
  ...toSessionSummary(session),
  fileIds: [
    ...new Set(
      session.messages.flatMap((message) =>
        message.role === 'user' ? message.files.map((file) => file.id) : []
      )
    ),
  ],
})

const abortTransaction = (tx: { abort(): void }) => {
  try {
    tx.abort()
  } catch {
    // 事务已因请求失败中止。
  }
}

// 每个操作拿到连接后立即创建事务；IndexedDB 按创建顺序执行范围重叠的事务，读取总能看到之前发起的写入。
const getDB = () =>
  (dbPromise ??= openDB<ChatDB>('chat-demo', DB_VERSION, {
    upgrade(db, _oldVersion, _newVersion, tx) {
      // 初始化当前格式需要的存储与索引，不迁移旧消息。
      for (const name of ['sessions', 'files', 'sessionsStaging', 'filesStaging'] as const) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' })
        }
      }
      const summaries = db.objectStoreNames.contains('sessionSummaries')
        ? tx.objectStore('sessionSummaries')
        : db.createObjectStore('sessionSummaries', { keyPath: 'id' })
      if (!summaries.indexNames.contains('fileIds')) {
        summaries.createIndex('fileIds', 'fileIds', { multiEntry: true })
      }
    },
  }).catch((error: unknown) => {
    // 打开失败后允许界面重试，避免一直复用已拒绝的 Promise。
    dbPromise = null
    throw error
  }))

export const loadSessionSummaries = async (): Promise<SessionSummary[]> =>
  (await (await getDB()).getAll('sessionSummaries')).map(toSessionSummary)

export const loadSession = async (id: string): Promise<Session | undefined> =>
  (await getDB()).get('sessions', id)

export const loadAllSessions = async (): Promise<Session[]> => (await getDB()).getAll('sessions')

export const saveSession = async (session: Session, files: StoredFile[] = []): Promise<void> => {
  const summary = storedSummary(session)
  const tx = (await getDB()).transaction(['sessions', 'sessionSummaries', 'files'], 'readwrite')
  await Promise.all([
    (async () => {
      try {
        for (const file of files) {
          await tx.objectStore('files').put(file)
        }
        await tx.objectStore('sessions').put(session)
        await tx.objectStore('sessionSummaries').put(summary)
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
}

/** 未打开的会话也可重命名，只读取该会话，原子更新详情和列表。 */
export const renameSession = async (id: string, title: string): Promise<void> => {
  const tx = (await getDB()).transaction(['sessions', 'sessionSummaries'], 'readwrite')
  await Promise.all([
    (async () => {
      try {
        const sessions = tx.objectStore('sessions')
        const session = await sessions.get(id)
        if (session) {
          session.title = title
          await sessions.put(session)
          await tx.objectStore('sessionSummaries').put(storedSummary(session))
        }
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
}

/** 未打开的会话也能改元数据（置顶、归档等），只读写该条记录。 */
export const updateSessionMeta = async (
  id: string,
  meta: { pinned?: boolean; archived?: boolean; archivedAt?: number }
): Promise<void> => {
  const tx = (await getDB()).transaction(['sessions', 'sessionSummaries'], 'readwrite')
  await Promise.all([
    (async () => {
      try {
        const sessions = tx.objectStore('sessions')
        const session = await sessions.get(id)
        if (session) {
          const next = { ...session, ...meta }
          await sessions.put(next)
          await tx.objectStore('sessionSummaries').put(storedSummary(next))
        }
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
}

/** 删除会话，仅清理已无会话引用的本地原件；远端文件不删。 */
export const deleteSession = async (sessionId: string): Promise<void> => {
  const tx = (await getDB()).transaction(['sessions', 'sessionSummaries', 'files'], 'readwrite')
  await Promise.all([
    (async () => {
      try {
        const summaries = tx.objectStore('sessionSummaries')
        const summary = await summaries.get(sessionId)
        await tx.objectStore('sessions').delete(sessionId)
        await summaries.delete(sessionId)
        for (const id of summary?.fileIds ?? []) {
          if ((await summaries.index('fileIds').count(id)) === 0) {
            await tx.objectStore('files').delete(id)
          }
        }
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
}

const putFiles = async (store: 'files' | 'filesStaging', files: StoredFile[]) => {
  const tx = (await getDB()).transaction(store, 'readwrite')
  await Promise.all([...files.map((file) => tx.store.put(file)), tx.done])
}

export const saveFiles = (files: StoredFile[]): Promise<void> => putFiles('files', files)

export const loadFile = async (id: string): Promise<Blob | undefined> =>
  (await (await getDB()).get('files', id))?.blob

/** 清空导入暂存：开始导入前清除上次中断（如关闭页面）遗留的数据，导入失败后清除本次写入。 */
export const clearStaging = async (): Promise<void> => {
  const tx = (await getDB()).transaction(['sessionsStaging', 'filesStaging'], 'readwrite')
  await Promise.all([
    tx.objectStore('sessionsStaging').clear(),
    tx.objectStore('filesStaging').clear(),
    tx.done,
  ])
}

export const addStagingSession = async (session: Session): Promise<void> => {
  await (await getDB()).add('sessionsStaging', session)
}

export const addStagingSessions = async (sessions: Session[]): Promise<void> => {
  if (sessions.length === 0) {
    return
  }
  const tx = (await getDB()).transaction('sessionsStaging', 'readwrite')
  await Promise.all([...sessions.map((session) => tx.store.put(session)), tx.done])
}

export const saveStagingFiles = (files: StoredFile[]): Promise<void> =>
  putFiles('filesStaging', files)

/** 图片位于会话 JSON 之后；全部读完后回填具体 MIME，保留归档给出的 isImage 标识。 */
export const updateStagingFileTypes = async (types: ReadonlyMap<string, string>): Promise<void> => {
  const tx = (await getDB()).transaction('sessionsStaging', 'readwrite')
  await Promise.all([
    (async () => {
      for (let cursor = await tx.store.openCursor(); cursor; cursor = await cursor.continue()) {
        const session = cursor.value
        let changed = false
        for (const message of session.messages) {
          if (message.role !== 'user') {
            continue
          }
          for (const file of message.files) {
            const type = types.get(file.id) ?? ''
            if (file.mimeType !== type) {
              file.mimeType = type
              changed = true
            }
          }
        }
        if (changed) {
          await cursor.update(session)
        }
      }
    })(),
    tx.done,
  ])
}

/**
 * 会话内容指纹：判断「这个包里的这条会话是不是已经在库里了」。
 * 只用元数据（标题 + 两个时间戳 + 消息条数），不碰正文，成本极低；
 * createdAt 是毫秒时间戳，两条不同会话撞上同一个指纹的概率可以忽略。
 */
const fingerprint = (session: Session): string =>
  `${session.title}|${session.createdAt}|${session.updatedAt}|${session.messages.length}`

/**
 * 给会话换一个新 ID；会话内的 parentId / selectedChildId 指向消息 ID，不受影响。
 * `sourceId` 记下它在导入包里的原始 ID，便于排查「这条是从哪个包来的」。
 */
const reId = (session: Session): Session => ({ ...session, id: createId(), sourceId: session.id })

/**
 * 把暂存写入正式数据（v2.8.7 起支持两种模式）。
 *
 * - `merge`（导入）：把暂存里的会话/摘要/原件**并进**正式存储，**本机已有会话一条都不会丢**。
 * - `replace`（清空历史）：先清空正式存储再写入，写入为空即删除全部会话与附件。
 *
 * v2.9.1 修：merge 模式以前对同 ID 会话直接 `put` 覆盖——导入自己的备份包时，
 * 包里那份**旧版本**会把本机正在用的会话整条替换掉，用户看到的就是「导入后以前的对话没了」。
 * 现在改成：
 * - 库里已有**同样内容**的会话（重复导入同一个包）→ 跳过，不产生重复副本；
 * - ID 冲突但内容不同 → **本机那份原样保留**，导入的这份换新 ID 另存，两边都在。
 *
 * 两种模式都在同一事务内完成并清空暂存；事务失败时整体回滚，正式数据不变。
 * 逐条游标复制，同一时间只读取一条记录。
 */
export const commitStaging = async (
  mode: 'merge' | 'replace' = 'merge'
): Promise<SessionSummary[]> => {
  const summaries: SessionSummary[] = []
  const tx = (await getDB()).transaction(
    ['sessions', 'sessionSummaries', 'files', 'sessionsStaging', 'filesStaging'],
    'readwrite'
  )
  const move = async (from: 'sessionsStaging' | 'filesStaging', to: 'sessions' | 'files') => {
    try {
      const target = tx.objectStore(to)
      const isSessions = to === 'sessions'
      /**
       * merge 时先读一遍库里已有的记录，建两个索引：
       * - `knownIds`：已有会话 ID（同 ID 时本机优先，导入的另存）；
       * - `knownFp`：已有会话的内容指纹（重复导入同一个包时跳过）。
       * 一次 getAll 比逐条 get 快得多，长历史几百上千条也只是一次读取。
       */
      const knownIds = new Set<string>()
      const knownFp = new Set<string>()
      if (mode === 'merge') {
        for (const existing of await target.getAll()) {
          const item = existing as { id: string }
          knownIds.add(item.id)
          if (isSessions) {
            knownFp.add(fingerprint(existing as Session))
          }
        }
      }
      if (mode === 'replace') {
        // 清空历史：先抹掉正式数据（导入是 merge，不会走到这里）
        await target.clear()
        if (isSessions) {
          await tx.objectStore('sessionSummaries').clear()
        }
      }
      for (
        let cursor = await tx.objectStore(from).openCursor();
        cursor;
        cursor = await cursor.continue()
      ) {
        let value = cursor.value
        if (mode === 'merge') {
          const incoming = value as Session
          const id = (value as { id: string }).id
          if (isSessions) {
            // 同一个包再导一次：库里已经有内容相同的这条，跳过，别越导越多
            if (knownFp.has(fingerprint(incoming))) {
              continue
            }
            // 本机已有同 ID 的会话（用户自己那份）：绝不覆盖，给导入的这份换新 ID
            if (knownIds.has(id)) {
              value = reId(incoming) as typeof value
            }
          } else if (knownIds.has(id)) {
            // 附件原件按 id 存一份：本机已有就保留，绝不覆盖（覆盖会把老会话里的图换掉）
            continue
          }
        }
        await target.put(value)
        if (isSessions) {
          const summary = storedSummary(value as Session)
          await tx.objectStore('sessionSummaries').put(summary)
          summaries.push(toSessionSummary(summary))
        }
      }
      await tx.objectStore(from).clear()
    } catch (error) {
      // 同步抛出的错误不会让事务自动回滚，需显式中止，避免只提交部分移入。
      abortTransaction(tx)
      throw error
    }
  }
  await Promise.all([move('sessionsStaging', 'sessions'), move('filesStaging', 'files'), tx.done])
  // 直接返回本次提交的列表，调用方无需在替换成功后再发起可能失败的读取。
  return summaries
}

/** 本地存储失败不打断对话，只在控制台留痕 */
export const reportStorageError = (action: string) => (error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(`[storage] ${action} failed`, error)
}
