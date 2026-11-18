import clsx from 'clsx'
import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { getVisibleMessages } from '../../services/chat/branches.js'
import {
  contextUsageDetail,
  manualCompactionStats,
} from '../../services/chat/compaction.js'
import {
  clearSessionCompaction,
  compactSession,
  useChatStore,
} from '../../services/chat/store.js'
import { useSettings } from '../../services/settings.js'
import { showToast } from '../base/toastState.js'
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
 *
 * v2.8.8：底部加「立即压缩」/「清除摘要」，用户可以主动管理上下文。
 */
export const ContextUsage = ({
  sessionId,
  actions = false,
}: {
  sessionId?: string | null
  /** 显示主动压缩按钮（设置页的对话设置里用） */
  actions?: boolean
}) => {
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
  const allowRefused = useSettings((state) => state.allowRefusedContext)
  // 压缩中：自动压缩与主动压缩共用这个状态，避免重复触发
  const compacting = useChatStore((state) =>
    targetId !== null && targetId !== undefined ? Boolean(state.compacting[targetId]) : false
  )
  const [busy, setBusy] = useState(false)

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

  // 可压缩轮次：保留最近 3 轮原文，其余可以压成摘要
  const stats = (() => {
    if (!session || !actions) {
      return null
    }
    const history = getVisibleMessages(session)
    return manualCompactionStats({
      history,
      compaction: session.compaction,
      allowRefused,
      keepRounds: 3,
    })
  })()

  const hasSummary = Boolean(session?.compaction?.summary)
  const canCompact = Boolean(stats && stats.compactable > 0)
  const working = busy || compacting

  const onCompact = async () => {
    if (targetId === null || targetId === undefined || working) {
      return
    }
    setBusy(true)
    try {
      const count = await compactSession(targetId, 3)
      showToast({ key: 'contextCompactManualDone', params: { count } })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // 内部错误码翻成人话；其它错误原样给出，便于排查
      const key =
        message === 'nothing to compact'
          ? 'contextCompactNothing'
          : message === 'reply in progress'
            ? 'contextCompactBusyReply'
            : message === 'compaction already running'
              ? 'contextCompactAlreadyRunning'
              : 'contextCompactFailed'
      showToast({ key, params: { message } })
    } finally {
      setBusy(false)
    }
  }

  const onClear = () => {
    if (targetId === null || targetId === undefined || working) {
      return
    }
    if (clearSessionCompaction(targetId)) {
      showToast({ key: 'contextCompactCleared' })
    }
  }

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
      {actions ? (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.actionButton}
            disabled={!canCompact || working}
            onClick={() => void onCompact()}
          >
            {working
              ? t('contextCompactWorking')
              : canCompact
                ? t('contextCompactNow', { count: stats?.compactable ?? 0 })
                : t('contextCompactNothing')}
          </button>
          {hasSummary ? (
            <button
              type="button"
              className={styles.actionButton}
              disabled={working}
              onClick={onClear}
            >
              {t('contextCompactClear')}
            </button>
          ) : null}
        </div>
      ) : null}
      {actions && stats && stats.compactable === 0 && stats.total > 0 ? (
        <div className={styles.hint}>{t('contextCompactKeepHint', { keep: stats.keep })}</div>
      ) : null}
    </div>
  )
}
