import clsx from 'clsx'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  IconCheckOutline16,
  IconDarkOutline16,
  IconDataOutline16,
  IconDownloadOutline16,
  IconEditOutline16,
  IconFollowsystemOutline16,
  IconHeartOutline16,
  IconLightOutline16,
  IconLinkOutline16,
  IconRefreshOutline16,
  IconSearchOutline16,
  IconSettingsOutline16,
  IconThinkOutline16,
  IconUploadOutline14,
  IconVolumeOnOutline20,
} from '../base/icons.js'
import {
  BackupError,
  clearHistory,
  exportHistory,
  exportSession,
  importHistory,
} from '../../services/chat/backup.js'
import { signOut, startSignIn, useAccount } from '../../services/account.js'
import { formatBalance, refreshBalance, useBalance } from '../../services/balance.js'
import { useChatStore } from '../../services/chat/store.js'
import { saveBlob } from '../../services/saveFile.js'
import { regionCodes, getRegionName, provinces } from '../../services/location.js'
import {
  FONT_SCALES,
  isChineseBrowser,
  setAutoCheckUpdate,
  setAutoCollapseThinking,
  setAutoCompactContext,
  setFontScale,
  setShowTokenUsage,
  setDailyTokenLimit,
  setLocale,
  setLocation,
  setThemePreference,
  setTokenLimitEnabled,
  setTtsVoice,
  useSettings,
  type ThemePreference,
} from '../../services/settings.js'
import {
  resetDailyTokenUsage,
  syncDailyTokenDate,
  useDailyTokenUsage,
} from '../../services/tokenUsage.js'
import {
  checkForUpdates,
  loadInstalledRelease,
  getCurrentAppVersion,
  openUpdateModal,
  useUpdater,
} from '../../services/updater.js'
import {
  translate,
  useTranslate,
  type TranslationKey,
  type TranslationMessage,
} from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import { ContextUsage } from './ContextUsage.js'
import { FeedbackSettings } from './FeedbackSettings.js'
import { MemorySettings } from './MemorySettings.js'
import { ModelSettings } from './ModelSettings.js'
import { ProviderEditor } from './ProviderEditor.js'
import { SponsorSettings } from './SponsorSettings.js'
import {
  closeSettings,
  closeProviderEditor,
  closeSettingsSection,
  openSettingsSection,
  useSettingsDialog,
  type SettingsSection,
} from './settingsDialogState.js'
import { SettingsEntry, SettingsGroup, SettingsPage } from './SettingsPage.js'
import styles from './Settings.module.css'

/**
 * 璁剧疆寮圭獥锛氬叏灞忚缃〉銆傛墦寮€鏃舵暣椤垫贰鍏ヤ笂娴紝鍏抽棴鏃舵贰鍑轰笅娴紱
 * 涓婚〉涓庡瓙椤典箣闂存槸鍚屼竴涓〉闈㈠疄渚嬶紝鍙湁鍐呭灞傚仛宸﹀彸婊戝姩锛屼笉浼氭暣椤甸噸鎾叆鍦哄姩鐢汇€?
 */
export const SettingsDialog = () => {
  const open = useSettingsDialog((state) => state.open)
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      setClosing(false)
      return
    }
    if (!mounted) {
      return
    }
    // 鍏抽棴鏃跺厛鎾€€鍦哄姩鐢诲啀鍗歌浇锛涚敤鎴峰叧鎺夊姩鏁堟椂鐩存帴鍗歌浇
    if (prefersReducedMotion()) {
      setMounted(false)
      setClosing(false)
      return
    }
    setClosing(true)
    const timer = setTimeout(() => {
      setMounted(false)
      setClosing(false)
    }, SETTINGS_PAGE_EXIT_MS)
    return () => clearTimeout(timer)
  }, [open, mounted])

  return mounted ? <SettingsContent closing={closing} /> : null
}

/** 閫€鍦哄姩鐢绘椂闀匡紝涓?SettingsPage.module.css 閲岀殑 settingsPageExit 淇濇寔涓€鑷?*/
const SETTINGS_PAGE_EXIT_MS = 180

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const sections: {
  value: SettingsSection
  label: TranslationKey
  desc: TranslationKey
  icon: ReactNode
}[] = [
  {
    value: 'general',
    label: 'settingDialogAsideGeneralOptionLabel',
    desc: 'settingEntryGeneralDesc',
    icon: <IconSettingsOutline16 />,
  },
  {
    value: 'model',
    label: 'settingDialogAsideModelOptionLabel',
    desc: 'settingEntryModelDesc',
    icon: <IconThinkOutline16 />,
  },
  {
    value: 'memory',
    label: 'settingDialogAsideMemoryOptionLabel',
    desc: 'settingEntryMemoryDesc',
    icon: <IconEditOutline16 />,
  },
  {
    value: 'data',
    label: 'settingDialogAsideDataOptionLabel',
    desc: 'settingEntryDataDesc',
    icon: <IconDataOutline16 />,
  },
]

/**
 * 璐﹀彿鐧诲綍鍏ュ彛锛氭湭鐧诲綍鏄剧ず銆岀櫥褰?DeepSeek 璐﹀彿銆嶏紝鐧诲綍鍚庢樉绀鸿处鍙峰悕涓庨€€鍑恒€?
 * 鐢ㄧ殑鏄钩鍙?OAuth锛堝拰 DSH 妗岄潰鐗堝悓涓€濂楋級锛宼oken 璧?x-dsh-auth-token 澶淬€?
 */
