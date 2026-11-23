import { useMemo } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { getCurrentAppVersion } from '../../services/updater.js'
import { CRASH_LOG_KEY } from '../../app/ErrorBoundary.js'
import { useSettings } from '../../services/settings.js'
import { IconDataOutline16, IconEditOutline16, IconLinkOutline16 } from '../base/icons.js'
import { SettingsGroup, SettingsEntry } from './SettingsPage.js'
import styles from './Settings.module.css'

const REPO_ISSUES = 'https://github.com/lijiyang2007/DSchat/issues/new'
const MAILTO = 'mailto:api-service@deepseek.com'

/** 打开系统浏览器（镜像加速对 github.com 页面同样有效） */
const openInBrowser = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * 反馈页：问题与建议通过 GitHub Issue 模板提交（自动带环境信息），
 * 没有或不想登录 GitHub 的用户可以发邮件。不做 App 内提交后端——无服务器可存。
 */
export const FeedbackSettings = () => {
  const t = useTranslate()
  const versionInfo = getCurrentAppVersion()
  const providerId = useSettings((state) => state.activeProviderId)
  const provider = useSettings((state) =>
    state.providers.find((item) => item.id === providerId)
  )
  const locale = useSettings((state) => state.locale)

  // 环境信息自动拼进 Issue 正文，减少来回追问
  const envSuffix = useMemo(() => {
    const lines = [
      '',
      '---',
      `App: v${versionInfo.versionName} (${versionInfo.isAndroid ? 'Android' : 'Web'})`,
      `Provider: ${provider?.name ?? providerId ?? 'unknown'}`,
      `Locale: ${locale}`,
    ]
    // 有崩溃记录时一并附上（白屏/异常反馈不再没线索）；注意不泄露隐私内容
    try {
      const crash = localStorage.getItem(CRASH_LOG_KEY)
      if (crash) {
        lines.push('', '**最近一次崩溃**', '```', crash.slice(0, 2000), '```')
      }
    } catch {
      // localStorage 不可用时跳过
    }
    return encodeURIComponent(lines.join('\n'))
  }, [versionInfo, provider, providerId, locale])

  return (
    <>
      <SettingsGroup label={t('feedbackChannelLabel')}>
        <SettingsEntry
          icon={<IconDataOutline16 />}
          title={t('feedbackBugLabel')}
          description={t('feedbackBugDesc')}
          onClick={() =>
            openInBrowser(
              `${REPO_ISSUES}?template=bug_report.md&body=${encodeURIComponent(
                '**环境信息**\n\n'
              )}${envSuffix}`
            )
          }
        />
        <SettingsEntry
          icon={<IconEditOutline16 />}
          title={t('feedbackIdeaLabel')}
          description={t('feedbackIdeaDesc')}
          onClick={() =>
            openInBrowser(
              `${REPO_ISSUES}?template=feature_request.md&body=${encodeURIComponent(
                '**环境信息**\n\n'
              )}${envSuffix}`
            )
          }
        />
        <SettingsEntry
          icon={<IconLinkOutline16 />}
          title={t('feedbackMailLabel')}
          description={t('feedbackMailDesc')}
          onClick={() => openInBrowser(MAILTO)}
        />
      </SettingsGroup>

      <SettingsGroup label={t('feedbackBeforePostLabel')}>
        <div className={styles.cell}>
          <div className={styles.description}>{t('feedbackBeforePostTip')}</div>
        </div>
      </SettingsGroup>
    </>
  )
}
