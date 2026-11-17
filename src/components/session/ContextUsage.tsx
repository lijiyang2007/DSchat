import { useMemo } from 'react'
import { useSettings } from '../../services/settings.js'
import { getVisibleMessages } from '../../services/chat/branches.js'
import { contextUsageRatio } from '../../services/chat/compaction.js'
import type { Session } from '../../services/chat/types.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './ContextUsage.module.css'

/**
 * 上下文使用量进度条：显示当前会话在模型上下文窗口里的占比。
 * 超过 80% 会自动压缩，所以到 80% 时进度条变色提醒。
 */
export const ContextUsage = ({ session }: { session: Session }) => {
  const t = useTranslate()
  const model = useSettings((state) => state.model)
  const contextWindow = useSettings((state) => state.contextWindow)
  const autoCompact = useSettings((state) => state.autoCompactContext)

  const ratio = useMemo(() => {
    const history = getVisibleMessages(session)
    return contextUsageRatio(history, session.compaction, model, 0, contextWindow)
  }, [session, model, contextWindow])

  const percent = Math.round(ratio * 100)
  const level = ratio >= 0.8 ? 'high' : ratio >= 0.5 ? 'medium' : 'low'

  return (
    <div
      className={styles.wrap}
      title={t('contextUsageHint', { percent, compacted: autoCompact ? t('contextUsageAuto') : t('contextUsageManual') })}
    >
      <div className={styles.track}>
        <div className={`${styles.fill} ${styles[level]}`} style={{ width: `${percent}%` }} />
        {autoCompact ? <div className={styles.threshold} /> : null}
      </div>
      <span className={styles.label}>
        {t('contextUsageLabel', { percent })}
      </span>
    </div>
  )
}