const AccountSignInEntry = () => {
  const t = useTranslate()
  const token = useAccount((state) => state.token)
  const user = useAccount((state) => state.user)
  const pending = useAccount((state) => state.pending)
  const error = useAccount((state) => state.error)
  // 退出确认弹窗：登录态清掉就要重新走一遍浏览器授权，不能一键误触
  const [confirming, setConfirming] = useState(false)
  // 账号余额：登录后自动查一次，点条目刷新
  const balance = useBalance()
  useEffect(() => {
    if (token) {
      void refreshBalance()
    } else {
      // 退出后清掉余额展示
      useBalance.setState({ loading: false, available: null, info: null, error: null, fetchedAt: null })
    }
  }, [token])

  const balanceText = formatBalance(balance)
  const balanceValue = pending
    ? t('accountSigningIn')
    : token
      ? user?.name || t('accountSignedIn')
      : t('accountTokenInUse')
  const balanceDescription = token
    ? balance.loading
      ? t('accountBalanceLoading')
      : balance.error === 'token_expired'
        ? t('accountTokenInUse')
        : balance.info
          ? t('accountBalanceValue', {
              balance: balanceText ?? '',
              granted: balance.info.grantedBalance.toFixed(2),
            })
          : t('accountBalanceUnavailable')
    : t('accountSignInDesc')

  const onClick = () => {
    if (token) {
      // 点已登录条目 = 刷新余额；长按/编辑语义由确认弹窗承载——先刷新，退出仍走弹窗
      void refreshBalance()
      return
    }
    useAccount.setState({ pending: true, error: null })
    void startSignIn()
      .then((url) => {
        window.open(url, '_blank', 'noopener,noreferrer')
      })
      .catch((err: unknown) => {
        useAccount.setState({
          pending: false,
          error: err instanceof Error ? err.message : String(err),
        })
      })
  }

  const signOutConfirmed = () => {
    setConfirming(false)
    signOut()
    showToast({ key: 'accountSignOut' })
  }

  return (
    <>
      <SettingsEntry
        icon={<IconDataOutline16 />}
        title={token ? t('accountSignedIn') : t('accountSignIn')}
        description={
          error
            ? t('accountSignInFailed', { message: error })
            : balanceDescription
        }
        value={balanceValue}
        onClick={onClick}
      />
      {token ? (
        <div className={styles.accountHint}>{t('accountBalanceHint')}</div>
      ) : null}
      {pending ? (
        <div className={styles.accountHint}>{t('accountSignInHint')}</div>
      ) : null}
      {confirming ? (
        <Modal
          title={t('accountSignOutConfirmTitle')}
          className={styles.importConfirm}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button variant="outlined" size="m" autoFocus onClick={() => setConfirming(false)}>
                {t('cancel')}
              </Button>
              <Button variant="dangerOutlined" size="m" onClick={signOutConfirmed}>
                {t('accountSignOut')}
              </Button>
            </>
          }
        >
          <div className={styles.importConfirmText}>
            {t('accountSignOutConfirmDescription', {
              account: user?.name || t('accountSignedIn'),
            })}
          </div>
        </Modal>
      ) : null}
    </>
  )
}

/**
 * 璁剧疆棣栭〉锛氭寜銆岃处鎴?/ 搴旂敤 / 鍏充簬銆嶅垎缁勭殑鍏ュ彛鍒楄〃銆?
 * 姣忚鍙充晶灞曠ず褰撳墠鍊硷紙璇█銆佸瑙傘€佺増鏈彿绛夛級锛岀偣杩涘幓鏄缁嗚缃€?
 */
