import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { getVisibleMessages } from '../../services/chat/branches.js'
import {
  cacheHitDetail,
  compactLevelMeta,
  contextUsageDetail,
  manualCompactionStats,
  outputSpeedDetail,
} from '../../services/chat/compaction.js'
import {
  clearSessionCompaction,
  compactSession,
  useChatStore,
} from '../../services/chat/store.js'
import { activeContextWindow, useSettings } from '../../services/settings.js'
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
  // v2.9.2：窗口跟着当前模型走，和压缩判定的取值保持一致
  const contextWindow = useSettings(activeContextWindow)
  const autoCompact = useSettings((state) => state.autoCompactContext)
  const allowRefused = useSettings((state) => state.allowRefusedContext)
  const compactLevel = useSettings((state) => state.compactLevel)
  // 档位决定触发点与保留轮数，进度条的阈值刻度也跟着走
  const levelMeta = compactLevelMeta(compactLevel)
  // 压缩中：自动压缩与主动压缩共用这个状态，避免重复触发
  const compacting = useChatStore((state) =>
    targetId !== null && targetId !== undefined ? Boolean(state.compacting[targetId]) : false
  )
  const [busy, setBusy] = useState(false)

  // v2.9.1：这里以前是每次渲染都直接算（IIFE），而设置页在压缩期间会因为
  // compacting 状态反复重渲染，长会话下每次都要把整段历史重新估一遍 token，
  // 压缩时/压缩后那几秒的卡顿有一大半来自这里。改成 useMemo 只跟真正影响结果的值联动。
  const usage = useMemo(() => {
    if (!session) {
      return null
    }
    const history = getVisibleMessages(session)
    if (history.length === 0) {
      return null
    }
    const detail = contextUsageDetail(history, session.compaction, model, 0, contextWindow)
    const percent = Math.round(detail.ratio * 100)
    // 超过当前档位的触发点就算「高」，让颜色和实际压缩时机一致
    const level =
      detail.ratio >= levelMeta.ratio
        ? 'high'
        : detail.ratio >= levelMeta.ratio * 0.6
          ? 'medium'
          : 'low'
    return { percent, level, tokens: detail.tokens, estimated: detail.estimated }
  }, [session, model, contextWindow, levelMeta.ratio])

  // 缓存命中（v2.9.3）：只读本轮回复的 usage，命中量 / 总输入量
  const cacheHit = useMemo(() => {
    if (!session) {
      return null
    }
    return cacheHitDetail(getVisibleMessages(session))
  }, [session])

  // 输出速度（v2.9.4）：本轮生成 token / 生成耗时，只读带 timing 的回复
  const speed = useMemo(() => {
    if (!session) {
      return null
    }
    return outputSpeedDetail(getVisibleMessages(session))
  }, [session])

  // 可压缩轮次：保留轮数跟随当前档位（省档留得少、长记忆档留得多）
  // 同样改成 useMemo：它会遍历全部轮次，压缩后如果每次重渲染都算一遍同样很重。
  const stats = useMemo(() => {
    if (!session || !actions) {
      return null
    }
    const history = getVisibleMessages(session)
    return manualCompactionStats({
      history,
      compaction: session.compaction,
      allowRefused,
      keepRounds: levelMeta.keepRounds,
    })
  }, [session, actions, allowRefused, levelMeta.keepRounds])

  const hasSummary = Boolean(session?.compaction?.summary)
  const canCompact = Boolean(stats && stats.compactable > 0)
  const working = busy || compacting

  const onCompact = async () => {
    if (targetId === null || targetId === undefined || working) {
      return
    }
    setBusy(true)
    try {
      const count = await compactSession(targetId, levelMeta.keepRounds)
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
            {/* 阈值刻度跟着档位走：20/40/60/80% */}
            {autoCompact ? (
              <div
                className={styles.threshold}
                style={{ left: `${Math.round(levelMeta.ratio * 100)}%` }}
                title={t('settingsCompactLevelThreshold', {
                  percent: Math.round(levelMeta.ratio * 100),
                })}
              />
            ) : null}
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
      {cacheHit ? (
        <div className={styles.cacheRow}>
          <span className={styles.cacheLabel}>{t('settingsCacheHitLabel')}</span>
          <span
            className={clsx(
              styles.cacheValue,
              cacheHit.ratio >= 0.5
                ? styles.cacheGood
                : cacheHit.ratio >= 0.2
                  ? styles.cacheMid
                  : styles.cacheLow
            )}
          >
            {Math.round(cacheHit.ratio * 100)}%
          </span>
          <span className={styles.cacheDetail}>
            {t('settingsCacheHitDetail', {
              hit: formatTokens(cacheHit.hit),
              total: formatTokens(cacheHit.total),
            })}
          </span>
        </div>
      ) : null}
      {cacheHit ? <div className={styles.hint}>{t('settingsCacheHitHint')}</div> : null}
      {speed ? (
        <div className={styles.cacheRow}>
          <span className={styles.cacheLabel}>{t('settingsOutputSpeedLabel')}</span>
          <span className={styles.speedValue}>{speed.perSecond}</span>
          <span className={styles.cacheDetail}>
            {t('settingsOutputSpeedDetail', {
              tokens: speed.tokens,
              seconds: speed.seconds.toFixed(1),
            })}
          </span>
        </div>
      ) : null}
      {speed ? <div className={styles.hint}>{t('settingsOutputSpeedHint')}</div> : null}
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
