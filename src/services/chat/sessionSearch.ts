import type { SessionSummary } from './types.js'

/**
 * 会话搜索与置顶。
 *
 * 侧边栏原来只有按时间分组，会话一多就翻不到；这里补两类能力：
 * - 标题/内容搜索：先匹配标题，再匹配消息正文，按命中位置排序
 * - 置顶：pinned 会话始终排在分组之前
 */

/** 搜索命中的会话，附带一段高亮用的上下文片段 */
export type SessionSearchHit = {
  session: SessionSummary
  /** 命中的片段（标题命中时为空） */
  snippet: string
}

const normalize = (text: string) => text.toLowerCase()

/**
 * 在会话列表里搜索。
 * `contentOf` 由调用方提供：已加载的会话可直接读内存，未加载的按需读库（可为空）。
 */
export const searchSessions = async (
  sessions: SessionSummary[],
  query: string,
  contentOf: (id: string) => Promise<string | null>
): Promise<SessionSearchHit[]> => {
  const q = normalize(query.trim())
  if (!q) {
    return []
  }
  const hits: SessionSearchHit[] = []
  for (const session of sessions) {
    if (normalize(session.title).includes(q)) {
      hits.push({ session, snippet: '' })
      continue
    }
    const content = await contentOf(session.id)
    if (!content) {
      continue
    }
    const index = normalize(content).indexOf(q)
    if (index < 0) {
      continue
    }
    const start = Math.max(0, index - 24)
    const end = Math.min(content.length, index + q.length + 40)
    const raw = content.slice(start, end).replace(/\s+/g, ' ').trim()
    hits.push({
      session,
      snippet: `${start > 0 ? '…' : ''}${raw}${end < content.length ? '…' : ''}`,
    })
  }
  return hits
}

/** 置顶的排前面，其余保持原有顺序（已按 updatedAt 排序） */
export const sortWithPinned = <T extends { pinned?: boolean }>(items: T[]): T[] => {
  if (!items.some((item) => item.pinned)) {
    return items
  }
  return [...items.filter((item) => item.pinned), ...items.filter((item) => !item.pinned)]
}