const SettingsHomeGroups = ({ open }: { open: (section: SettingsSection) => void }) => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const themePreference = useSettings((state) => state.themePreference)
  const ttsVoice = useSettings((state) => state.ttsVoice)
  const versionInfo = getCurrentAppVersion()
  const latest = useUpdater((state) => state.latest)
  const hasUpdate = useUpdater((state) => state.hasUpdate)

  const themeLabel = t(
    themePreference === 'light'
      ? 'avatarMenuSettingsDialogThemeSelectLightOption'
      : themePreference === 'dark'
        ? 'avatarMenuSettingsDialogThemeSelectDarkOption'
        : 'avatarMenuSettingsDialogThemeSelectSystemOption'
  )
  const localeLabel = t(locale === 'en-US' ? 'settingsLocaleEnUS' : 'settingsLocaleZhCN')
  const voiceLabel = t(ttsVoice === 'tide' ? 'settingsTtsVoiceTide' : 'settingsTtsVoiceStella')

  return (
    <>
      <SettingsGroup label={t('settingsGroupAccountLabel')}>
        <AccountSignInEntry />
        <SettingsEntry
          icon={<IconDataOutline16 />}
          title={t('settingDialogAsideModelOptionLabel')}
          value={t('settingsHomeApiKeyValue')}
          onClick={() => open('model')}
        />
        <SettingsEntry
          icon={<IconEditOutline16 />}
          title={t('settingDialogAsideMemoryOptionLabel')}
          value={t('settingsHomeMemoryValue')}
          onClick={() => open('memory')}
        />
        <SettingsEntry
          icon={<IconDownloadOutline16 />}
          title={t('settingDialogAsideDataOptionLabel')}
          value={t('settingsHomeDataValue')}
          onClick={() => open('data')}
        />
      </SettingsGroup>

      <SettingsGroup label={t('settingsGroupAppLabel')}>
        <SettingsEntry
          icon={<IconLightOutline16 />}
          title={t('settingsAppearanceLabel')}
          value={themeLabel}
          onClick={() => open('appearance')}
        />
        <SettingsEntry
          icon={<IconThinkOutline16 />}
          title={t('settingsChatLabel')}
          description={t('settingsChatDesc')}
          onClick={() => open('chat')}
        />
        <SettingsEntry
          icon={<IconFollowsystemOutline16 />}
          title={t('settingsLocalePreference')}
          value={localeLabel}
          onClick={() => open('language')}
        />
        <SettingsEntry
          icon={<IconVolumeOnOutline20 />}
          title={t('settingsTtsVoice')}
          value={voiceLabel}
          onClick={() => open('voice')}
        />
      </SettingsGroup>

      <SettingsGroup label={t('settingsGroupAboutLabel')}>
        <SettingsEntry
          icon={<IconRefreshOutline16 />}
          title={t('updateSectionLabel')}
          value={
            hasUpdate && latest
              ? t('settingsHomeUpdateAvailable', { version: latest.version })
              : `v${versionInfo.versionName}`
          }
          onClick={() => open('about')}
        />
        <SettingsEntry
          icon={<IconDataOutline16 />}
          title={t('updateAnnouncementEntryLabel')}
          description={t('updateAnnouncementEntryDesc')}
          onClick={() => {
            // 有新版本：直接展示待更新公告；没有新版本：展示「本版更新内容」
            // （2.7.7 前这里装完新版就打不开了，用户永远看不到这一版改了什么）
            if (hasUpdate && latest) {
              openUpdateModal()
            } else {
              void loadInstalledRelease()
            }
          }}
        />
        <SettingsEntry
          icon={<IconLinkOutline16 />}
          title={t('settingsHomeAgreementLabel')}
          onClick={() => open('about')}
        />
        <SettingsEntry
          icon={<IconSearchOutline16 />}
          title={t('settingsHomeHelpLabel')}
          onClick={() => open('feedback')}
        />
        {/* 设置最底层：感谢赞助 */}
        <SettingsEntry
          icon={<IconHeartOutline16 />}
          title={t('sponsorEntryLabel')}
          description={t('sponsorEntryDesc')}
          onClick={() => open('sponsor')}
        />
      </SettingsGroup>
    </>
  )
}

/** 瀛楀彿鍥涙。鐨勬樉绀烘枃妗堬紝涓?FONT_SCALES 涓€涓€瀵瑰簲 */
const FONT_SIZE_LABELS = [
  'settingsFontSizeSmall',
  'settingsFontSizeStandard',
  'settingsFontSizeLarge',
  'settingsFontSizeHuge',
] as const

/**
 * 瀵硅瘽璁剧疆锛氫笂涓嬫枃鐢ㄩ噺 + 鑷姩鍘嬬缉 + 姣忚疆 token 鐢ㄩ噺寮€鍏炽€?
 * 瀵硅瘽閲屼笉鍐嶆樉绀鸿繘搴︽潯锛岄伩鍏嶇敤鎴风洴鐫€鐧惧垎姣斾骇鐢熺劍铏戯紱鎯充簡瑙ｆ椂鐪嬩竴鐪煎嵆鍙€?
 */
const ChatSettings = () => {
  const t = useTranslate()
  const autoCompact = useSettings((state) => state.autoCompactContext)
  const showTokenUsage = useSettings((state) => state.showTokenUsage)

  return (
    <>
      <SettingsGroup label={t('settingsContextUsageTitle')}>
        <ContextUsage />
      </SettingsGroup>

      <SettingsGroup label={t('settingsPersonalizeLabel')}>
        <SettingCell
          label={t('modelSettingsAutoCompactLabel')}
          description={t('modelSettingsAutoCompactDesc')}
          status={null}
          action={
            <button
              type="button"
              role="switch"
              aria-checked={autoCompact}
              aria-label={t('modelSettingsAutoCompactLabel')}
              className={styles.switch}
              onClick={() => setAutoCompactContext(!autoCompact)}
            >
              <span className={styles.switchThumb} />
            </button>
          }
        />
        <SettingCell
          label={t('modelSettingsShowTokenUsageLabel')}
          description={t('settingsShowTokenUsageDesc')}
          status={null}
          action={
            <button
              type="button"
              role="switch"
              aria-checked={showTokenUsage}
              aria-label={t('modelSettingsShowTokenUsageLabel')}
              className={styles.switch}
              onClick={() => setShowTokenUsage(!showTokenUsage)}
            >
              <span className={styles.switchThumb} />
            </button>
          }
        />
      </SettingsGroup>
    </>
  )
}

