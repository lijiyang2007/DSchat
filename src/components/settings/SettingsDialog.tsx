import clsx from 'clsx'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  IconCheckOutline16,
  IconDarkOutline16,
  IconDataOutline16,
  IconDownloadOutline16,
  IconEditOutline16,
  IconFollowsystemOutline16,
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
  importHistory,
} from '../../services/chat/backup.js'
import { useIsMobile } from '../../app/viewport.js'
import { useChatStore } from '../../services/chat/store.js'
import { regionCodes, getRegionName, provinces } from '../../services/location.js'
import {
  FONT_SCALES,
  isChineseBrowser,
  setAutoCheckUpdate,
  setAutoCollapseThinking,
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
import { useApiKeyEditor } from './ApiKeyField.js'
import { MemorySettings } from './MemorySettings.js'
import { ModelSettings } from './ModelSettings.js'
import {
  closeSettings,
  closeSettingsSection,
  openSettingsSection,
  useSettingsDialog,
  type SettingsSection,
} from './settingsDialogState.js'
import { SettingsEntry, SettingsGroup, SettingsPage } from './SettingsPage.js'
import styles from './Settings.module.css'

/**
 * 设置弹窗：分「通用设置」（主题、语言、朗读音色、位置）与「数据管理」（API Key、导入、导出、删除）。
 * 桌面端为居中弹窗、左侧导航；移动端为底部弹层、导航横排在内容上方
 */
export const SettingsDialog = () => {
  const open = useSettingsDialog((state) => state.open)
  return open ? <SettingsContent /> : null
}

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
 * 设置首页：按「账户 / 应用 / 关于」分组的入口列表。
 * 每行右侧展示当前值（语言、外观、版本号等），点进去是详细设置。
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
          icon={<IconFollowsystemOutline16 />}
          title={t('settingsLocalePreference')}
          value={localeLabel}
          onClick={() => open('general')}
        />
        <SettingsEntry
          icon={<IconVolumeOnOutline20 />}
          title={t('settingsTtsVoice')}
          value={voiceLabel}
          onClick={() => open('general')}
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
          onClick={() => open('general')}
        />
        <SettingsEntry
          icon={<IconLinkOutline16 />}
          title={t('settingsHomeAgreementLabel')}
          onClick={() => open('general')}
        />
        <SettingsEntry
          icon={<IconSearchOutline16 />}
          title={t('settingsHomeHelpLabel')}
          onClick={() => open('general')}
        />
      </SettingsGroup>
    </>
  )
}

/** 字号四档的显示文案，与 FONT_SCALES 一一对应 */
const FONT_SIZE_LABELS = [
  'settingsFontSizeSmall',
  'settingsFontSizeStandard',
  'settingsFontSizeLarge',
  'settingsFontSizeHuge',
] as const

/**
 * 外观子页：主题三选一 + 字体大小滑块（实时预览）+ 个性化开关。
 * 字体大小直接改根元素的 --ds-font-scale，改完立刻生效。
 */
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

const SettingsContent = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  // 当前子页由 store 保存，返回键与 Esc 才能逐级返回
  const opened = useSettingsDialog((state) => state.page)
  const setOpened = (section: SettingsSection | null) => {
    if (section === null) {
      closeSettingsSection()
    } else {
      openSettingsSection(section)
    }
  }
  // 切换分组不丢失正在输入的 API Key 与导入状态
  const apiKeyEditor = useApiKeyEditor()
  const historyImport = useHistoryImport()
  const historyDelete = useHistoryDelete()
  const replacingHistory = useChatStore((state) => state.importingHistory)
  const historyBusy = historyImport.busy || historyDelete.busy || replacingHistory

  const close = () => {
    if (!historyBusy) {
      closeSettings()
    }
  }

  // 子页标题：首页入口列表只含部分分组，appearance 等单独补标题
  const current = opened
    ? (sections.find((item) => item.value === opened) ?? {
        value: opened,
        label: opened === 'appearance' ? 'settingsAppearanceLabel' : 'settings',
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
    if (opened === 'model') {
      return <ModelSettings apiKeyEditor={apiKeyEditor} isMobile={isMobile} />
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
        <SettingsPage title={t(current.label)} onBack={() => setOpened(null)} onClose={close}>
          {renderSection()}
        </SettingsPage>
      ) : (
        <SettingsPage title={t('settings')} onClose={close}>
          <SettingsHomeGroups open={setOpened} />
        </SettingsPage>
      )}
      {historyImport.file ? <ImportConfirm historyImport={historyImport} /> : null}
      {historyDelete.opened ? <DeleteAllConfirm historyDelete={historyDelete} /> : null}
    </>
  )
}

/** 删除确认保留在设置之上；失败可重试，成功只关闭确认弹窗。 */
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
            {latest ? (
              <Button variant="outlined" size="m" onClick={openUpdateModal}>
                {t('updateViewAnnouncement')}
              </Button>
            ) : null}
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

/** 朗读音色：stella（海星，女声）/ tide（暗潮，男声） */
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

/** 覆盖导入的二次确认，叠在设置弹窗上 */
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
 * 主题项：标题下方浅色 / 深色 / 跟随系统三个选块。
 * 与下方语言选项连续排列。
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

/** `reason` 为失败原因的文案 key，展示时按当前语言翻译后填入 `message` 参数。 */
type Status = (TranslationMessage & { error?: boolean; reason?: TranslationKey }) | null

/** 导出失败附带原因：预期的错误用对应文案作原因，其他错误用错误信息。 */
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

/** 选文件后先提示覆盖；确认后才检查文件并执行导入，实时展示进度并反馈具体错误。 */
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

/** 导入 = 覆盖：用选中文件替换本地全部会话与附件。 */
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

/** 将全部会话及图片导出为 ZIP 文件并下载 */
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
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
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
