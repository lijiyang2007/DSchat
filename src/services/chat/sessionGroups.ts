import { translate } from '../../i18n/index.js'
import { monthKey } from '../../utils/format.js'
import { listTime, type SessionSummary } from './types.js'

const DAY = 86_400_000

const startOfDay = (time: number) => new Date(time).setHours(0, 0, 0, 0)

/**
 * 分组：今天 / 昨天 / 7 天内 / 30 天内 / 按月。
 * 用 listTime（含 importedAt）分组，刚导入的会话才会出现在「今天」而不是旧月份里。
 */
export const groupSessions = (sessions: SessionSummary[], now: number, t = translate) => {
  const groups: { key: string; label: string; sessions: SessionSummary[] }[] = []
  for (const session of sessions) {
    const time = listTime(session)
    const diff = Math.floor((now - startOfDay(time)) / DAY)
    const key =
      diff <= 0
        ? 'sessionHistoryTimelineLabelToday'
        : diff <= 1
          ? 'sessionHistoryTimelineLabelYesterday'
          : diff < 7
            ? 'sessionHistoryTimelineLabel7days'
            : diff < 30
              ? 'sessionHistoryTimelineLabel30days'
              : null
    const groupKey = key ?? monthKey(time) ?? ''
    const last = groups.at(-1)
    if (last?.key === groupKey) {
      last.sessions.push(session)
    } else {
      groups.push({ key: groupKey, label: key ? t(key) : groupKey, sessions: [session] })
    }
  }
  return groups
}