const AppearanceSettings = () => {
  const t = useTranslate()
  const themePreference = useSettings((state) => state.themePreference)
  const fontScale = useSettings((state) => state.fontScale)
  const autoCollapseThinking = useSettings((state) => state.autoCollapseThinking)
  const showTokenUsage = useSettings((state) => state.showTokenUsage)

  return (
    <>
      <SettingsGroup label={t('settingsAppearanceThemeLabel')}>
        {themeOptions.map((option) => (
          <SettingsEntry
            key={option.value}
            icon={option.icon}
            title={t(option.label)}
            badge={
              themePreference === option.value ? <IconCheckOutline16 /> : undefined
            }
            onClick={() => setThemePreference(option.value)}
          />
        ))}
      </SettingsGroup>

      <SettingsGroup label={t('settingsFontSizeLabel')}>
        <div className={styles.fontSizeCell}>
          <div className={styles.fontSizePreview}>{t('settingsFontSizePreview')}</div>
          <div className={styles.fontSizeHint}>{t('settingsFontSizeHint')}</div>
          <input
            className={styles.fontSizeSlider}
            type="range"
            min={0}
            max={FONT_SCALES.length - 1}
            step={1}
            value={Math.max(0, FONT_SCALES.indexOf(fontScale as (typeof FONT_SCALES)[number]))}
            aria-label={t('settingsFontSizeLabel')}
            onChange={(event) =>
              setFontScale(FONT_SCALES[Number(event.target.value)] ?? 1)
            }
          />
          <div className={styles.fontSizeMarks}>
            {FONT_SCALES.map((scale, index) => (
              <button
                key={scale}
                type="button"
                className={clsx(
                  styles.fontSizeMark,
                  fontScale === scale && styles.fontSizeMarkActive
                )}
                onClick={() => setFontScale(scale)}
              >
                {FONT_SIZE_LABELS[index]
                  ? t(FONT_SIZE_LABELS[index])
                  : t('settingsFontSizeStandard')}
              </button>
            ))}
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup label={t('settingsPersonalizeLabel')}>
        <SettingCell
          label={t('settingsAutoCollapseThinkingLabel')}
          description={t('settingsAutoCollapseThinkingDesc')}
          status={null}
          action={
            <button
              type="button"
              role="switch"
              aria-checked={autoCollapseThinking}
              aria-label={t('settingsAutoCollapseThinkingLabel')}
              className={styles.switch}
              onClick={() => setAutoCollapseThinking(!autoCollapseThinking)}
            >
              <span className={styles.switchThumb} />
            </button>
          }
        />
        <SettingCell
          label={t('modelSettingsShowTokenUsageLabel')}
          description={t('settingsShowTokenUsageDesc')}
          status={null}
          action={
            <button
              type="button"
              role="switch"
              aria-checked={showTokenUsage}
              aria-label={t('modelSettingsShowTokenUsageLabel')}
              className={styles.switch}
              onClick={() => setShowTokenUsage(!showTokenUsage)}
            >
              <span className={styles.switchThumb} />
            </button>
          }
        />
      </SettingsGroup>
    </>
  )
}

/**
 * 供应商编辑子页的承载组件：按 id 从供应商列表里取当前项渲染编辑器。
 * 保存或取消都调 onDone 退回模型页；供应商被删除时直接退出。
 */
const ProviderEditorPage = ({
  providerId,
  onDone,
}: {
  providerId: string
  onDone: () => void
}) => {
  const provider = useSettings((state) =>
    state.providers.find((item) => item.id === providerId)
  )
  if (!provider) {
    // 供应商已不存在（被删除）：退回列表
    onDone()
    return null
  }
  return <ProviderEditor provider={provider} onSaved={onDone} onCancel={onDone} />
}

