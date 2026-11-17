import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { getVisibleMessages } from '../../services/chat/branches.js'
import { contextUsageDetail } from '../../services/chat/compaction.js'
import { useChatStore } from '../../services/chat/store.js'
import { useSettings } from '../../services/settings.js'
import styles from './ContextUsage.module.css'

/** token 数量按千 / 百万缩写，避免一串数字挤在一起 */
export const formatTokens = (value: number): string => {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`
  }
  if (value >= 1000) {
    return `${Math.round(value / 1000)}K`
  }
  return String(Math.round(value))
}

/**
 * 上下文用量面板。
 * 从对话页挪到这里（对话设置 / 对话的「更多」菜单），避免用户盯着百分比产生焦虑。
 * 优先用服务端真实 usage，没有记录才退回估算并明确标注。
 */
export const ContextUsage = ({ sessionId }: { sessionId?: string | null }) => {
  const t = useTranslate()
  const activeId = useChatStore((state) => state.activeId)
  const targetId = sessionId ?? activeId
  const session = useChatStore((state) =>
    targetId !== null && targetId !== undefined && Object.hasOwn(state.sessionCache, targetId)
      ? state.sessionCache[targetId]
      : undefined
  )
  const model = useSettings((state) => state.model)
  const contextWindow = useSettings((state) => state.contextWindow)
  const autoCompact = useSettings((state) => state.autoCompactContext)

  const usage = (() => {
    if (!session) {
      return null
    }
    const history = getVisibleMessages(session)
    if (history.length === 0) {
      return null
    }
    const detail = contextUsageDetail(history, session.compaction, model, 0, contextWindow)
    const percent = Math.round(detail.ratio * 100)
    const level = detail.ratio >= 0.8 ? 'high' : detail.ratio >= 0.5 ? 'medium' : 'low'
    return { percent, level, tokens: detail.tokens, estimated: detail.estimated }
  })()

  return (
    <div className={styles.cell}>
      {usage ? (
        <>
          <div className={styles.head}>
            <span className={styles.percent}>{usage.percent}%</span>
            <span className={styles.window}>
              {t('settingsContextUsageTokens', {
                used: formatTokens(usage.tokens),
                total: formatTokens(contextWindow),
              })}
            </span>
          </div>
          <div className={styles.track}>
            <div
              className={clsx(styles.fill, styles[`fill_${usage.level}`])}
              style={{ width: `${Math.min(100, usage.percent)}%` }}
            />
            {autoCompact ? <div className={styles.threshold} /> : null}
          </div>
          <div className={styles.hint}>
            {usage.estimated ? t('settingsContextUsageEstimated') : t('settingsContextUsageHint')}
          </div>
        </>
      ) : (
        <div className={styles.hint}>
          {targetId === null || targetId === undefined
            ? t('settingsContextUsageUnavailable')
            : t('settingsContextUsageEmpty')}
        </div>
      )}
    </div>
  )
}
