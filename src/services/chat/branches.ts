import type { Message, Session } from './types.js'

/** 将线性消息列表规范化为单分支，保留消息 ID、内容及时间。 */
export const normalizeSession = (session: Session): Session =>
  session.rootMessageId !== undefined
    ? session
    : {
        ...session,
        rootMessageId: session.messages[0]?.id ?? null,
        messages: session.messages.map((message, index, messages) => ({
          ...message,
          parentId: messages[index - 1]?.id ?? null,
          selectedChildId: messages[index + 1]?.id,
        })),
      }

/**
 * 当前选中分支的可见消息。
 *
 * v2.9.1：加 WeakMap 缓存。以前每次调用都要把 `session.messages` 整个映射成 Map
 * 再沿分支走一遍——长会话（导入的几千条）里每次渲染都做一次 O(n) 分配，
 * 压缩刚结束时界面正在重排，这条路径直接把主线程拖住（表现为「压缩后短期很卡」）。
 * 会话对象是不可变更新的（改动时一定是新对象），所以按 session 身份缓存是安全的。
 */
const visibleCache = new WeakMap<Session, Message[]>()

export const getVisibleMessages = (session: Session): Message[] => {
  const cached = visibleCache.get(session)
  if (cached) {
    return cached
  }
  const result =
    session.rootMessageId === undefined
      ? session.messages
      : (() => {
          const byId = new Map(session.messages.map((message) => [message.id, message]))
          const path: Message[] = []
          let id = session.rootMessageId
          while (id) {
            const message = byId.get(id)
            if (!message) {
              break
            }
            path.push(message)
            byId.delete(id)
            id = message.selectedChildId ?? null
          }
          return path
        })()
  visibleCache.set(session, result)
  return result
}

export type MessageVersions = { ids: string[]; index: number }

/** 一次遍历收集兄弟版本；版本列表未变化时复用旧对象与索引，避免流式正文更新重绘历史消息。 */
export const buildMessageVersions = (
  session: Session,
  previous: ReadonlyMap<string, MessageVersions>
): ReadonlyMap<string, MessageVersions> => {
  const groups = new Map<string | null | undefined, string[]>()
  for (const message of session.messages) {
    const key = session.rootMessageId === undefined ? message.id : message.parentId
    const ids = groups.get(key)
    if (ids) {
      // 修复 Bug B：同一 parent 下重复 id 只保留一次，避免把两个
      // {ids,index} 对象都写进 versions，让收敛判据更容易成立。
      if (!ids.includes(message.id)) {
        ids.push(message.id)
      }
    } else {
      groups.set(key, [message.id])
    }
  }

  const versions = new Map<string, MessageVersions>()
  for (const ids of groups.values()) {
    const cachedIds = previous.get(ids[0])?.ids
    const stableIds =
      cachedIds?.length === ids.length && ids.every((id, index) => id === cachedIds[index])
        ? cachedIds
        : ids
    ids.forEach((id, index) => {
      const cached = previous.get(id)
      const version =
        cached?.ids === stableIds && cached.index === index ? cached : { ids: stableIds, index }
      versions.set(id, version)
    })
  }
  // 修复 Bug B：收敛判据改为「与上一份内容等价」，不再假设
  // previous.size === session.messages.length（重复 id 时该前提恒不成立，
  // 导致每次渲染都返回新 Map、渲染期 setState 不收敛 → React #301 白屏）。
  // 放在构建完成之后遍历 versions 逐项比较；只要有一项是新对象或数量不同就不收敛。
  let unchanged = previous.size === versions.size
  if (unchanged) {
    for (const [id, version] of versions) {
      if (previous.get(id) !== version) {
        unchanged = false
        break
      }
    }
  }
  return unchanged ? previous : versions
}

/** 新消息挂在指定父节点下，并选择新分支；原节点与其后续对话保持不变。 */
export const appendBranch = (
  original: Session,
  parentId: string | null,
  messages: Message[]
): Session => {
  const session = normalizeSession(original)
  const first = messages[0]
  if (!first) {
    return session
  }
  return {
    ...session,
    rootMessageId: parentId === null ? first.id : session.rootMessageId,
    messages: [
      ...session.messages.map((message) =>
        message.id === parentId ? { ...message, selectedChildId: first.id } : message
      ),
      ...messages.map((message, index) => ({
        ...message,
        parentId: messages[index - 1]?.id ?? parentId,
        selectedChildId: messages[index + 1]?.id,
      })),
    ],
  }
}

/** 仅允许切换当前路径上某一节点的兄弟版本，恢复该版本已选中的后续分支。 */
export const selectVersion = (original: Session, messageId: string): Session => {
  const session = normalizeSession(original)
  const message = session.messages.find((item) => item.id === messageId)
  if (!message || !getVisibleMessages(session).some((item) => item.parentId === message.parentId)) {
    return original
  }
  return {
    ...session,
    rootMessageId: message.parentId === null ? message.id : session.rootMessageId,
    messages: session.messages.map((item) =>
      item.id === message.parentId ? { ...item, selectedChildId: message.id } : item
    ),
  }
}