const SettingsContent = ({ closing }: { closing: boolean }) => {
  const t = useTranslate()
  // 褰撳墠瀛愰〉鐢?store 淇濆瓨锛岃繑鍥為敭涓?Esc 鎵嶈兘閫愮骇杩斿洖
  const opened = useSettingsDialog((state) => state.page)
  // 供应商编辑子页（独立于 page 的一层）：null 表示不在编辑
  const editingProviderId = useSettingsDialog((state) => state.editingProviderId)
  // 璁板綍鍒囨崲鏂瑰悜锛氳繘瀛愰〉浠庡彸渚ф粦鍏ワ紝杩斿洖涓婚〉浠庡乏渚ф粦鍏ャ€?
  // 鐢ㄤ笂涓€娆＄殑 page 鎺ㄥ锛屽畨鍗撹繑鍥為敭璧?store 涔熻兘鎷垮埌姝ｇ‘鏂瑰悜銆?
  // 鍦ㄦ覆鏌撴湡闂寸洿鎺ョ籂姝ｏ紙React 鍏佽鐨勮嚜绾犳鍐欐硶锛夛紝淇濊瘉棣栨鎻愪氦灏卞甫涓婃纭柟鍚戯紝涓嶄細鍏堟挱閿欏啀绾犳銆?
  const previousPage = useRef(opened)
  const previousEditing = useRef<string | null>(null)
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  if (previousPage.current !== opened) {
    previousPage.current = opened
    setDirection(opened === null ? 'back' : 'forward')
  }
  // 编辑子页进/出方向：进入从右滑来，保存/取消/返回键退回时从左滑来
  if (previousEditing.current !== editingProviderId) {
    previousEditing.current = editingProviderId
    setDirection(editingProviderId === null ? 'back' : 'forward')
  }
  const setOpened = (section: SettingsSection | null) => {
    if (section === null) {
      closeSettingsSection()
    } else {
      openSettingsSection(section)
    }
  }
  // 鍒囨崲鍒嗙粍涓嶄涪澶卞鍏ョ姸鎬侊紙API Key 杈撳叆鏀圭敱渚涘簲鍟嗙紪杈戦〉鑷繁绠＄悊锛?
  const historyImport = useHistoryImport()
  const historyDelete = useHistoryDelete()
  const replacingHistory = useChatStore((state) => state.importingHistory)
  const historyBusy = historyImport.busy || historyDelete.busy || replacingHistory

  /**
   * 右上角 ✕：也按层级逐级返回（编辑子页 → 模型页 → 设置主页 → 关闭设置），
   * 只有退到设置主页时才真正关闭整个设置。与返回键/安卓返回键行为一致。
   */
  const close = () => {
    if (historyBusy) {
      return
    }
    const { editingProviderId, page } = useSettingsDialog.getState()
    if (editingProviderId !== null && page !== null) {
      closeProviderEditor()
      return
    }
    if (page !== null) {
      closeSettingsSection()
      return
    }
    closeSettings()
  }

  // 瀛愰〉鏍囬锛氶椤靛叆鍙ｅ垪琛ㄥ彧鍚儴鍒嗗垎缁勶紝appearance 绛夊崟鐙ˉ鏍囬
  const current = opened
    ? (sections.find((item) => item.value === opened) ?? {
        value: opened,
        label:
          opened === 'appearance'
            ? 'settingsAppearanceLabel'
            : opened === 'chat'
              ? 'settingsChatLabel'
              : opened === 'language'
              ? 'settingsLocalePreference'
              : opened === 'voice'
                ? 'settingsTtsVoice'
                : opened === 'about'
                  ? 'updateSectionLabel'
                  : opened === 'feedback'
                    ? 'settingsHomeHelpLabel'
                    : opened === 'sponsor'
                      ? 'sponsorPageTitle'
                      : 'settings',
        desc: 'settingsPageSubtitle',
        icon: null,
      })
    : null

  const renderSection = () => {
    if (opened === 'general') {
      return (
        <>
          <ThemeSetting />
          <LocaleSetting />
          <TtsVoiceSetting />
          <LocationSetting />
          <TokenLimitSetting />
          <UpdateSetting />
        </>
      )
    }
    // 浠庨椤电洿鎺ョ偣杩涙潵鐨勫崟椤硅缃〉锛屽彧鏄剧ず杩欎竴椤癸紝閬垮厤鍜屻€岄€氱敤璁剧疆銆嶉噸澶?
    if (opened === 'chat') {
      return <ChatSettings />
    }
    if (opened === 'language') {
      return <LocaleSetting />
    }
    if (opened === 'voice') {
      return <TtsVoiceSetting />
    }
    if (opened === 'about') {
      return <UpdateSetting />
    }
    if (opened === 'feedback') {
      return <FeedbackSettings />
    }
    if (opened === 'sponsor') {
      return <SponsorSettings />
    }
    if (opened === 'model') {
      return <ModelSettings />
    }
    if (opened === 'appearance') {
      return <AppearanceSettings />
    }
    if (opened === 'memory') {
      return <MemorySettings />
    }
    return (
      <>
        <ImportHistory historyImport={historyImport} disabled={historyBusy} />
        <ExportCurrentSession disabled={historyBusy} />
        <ExportHistory disabled={historyBusy} />
        <SettingCell
          label={t('deleteAllSessions')}
          status={null}
          action={
            <Button
              variant="dangerOutlined"
              size="m"
              className={styles.cellButton}
              disabled={historyBusy}
              onClick={historyDelete.open}
            >
              {t('delete')}
            </Button>
          }
        />
      </>
    )
  }

  return (
    <>
      {current ? (
        opened === 'model' && editingProviderId ? (
          // 供应商编辑子页：独立页面，返回键/Esc/返回按钮都先回到模型页
          <SettingsPage
            title={t('providerEditorPageTitle')}
            onBack={closeProviderEditor}
            onClose={close}
            closing={closing}
            navKey={`provider-${editingProviderId}`}
            direction={direction}
          >
            <ProviderEditorPage providerId={editingProviderId} onDone={closeProviderEditor} />
          </SettingsPage>
        ) : (
          <SettingsPage
            title={t(current.label)}
            onBack={() => setOpened(null)}
            onClose={close}
            closing={closing}
            navKey={current.value}
            direction={direction}
          >
            {renderSection()}
          </SettingsPage>
        )
      ) : (
        <SettingsPage
          title={t('settings')}
          onClose={close}
          closing={closing}
          navKey="home"
          direction={direction}
        >
          <SettingsHomeGroups open={setOpened} />
        </SettingsPage>
      )}
      {historyImport.file ? <ImportConfirm historyImport={historyImport} /> : null}
      {historyDelete.opened ? <DeleteAllConfirm historyDelete={historyDelete} /> : null}
    </>
  )
}

/** 鍒犻櫎纭淇濈暀鍦ㄨ缃箣涓婏紱澶辫触鍙噸璇曪紝鎴愬姛鍙叧闂‘璁ゅ脊绐椼€?*/
const DeleteAllConfirm = ({
  historyDelete,
}: {
  historyDelete: ReturnType<typeof useHistoryDelete>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('deleteAllSessionsModalTitle')}
      className={styles.deleteConfirm}
      onClose={historyDelete.cancel}
      footer={
        <div className={styles.deleteActions} aria-busy={historyDelete.busy}>
          <Button
            variant="outlined"
            autoFocus
            disabled={historyDelete.busy}
            onClick={historyDelete.cancel}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={historyDelete.busy}
            onClick={() => void historyDelete.confirm()}
          >
            {t(historyDelete.busy ? 'historyDeleting' : 'deleteAllSessions')}
          </Button>
        </div>
      }
    >
      {t('deleteAllSessionsModalDescription')}
    </Modal>
  )
}

const TOKEN_PRESETS = [
  { label: '50k', value: 50_000 },
  { label: '100k', value: 100_000 },
  { label: '500k', value: 500_000 },
  { label: '1M', value: 1_000_000 },
]

