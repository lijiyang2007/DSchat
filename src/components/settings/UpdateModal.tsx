import { useTranslate } from '../../i18n/index.js'
import {
  cancelUpdateDownload,
  discardDownloadedApk,
  dismissUpdateModal,
  getCurrentAppVersion,
  installDownloadedApk,
  openReleaseInBrowser,
  retryPendingAndroidInstall,
  skipReleaseVersion,
  startUpdateInstall,
  useUpdater,
} from '../../services/updater.js'
import { useSettings } from '../../services/settings.js'
import { parseVersion } from '../../services/versioning.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Markdown } from '../markdown/Markdown.js'
import styles from './UpdateModal.module.css'

const formatMb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1)

/** 版本更新公告弹窗：展示更新日志与包大小，让用户自主选择立即更新、留用当前版本或跳过该版本 */
export const UpdateModal = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const open = useUpdater((state) => state.modalOpen)
  const latest = useUpdater((state) => state.latest)
  const installedRelease = useUpdater((state) => state.installedRelease)
  const hasUpdate = useUpdater((state) => state.hasUpdate)
  const download = useUpdater((state) => state.download)

  if (!open || !latest) {
    return null
  }

  const current = getCurrentAppVersion()
  // 没有新版本时展示的是「本版更新内容」：正文取 installedRelease，避免把
  // 更高版本的公告错当成当前版本的内容
  const showingInstalled = !hasUpdate && Boolean(installedRelease)
  const shown = showingInstalled ? installedRelease ?? latest : latest
  // 版本通道：两段=正式版，三段=测试版（规则见 services/versioning.ts）
  const latestChannel = parseVersion(shown.version)?.channel ?? null
  const publishedText = shown.publishedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(shown.publishedAt))
    : ''
  const downloading = download.status === 'downloading'
  // 缓存里已经有下好的包：直接装，不再重下
  const readyToInstall = !downloading && download.hasDownloadedFile
  const canInstallInApp = current.isAndroid && Boolean(latest.apkUrl)

  return (
    <Modal
      title={
        showingInstalled
          ? t('updateInstalledNotesTitle', { version: shown.version })
          : t('updateModalTitle', { version: latest.version })
      }
      // 始终可关闭：下载卡住时不能把用户锁死在弹窗里
      closable
      className={styles.modal}
      onClose={dismissUpdateModal}
      footer={
        <div className={styles.footer}>
          {hasUpdate ? (
            <Button
              variant="outlined"
              size="m"
              onClick={() => skipReleaseVersion(latest.version)}
            >
              {t('updateActionSkip')}
            </Button>
          ) : null}
          <div className={styles.footerRight}>
            <Button variant="outlined" size="m" onClick={dismissUpdateModal}>
              {downloading
                ? t('updateActionCancelDownload')
                : hasUpdate
                  ? t('updateActionLater')
                  : t('close')}
            </Button>
            {hasUpdate ? (
              <Button
                variant="primary"
                size="m"
                disabled={downloading}
                onClick={readyToInstall ? () => installDownloadedApk() : startUpdateInstall}
              >
                {!canInstallInApp
                  ? t('updateActionOpenRelease')
                  : readyToInstall
                    ? t('updateActionInstallDownloaded')
                    : t('updateActionInstall')}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="m"
                onClick={() => openReleaseInBrowser(latest.htmlUrl)}
              >
                {t('updateActionOpenRelease')}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className={styles.metaRow}>
        <span className={styles.versionBadge}>
          {showingInstalled
            ? `v${shown.version}`
            : `v${current.versionName} → v${latest.version}`}
        </span>
        {latestChannel ? (
          <span className={styles.metaText}>
            {latestChannel === 'release'
              ? t('updateChannelRelease')
              : t('updateChannelTest')}
          </span>
        ) : null}
        {publishedText ? (
          <span className={styles.metaText}>{t('updatePublishedAt', { date: publishedText })}</span>
        ) : null}
        {shown.apkSize && !showingInstalled ? (
          <span className={styles.metaText}>
            {t('updatePackageSize', { size: formatMb(shown.apkSize) })}
          </span>
        ) : null}
      </div>

      <div className={styles.notesTitle}>{t('updateAnnouncementTitle')}</div>
      <div className={styles.notesBox}>
        {shown.body ? (
          <Markdown
            content={shown.body}
            loading={false}
            cacheKey={`release-${shown.tagName}`}
            disableLink={false}
          />
        ) : (
          <div className={styles.notesEmpty}>{t('updateNoNotes')}</div>
        )}
      </div>

      {download.status !== 'idle' ? (
        <div className={styles.progressBox}>
          {download.status === 'downloading' ? (
            <>
              <div className={styles.progressText}>
                {download.total > 0
                  ? t('updateDownloading', {
                      progress: download.progress,
                      downloaded: formatMb(download.downloaded),
                      total: formatMb(download.total),
                    })
                  : t('updateDownloadingUnknown', { downloaded: formatMb(download.downloaded) })}
              </div>
              {download.total > 0 ? (
                <div className={styles.progressTrack}>
                  <div className={styles.progressFill} style={{ width: `${download.progress}%` }} />
                </div>
              ) : null}
            </>
          ) : download.status === 'installing' ? (
            <div className={styles.progressText}>{t('updateInstalling')}</div>
          ) : download.status === 'permission_required' ? (
            <>
              <div className={styles.errorText}>{t('updatePermissionRequired')}</div>
              <div className={styles.inlineActions}>
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={retryPendingAndroidInstall}
                >
                  {t('updateRetryInstall')}
                </button>
              </div>
            </>
          ) : (
            <div className={styles.errorText}>{download.error}</div>
          )}
          <div className={styles.inlineActions}>
            {downloading ? (
              <button type="button" className={styles.linkButton} onClick={cancelUpdateDownload}>
                {t('updateActionCancelDownload')}
              </button>
            ) : null}
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => openReleaseInBrowser(latest.apkUrl ?? latest.htmlUrl)}
            >
              {t('updateOpenInBrowser')}
            </button>
          </div>
        </div>
      ) : null}

      {/* 包已经下好、当前没在下载：提示不必重下，直接安装即可 */}
      {download.status === 'idle' && readyToInstall ? (
        <div className={styles.progressBox}>
          <div className={styles.progressText}>{t('updateDownloadedReady')}</div>
          <div className={styles.inlineActions}>
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => installDownloadedApk()}
            >
              {t('updateActionInstallDownloaded')}
            </button>
            <button type="button" className={styles.linkButton} onClick={discardDownloadedApk}>
              {t('updateActionRedownload')}
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}
