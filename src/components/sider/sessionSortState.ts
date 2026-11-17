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