const TokenLimitSetting = () => {
  const t = useTranslate()
  const tokenLimitEnabled = useSettings((state) => state.tokenLimitEnabled)
  const dailyTokenLimit = useSettings((state) => state.dailyTokenLimit)
  const totalTokens = useDailyTokenUsage((state) => state.totalTokens)
  const inputTokens = useDailyTokenUsage((state) => state.inputTokens)
  const outputTokens = useDailyTokenUsage((state) => state.outputTokens)
  const [limitDraft, setLimitDraft] = useState(String(dailyTokenLimit))

  useEffect(() => {
    syncDailyTokenDate()
  }, [])

  useEffect(() => {
    setLimitDraft(String(dailyTokenLimit))
  }, [dailyTokenLimit])

  const exceeded = tokenLimitEnabled && totalTokens >= dailyTokenLimit
  const commitLimit = () => {
    const n = Number(limitDraft.trim())
    if (Number.isFinite(n) && n >= 1000) {
      setDailyTokenLimit(n)
    } else {
      setLimitDraft(String(dailyTokenLimit))
    }
  }

  return (
    <>
      <SettingCell
        label={t('tokenLimitToggleLabel')}
        description={t('tokenLimitToggleDesc', {
          total: totalTokens.toLocaleString(),
          input: inputTokens.toLocaleString(),
          output: outputTokens.toLocaleString(),
        })}
        status={exceeded ? { key: 'tokenLimitExceededTag', error: true } : null}
        action={
          <div className={styles.fetchRow}>
            {totalTokens > 0 ? (
              <Button
                variant="outlined"
                size="m"
                onClick={() => {
                  resetDailyTokenUsage()
                  showToast({ key: 'tokenLimitResetToast' })
                }}
              >
                {t('tokenLimitResetButton')}
              </Button>
            ) : null}
            <button
              type="button"
              role="switch"
              aria-checked={tokenLimitEnabled}
              aria-label={t('tokenLimitToggleLabel')}
              className={styles.switch}
              onClick={() => setTokenLimitEnabled(!tokenLimitEnabled)}
            >
              <span className={styles.switchThumb} />
            </button>
          </div>
        }
      />
      {tokenLimitEnabled ? (
        <div className={styles.cell}>
          <div className={styles.label}>{t('tokenLimitValueLabel')}</div>
          <div className={styles.description}>{t('tokenLimitValueDesc')}</div>
          <div className={styles.fetchRow}>
            <input
              type="number"
              min={1000}
              step={10000}
              className={clsx(styles.textInput, styles.fetchInput)}
              value={limitDraft}
              onChange={(event) => {
                const raw = event.target.value
                setLimitDraft(raw)
                const n = Number(raw)
                if (Number.isFinite(n) && n >= 1000) {
                  setDailyTokenLimit(n)
                }
              }}
              onBlur={commitLimit}
            />
            <div className={styles.presetRow}>
              {TOKEN_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  className={styles.presetPill}
                  onClick={() => {
                    setDailyTokenLimit(preset.value)
                    setLimitDraft(String(preset.value))
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

const UpdateSetting = () => {
  const t = useTranslate()
  const autoCheckUpdate = useSettings((state) => state.autoCheckUpdate)
  const checking = useUpdater((state) => state.checking)
  const latest = useUpdater((state) => state.latest)
  const versionInfo = getCurrentAppVersion()

  return (
    <>
      <SettingCell
        label={t('updateSectionLabel')}
        description={t('updateCurrentVersion', {
          version: versionInfo.versionName,
          platform: versionInfo.isAndroid ? 'Android' : 'Web',
        })}
        status={null}
        action={
          <div className={styles.fetchRow}>
            <Button
              variant="outlined"
              size="m"
              onClick={() => {
                // 有缓存且有新版本 → 待更新公告；否则拉「本版更新内容」
                // 2.7.7 前装完新版后 latest 为空，这个按钮直接消失，用户看不到公告
                if (latest && useUpdater.getState().hasUpdate) {
                  openUpdateModal()
                } else {
                  void loadInstalledRelease()
                }
              }}
            >
              {t('updateViewAnnouncement')}
            </Button>
            <Button
              variant="outlined"
              size="m"
              className={styles.cellButton}
              disabled={checking}
              onClick={() => void checkForUpdates({ manual: true })}
            >
              {t(checking ? 'updateCheckingButton' : 'updateCheckButton')}
            </Button>
          </div>
        }
      />
      <SettingCell
        label={t('updateAutoCheckLabel')}
        description={t('updateAutoCheckDesc')}
        status={null}
        action={
          <button
            type="button"
            role="switch"
            aria-checked={autoCheckUpdate}
            aria-label={t('updateAutoCheckLabel')}
            className={styles.switch}
            onClick={() => setAutoCheckUpdate(!autoCheckUpdate)}
          >
            <span className={styles.switchThumb} />
          </button>
        }
      />
    </>
  )
}

const useHistoryDelete = () => {
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const deleting = useRef(false)

  const confirm = async () => {
    if (deleting.current) {
      return
    }
    deleting.current = true
    setBusy(true)
    try {
      await clearHistory()
      setOpened(false)
      showToast({ key: 'historyDeleted' })
    } catch {
      showToast({ key: 'historyDeleteFailed', type: 'error' })
    } finally {
      deleting.current = false
      setBusy(false)
    }
  }

  return {
    opened,
    busy,
    open: () => setOpened(true),
    cancel: () => {
      if (!deleting.current) {
        setOpened(false)
      }
    },
    confirm,
  }
}

const LocationSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const location = useSettings((state) => state.location)
  const province =
    location?.region === 'CN'
      ? provinces.find((item) => item.code === location.province)
      : undefined

  return (
    <SettingCell
      label={t('settingsLocation')}
      status={null}
      className={styles.locationCell}
      action={
        <div className={styles.locationSelectors}>
          {isChineseBrowser() ? (
            <>
              <Select
                ariaLabel={t('settingsLocationProvince')}
                className={styles.provinceSelect}
                value={province?.code ?? ''}
                placeholder={t('settingsLocationProvince')}
                options={provinces.map((item) => ({ value: item.code, label: item.name }))}
                onChange={(value) => {
                  if (value !== province?.code) {
                    setLocation({ region: 'CN', province: value })
                  }
                }}
              />
              <Select
                ariaLabel={t('settingsLocationCity')}
                className={styles.citySelect}
                value={province ? (location?.city ?? '') : ''}
                disabled={!province?.cities.length}
                placeholder={t('settingsLocationCity')}
                options={
                  province?.cities.map((item) => ({ value: item.code, label: item.name })) ?? []
                }
                onChange={(value) => {
                  if (province) {
                    setLocation({ region: 'CN', province: province.code, city: value })
                  }
                }}
              />
            </>
          ) : (
            <Select
              ariaLabel={t('settingsLocationRegion')}
              className={styles.regionSelect}
              value={location?.region ?? ''}
              placeholder={t('settingsLocationRegion')}
              options={regionCodes
                .map((code) => ({ value: code, label: getRegionName(code, locale) }))
                .sort((a, b) => a.label.localeCompare(b.label, locale))}
              onChange={(value) => setLocation({ region: value })}
            />
          )}
        </div>
      }
    />
  )
}

const LocaleSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  return (
    <SettingCell
      label={t('settingsLocalePreference')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsLocalePreference')}
          value={locale}
          options={[
            { value: 'zh-CN', label: t('settingsLocaleZhCN'), lang: 'zh-CN' },
            { value: 'en-US', label: t('settingsLocaleEnUS'), lang: 'en' },
          ]}
          onChange={setLocale}
        />
      }
    />
  )
}

/** 鏈楄闊宠壊锛歴tella锛堟捣鏄燂紝濂冲０锛? tide锛堟殫娼紝鐢峰０锛?*/
const TtsVoiceSetting = () => {
  const t = useTranslate()
  const ttsVoice = useSettings((state) => state.ttsVoice)
  return (
    <SettingCell
      label={t('settingsTtsVoice')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsTtsVoice')}
          value={ttsVoice}
          options={[
            { value: 'stella', label: t('settingsTtsVoiceStella') },
            { value: 'tide', label: t('settingsTtsVoiceTide') },
          ]}
          onChange={setTtsVoice}
        />
      }
    />
  )
}

/** 瑕嗙洊瀵煎叆鐨勪簩娆＄‘璁わ紝鍙犲湪璁剧疆寮圭獥涓?*/
const ImportConfirm = ({
  historyImport,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('historyImportConfirmTitle')}
      className={styles.importConfirm}
      onClose={historyImport.cancel}
      footer={
        <>
          <Button variant="outlined" size="m" autoFocus onClick={historyImport.cancel}>
            {t('cancel')}
          </Button>
          <Button variant="dangerOutlined" size="m" onClick={() => void historyImport.confirm()}>
            {t('historyImportConfirm')}
          </Button>
        </>
      }
    >
      <div className={styles.importConfirmText}>{t('historyImportConfirmDescription')}</div>
    </Modal>
  )
}

const themeOptions: { value: ThemePreference; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'light',
    label: 'avatarMenuSettingsDialogThemeSelectLightOption',
    icon: <IconLightOutline16 />,
  },
  {
    value: 'dark',
    label: 'avatarMenuSettingsDialogThemeSelectDarkOption',
    icon: <IconDarkOutline16 />,
  },
  {
    value: 'system',
    label: 'avatarMenuSettingsDialogThemeSelectSystemOption',
    icon: <IconFollowsystemOutline16 />,
  },
]

/**
 * 涓婚椤癸細鏍囬涓嬫柟娴呰壊 / 娣辫壊 / 璺熼殢绯荤粺涓変釜閫夊潡銆?
 * 涓庝笅鏂硅瑷€閫夐」杩炵画鎺掑垪銆?
 */
const ThemeSetting = () => {
  const t = useTranslate()
  const themePreference = useSettings((state) => state.themePreference)
  const label = t('avatarMenuSettingsDialogThemeItemLabel')
  return (
    <div className={styles.theme}>
      {label}
      <div role="radiogroup" aria-label={label} className={styles.themeOptions}>
        {themeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={themePreference === option.value}
            className={clsx(
              styles.themeOption,
              themePreference === option.value && styles.themeOptionSelected
            )}
            onClick={() => setThemePreference(option.value)}
          >
            {option.icon}
            {t(option.label)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** `reason` 涓哄け璐ュ師鍥犵殑鏂囨 key锛屽睍绀烘椂鎸夊綋鍓嶈瑷€缈昏瘧鍚庡～鍏?`message` 鍙傛暟銆?*/
type Status = (TranslationMessage & { error?: boolean; reason?: TranslationKey }) | null

/** 瀵煎嚭澶辫触闄勫甫鍘熷洜锛氶鏈熺殑閿欒鐢ㄥ搴旀枃妗堜綔鍘熷洜锛屽叾浠栭敊璇敤閿欒淇℃伅銆?*/
const errorStatus = (key: TranslationKey, error: unknown): Status => ({
  key,
  ...(error instanceof BackupError
    ? { reason: error.key }
    : { params: { message: error instanceof Error ? error.message : String(error) } }),
  error: true,
})

const SettingCell = ({
  label,
  description,
  status,
  action,
  className,
}: {
  label: string
  description?: string
  status: Status
  action: ReactNode
  className?: string
}) => {
  const t = useTranslate()
  return (
    <div className={clsx(styles.cell, styles.row, className)}>
      <div className={styles.text}>
        <div className={styles.label}>{label}</div>
        {status || description ? (
          <div className={clsx(styles.description, status?.error && styles.error)}>
            {status
              ? t(status.key, status.reason ? { message: t(status.reason) } : status.params)
              : description}
          </div>
        ) : null}
      </div>
      {action}
    </div>
  )
}

/** 閫夋枃浠跺悗鍏堟彁绀鸿鐩栵紱纭鍚庢墠妫€鏌ユ枃浠跺苟鎵ц瀵煎叆锛屽疄鏃跺睍绀鸿繘搴﹀苟鍙嶉鍏蜂綋閿欒銆?*/
const useHistoryImport = () => {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const importing = useRef(false)

  const confirm = async () => {
    if (!file || importing.current) {
      return
    }
    importing.current = true
    setFile(null)
    setBusy(true)
    setStatus({ key: 'historyImporting', params: { count: 0 } })
    try {
      const count = await importHistory(file, (parsedCount) => {
        if (parsedCount <= 10 || parsedCount % 10 === 0) {
          setStatus({ key: 'historyImporting', params: { count: parsedCount } })
        }
      })
      const successStatus: Status = {
        key: count === 1 ? 'historyImportedOne' : 'historyImported',
        params: { count },
      }
      setStatus(successStatus)
      showToast(successStatus)
    } catch (error) {
      const failed = errorStatus('historyImportReasonFailed', error)
      setStatus(failed)
      showToast({
        type: 'error',
        key: 'historyImportReasonFailed',
        params: {
          message:
            error instanceof BackupError
              ? translate(error.key)
              : error instanceof Error
                ? error.message
                : String(error),
        },
      })
    } finally {
      importing.current = false
      setBusy(false)
    }
  }

  return { file, busy, status, select: setFile, cancel: () => setFile(null), confirm }
}

/** 瀵煎叆 = 瑕嗙洊锛氱敤閫変腑鏂囦欢鏇挎崲鏈湴鍏ㄩ儴浼氳瘽涓庨檮浠躲€?*/
const ImportHistory = ({
  historyImport,
  disabled,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
  disabled: boolean
}) => {
  const t = useTranslate()
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <SettingCell
      label={t('historyImport')}
      description={t('historyImportDescription')}
      status={historyImport.status}
      action={
        <>
          <Button
            variant="outlined"
            size="m"
            className={clsx(styles.cellButton, styles.uploadButton)}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <IconUploadOutline14 />
            {t(historyImport.busy ? 'historyImportingButton' : 'upload')}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) {
                historyImport.select(file)
              }
            }}
          />
        </>
      }
    />
  )
}

/** 灏嗗叏閮ㄤ細璇濆強鍥剧墖瀵煎嚭涓?ZIP 鏂囦欢骞朵笅杞?*/
const ExportHistory = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const empty = useChatStore((state) => state.sessions.length === 0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  const onExport = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const { name, blob } = await exportHistory()
      // Android WebView 里 <a download> 对 blob: URL 不生效，saveBlob 会改走原生桥接落盘
      const saved = await saveBlob(name, blob)
      if (!saved.ok) {
        setStatus({ key: 'historyExportSaveFailed', error: true })
        return
      }
      showToast({ key: 'historyExportSaved', params: { name: saved.location || name } })
    } catch (error) {
      setStatus(errorStatus('historyExportFailed', error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingCell
      label={t('exportAllLabel')}
      description={t('historyExportDescription')}
      status={status}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={disabled || busy || empty}
          onClick={() => void onExport()}
        >
          <IconDownloadOutline16 />
          {t('exportAllDownload')}
        </Button>
      }
    />
  )
}

/**
 * 导出当前对话（v2.7.7）。
 * 与「导出全部」同格式，只是只装一个会话，导入后照样能接着聊。
 */
const ExportCurrentSession = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const activeId = useChatStore((state) => state.activeId)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  const onExport = async () => {
    if (!activeId) {
      return
    }
    setBusy(true)
    setStatus(null)
    try {
      const { name, blob } = await exportSession(activeId)
      const saved = await saveBlob(name, blob)
      if (!saved.ok) {
        setStatus({ key: 'historyExportSaveFailed', error: true })
        return
      }
      showToast({ key: 'historyExportSaved', params: { name: saved.location || name } })
    } catch (error) {
      setStatus(errorStatus('historyExportFailed', error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingCell
      label={t('exportSessionLabel')}
      description={activeId ? t('exportSessionDescription') : t('exportSessionEmpty')}
      status={status}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={disabled || busy || !activeId}
          onClick={() => void onExport()}
        >
          <IconDownloadOutline16 />
          {t('exportSessionDownload')}
        </Button>
      }
    />
  )
}
