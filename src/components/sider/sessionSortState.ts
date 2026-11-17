import { create } from 'zustand'
import type { SessionSummary } from '../../services/chat/types.js'

/** 会话目录的排序方式 */
export type SessionSort = 'updatedAt' | 'createdAt' | 'title'

const SORT_KEY = 'chat-demo:session-sort'

const SORTS: SessionSort[] = ['updatedAt', 'createdAt', 'title']

const readSort = (): SessionSort => {
  try {
    const raw = localStorage.getItem(SORT_KEY)
    return SORTS.includes(raw as SessionSort) ? (raw as SessionSort) : 'updatedAt'
  } catch {
    return 'updatedAt'
  }
}

export const useSessionSort = create(() => ({ sort: readSort() }))

export const setSessionSort = (sort: SessionSort) => {
  useSessionSort.setState({ sort })
  try {
    localStorage.setItem(SORT_KEY, sort)
  } catch {
    // 忽略本地存储失败，排序本次仍然生效
  }
}

/** 按当前排序方式排列会话；置顶始终在最前 */
export const sortSessions = (sessions: SessionSummary[], sort: SessionSort): SessionSummary[] => {
  const pinned = sessions.filter((session) => session.pinned)
  const rest = sessions.filter((session) => !session.pinned)
  const compare = (a: SessionSummary, b: SessionSummary) => {
    if (sort === 'title') {
      return a.title.localeCompare(b.title, 'zh-Hans-CN')
    }
    if (sort === 'createdAt') {
      return b.createdAt - a.createdAt
    }
    return b.updatedAt - a.updatedAt
  }
  return [...pinned.sort(compare), ...rest.sort(compare)]
}

/** 被收起的分组 key 集合；持久化到 localStorage，刷新后保持 */
const COLLAPSED_KEY = 'chat-demo:collapsed-groups'

const readCollapsed = (): string[] => {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

export const useCollapsedGroups = create(() => ({ keys: readCollapsed() }))

export const isGroupCollapsed = (key: string): boolean =>
  useCollapsedGroups.getState().keys.includes(key)

export const toggleGroupCollapsed = (key: string) => {
  const { keys } = useCollapsedGroups.getState()
  const next = keys.includes(key) ? keys.filter((item) => item !== key) : [...keys, key]
  useCollapsedGroups.setState({ keys: next })
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next))
  } catch {
    // 存储不可用时只在内存里生效
  }
}
