import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { setSpeechApiKey, speechApiKey } from '../../services/api/speech.js'
import {
  DEFAULT_SYSTEM_PROMPT,
  resetModelAndPolicySettings,
  setAllowEditAssistant,
  setAllowRefusedContext,
  setApiKey,
  setApiOrigin,
  setAutoTitle,
  setChatProtocol,
  setCustomHeaders,
  setKeepRefusedContent,
  setMaxTokens,
  setModel,
  setReadUrl,
  setRefusalCaseSensitive,
  setRefusalEnabled,
  setRefusalKeywords,
  setRefusalMessage,
  setSafetyCheck,
  setSendLatestReminder,
  setSystemPrompt,
  setTemperature,
  setTopP,
  useSettings,
  type ChatProtocol,
} from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { openProviderEditor } from './settingsDialogState.js'
import { ProviderList } from './ProviderList.js'
import styles from './Settings.module.css'

/**
 * 语音 API Key 输入框。
 *
 * 官方 /v1/tools/asr|tts 只认 `Authorization: Bearer <API Key>`，
 * 账号登录的 x-dsh-auth-token 会被直接 401，所以语音必须单独配一把 Key。
 */
const SpeechKeyCell = () => {
  const t = useTranslate()
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState(() => speechApiKey().length > 0)

  const save = () => {
    const key = value.trim()
    if (!key) {
      return
    }
    setSpeechApiKey(key)
    setValue('')
    setSaved(true)
  }

  const clear = () => {
    setSpeechApiKey('')
    setValue('')
    setSaved(false)
  }

  return (
    <div className={styles.cell}>
      <div className={styles.field}>
        <div className={styles.label}>{t('speechApiKeyLabel')}</div>
        <div className={styles.description}>{t('speechApiKeyDescription')}</div>
        <div className={styles.apiKeyInput}>
          <input
            type="password"
            placeholder={t('speechApiKeyPlaceholder')}
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                save()
              }
            }}
          />
          {value.trim() ? (
            <button type="button" className={styles.confirm} onClick={save}>
              {t('confirm')}
            </button>
          ) : null}
        </div>
        {saved ? (
          <div className={styles.description}>
            <span className={styles.apiKeyMask}>{'*'.repeat(24)}</span>
            <button type="button" className={styles.linkAction} onClick={clear}>
              {t('delete')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export const ToggleSwitch = ({
  checked,
  ariaLabel,
  onChange,
}: {
  checked: boolean
  ariaLabel: string
  onChange: (next: boolean) => void
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    className={styles.switch}
    onClick={() => onChange(!checked)}
  >
    <span className={styles.switchThumb} />
  </button>
)

export const ToggleCell = ({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (next: boolean) => void
}) => (
  <div className={`${styles.cell} ${styles.row}`}>
    <div className={styles.text}>
      <div className={styles.label}>{label}</div>
      {description ? <div className={styles.description}>{description}</div> : null}
    </div>
    <ToggleSwitch checked={checked} ariaLabel={label} onChange={onChange} />
  </div>
)

export const NumberParamInput = ({
  label,
  value,
  placeholder,
  step,
  min,
  max,
  integer = false,
  onChange,
}: {
  label: string
  value: number | null
  placeholder: string
  step: string
  min?: number
  max?: number
  integer?: boolean
  onChange: (next: number | null) => void
}) => {
  const [draft, setDraft] = useState(value === null ? '' : String(value))

  useEffect(() => {
    setDraft(value === null ? '' : String(value))
  }, [value])

  const commit = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) {
      onChange(null)
      setDraft('')
      return
    }
    const parsed = integer ? Number.parseInt(trimmed, 10) : Number(trimmed)
    if (!Number.isFinite(parsed)) {
      setDraft(value === null ? '' : String(value))
      return
    }
    const clamped =
      min !== undefined && parsed < min ? min : max !== undefined && parsed > max ? max : parsed
    onChange(clamped)
    setDraft(String(clamped))
  }

  return (
    <label className={styles.paramItem}>
      {label ? <span className={styles.paramLabel}>{label}</span> : null}
      <input
        type="number"
        className={styles.textInput}
        placeholder={placeholder}
        step={step}
        min={min}
        max={max}
        value={draft}
        onChange={(event) => {
          const raw = event.target.value
          setDraft(raw)
          const trimmed = raw.trim()
          if (!trimmed) {
            onChange(null)
            return
          }
          const parsed = integer ? Number.parseInt(trimmed, 10) : Number(trimmed)
          if (Number.isFinite(parsed)) {
            if ((min === undefined || parsed >= min) && (max === undefined || parsed <= max)) {
              onChange(parsed)
            }
          }
        }}
        onBlur={() => commit(draft)}
      />
    </label>
  )
}

/** 解析 TOML / JSON 渠道配置片段（如 base_url、model、wire_api、bearer_token、http_headers） */
const applyConfigSnippet = (raw: string): boolean => {
  const trimmed = raw.trim()
  if (!trimmed) {
    return false
  }
  const matchTomlString = (key: string): string | null => {
    const re = new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, 'm')
    return re.exec(trimmed)?.[1]?.trim() ?? null
  }

  let baseUrl = matchTomlString('base_url') ?? matchTomlString('api_base')
  let model = matchTomlString('model')
  let wireApi = matchTomlString('wire_api')
  let token =
    matchTomlString('experimental_bearer_token') ??
    matchTomlString('bearer_token') ??
    matchTomlString('api_key')
  let headersRaw = ''
  const headersMatch = /^\s*http_headers\s*=\s*(\{[^}]*\})/m.exec(trimmed)
  if (headersMatch?.[1]) {
    // 把 TOML 内联表 `{"k" = "v"}` 转成 `k: v` 行格式
    const pairs: string[] = []
    const pairRe = /["']([^"']+)["']\s*[:=]\s*["']([^"']+)["']/g
    for (const m of headersMatch[1].matchAll(pairRe)) {
      pairs.push(`${m[1]}: ${m[2]}`)
    }
    if (pairs.length > 0) {
      headersRaw = pairs.join('\n')
    }
  }


  if (trimmed.startsWith('{')) {
    try {
      const json = JSON.parse(trimmed) as Record<string, unknown>
      if (typeof json.base_url === 'string') {
        baseUrl = json.base_url
      }
      if (typeof json.model === 'string') {
        model = json.model
      }
      if (typeof json.wire_api === 'string') {
        wireApi = json.wire_api
      }
      if (typeof json.experimental_bearer_token === 'string') {
        token = json.experimental_bearer_token
      } else if (typeof json.api_key === 'string') {
        token = json.api_key
      }
      if (typeof json.http_headers === 'object' && json.http_headers !== null) {
        headersRaw = JSON.stringify(json.http_headers)
      }
    } catch {
      // 忽略无效 JSON
    }
  }

  if (!baseUrl && !model && !wireApi && !token && !headersRaw) {
    return false
  }

  const nextProtocol: ChatProtocol =
    wireApi === 'responses' ? 'responses' : wireApi ? 'openai' : baseUrl ? 'openai' : 'deepseek'
  setChatProtocol(nextProtocol)
  if (baseUrl) {
    setApiOrigin(baseUrl)
  }
  if (model) {
    setModel(model)
  }
  if (token) {
    setApiKey(token)
  }
  if (headersRaw) {
    setCustomHeaders(headersRaw)
  }
  return true
}

/**
 * 模型与接口设置。
 *
 * v2.9.2：上一版把「协议 / API 地址 / 模型 / 上下文窗口 / 思考强度 / 图片识别能力 /
 * 流式输出档位 / 上下文自动压缩」8 项都塞了进来。这些都跟着具体供应商/模型走，
 * 放在全局页里既会串（换供应商不跟着变），第三方也没法单独配。
 * 现在它们全部挪进**供应商编辑页**（或对话设置），这里只留与供应商无关的公共项。
 */
export const ModelSettings = () => {
  const t = useTranslate()
  const settings = useSettings()
  const [snippetOpen, setSnippetOpen] = useState(false)
  const [snippetText, setSnippetText] = useState('')
  const [snippetStatus, setSnippetStatus] = useState<{ text: string; error?: boolean } | null>(null)

  return (
    <>
      <div className={styles.groupTitle}>{t('modelSettingsSectionRequest')}</div>

      {/* 供应商列表：点「编辑」进独立子页，保存/取消后返回这里 */}
      <div className={styles.cell}>
        <div className={styles.providerIntro}>{t('providerListHint')}</div>
        <ProviderList onEdit={openProviderEditor} />
      </div>

      {/*
        v2.9.2：本页只留「与具体供应商无关」的公共项。
        「接口类型 / API 地址 / 模型 / 思考程度 / 模型上下文窗口 / 图片识别能力 /
        流式输出档位 / 上下文自动压缩」8 项全部移出本页：
        - 前 4 项 + 上下文窗口 + 识图 → 供应商编辑页（跟着供应商/模型走，换供应商不会串）
        - 流式输出档位 → 功能仍在（streamThrottle 生效于 useThrottleMarkdownRender），本版暂不设入口
        - 上下文自动压缩 → 只保留「对话设置」里那一份，避免两处开关打架
      */}
      <div className={styles.cell}>
        <div className={styles.field}>
          <div className={styles.fieldHeader}>
            <span className={styles.description}>{t('importSnippetToggle')}</span>
            <button
              type="button"
              className={styles.linkAction}
              onClick={() => {
                setSnippetOpen((prev) => !prev)
                setSnippetStatus(null)
              }}
            >
              {snippetOpen ? t('cancel') : t('importSnippetToggle')}
            </button>
          </div>
          {snippetOpen ? (
            <>
              <textarea
                className={styles.textareaInput}
                placeholder={t('importSnippetPlaceholder')}
                spellCheck={false}
                value={snippetText}
                onChange={(event) => setSnippetText(event.target.value)}
              />
              <div className={styles.errorRow}>
                {snippetStatus ? (
                  <span className={snippetStatus.error ? styles.error : styles.fetchHint}>
                    {snippetStatus.text}
                  </span>
                ) : (
                  <span />
                )}
                <Button
                  size="s"
                  disabled={!snippetText.trim()}
                  onClick={() => {
                    if (applyConfigSnippet(snippetText)) {
                      setSnippetStatus({ text: t('importSnippetSuccess') })
                      setSnippetText('')
                    } else {
                      setSnippetStatus({ text: t('importSnippetEmpty'), error: true })
                    }
                  }}
                >
                  {t('importSnippetApply')}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div className={styles.cell}>
        <div className={styles.field}>
          <div className={styles.fieldHeader}>
            <div className={styles.label}>{t('modelSettingsSystemPromptLabel')}</div>
            {settings.systemPrompt !== DEFAULT_SYSTEM_PROMPT ? (
              <button
                type="button"
                className={styles.linkAction}
                onClick={() => setSystemPrompt(DEFAULT_SYSTEM_PROMPT)}
              >
                {t('modelSettingsRestoreDefault')}
              </button>
            ) : null}
          </div>
          <div className={styles.description}>{t('modelSettingsSystemPromptDesc')}</div>
          <textarea
            className={styles.textareaInput}
            placeholder={t('modelSettingsSystemPromptPlaceholder')}
            value={settings.systemPrompt}
            onChange={(event) => setSystemPrompt(event.target.value)}
          />
        </div>
      </div>

      <div className={styles.cell}>
        <div className={styles.field}>
          <div className={styles.paramGrid}>
            <NumberParamInput
              label={t('modelSettingsTemperatureLabel')}
              value={settings.temperature}
              placeholder={t('modelSettingsParamPlaceholder')}
              step="0.1"
              min={0}
              max={2}
              onChange={setTemperature}
            />
            <NumberParamInput
              label={t('modelSettingsTopPLabel')}
              value={settings.topP}
              placeholder={t('modelSettingsParamPlaceholder')}
              step="0.05"
              min={0}
              max={1}
              onChange={setTopP}
            />
            <NumberParamInput
              label={t('modelSettingsMaxTokensLabel')}
              value={settings.maxTokens}
              placeholder={t('modelSettingsParamPlaceholder')}
              step="1"
              min={1}
              integer
              onChange={setMaxTokens}
            />
          </div>
          <div className={styles.description}>{t('modelSettingsParamHint')}</div>
        </div>
      </div>

      <div className={styles.groupTitle}>{t('modelSettingsSectionChannels')}</div>
      <div className={styles.cell}>
        <div className={styles.field}>
          <div className={styles.description}>{t('modelSettingsChannelsHintAlt')}</div>
          {/* 语音走官方 /v1/tools/*，只认 API Key（账号 token 会被 401），必须单独填一把 */}
          <div className={styles.description}>{t('modelSettingsSpeechAccountHint')}</div>
        </div>
      </div>

      <SpeechKeyCell />

      <div className={styles.groupTitle}>{t('modelSettingsSectionProtocol')}</div>

      {/* v2.9.2：上下文自动压缩的开关与档位只在「对话设置」里保留一份，这里不再重复 */}

      <ToggleCell
        label={t('modelSettingsSafetyCheckLabel')}
        description={t('modelSettingsSafetyCheckDesc')}
        checked={settings.safetyCheck}
        onChange={setSafetyCheck}
      />
      <ToggleCell
        label={t('modelSettingsReadUrlLabel')}
        description={t('modelSettingsReadUrlDesc')}
        checked={settings.readUrl}
        onChange={setReadUrl}
      />
      <ToggleCell
        label={t('modelSettingsLatestReminderLabel')}
        description={t('modelSettingsLatestReminderDesc')}
        checked={settings.sendLatestReminder}
        onChange={setSendLatestReminder}
      />
      <ToggleCell
        label={t('modelSettingsAutoTitleLabel')}
        description={t('modelSettingsAutoTitleDesc')}
        checked={settings.autoTitle}
        onChange={setAutoTitle}
      />

      <div className={styles.groupTitle}>{t('modelSettingsSectionReply')}</div>

      <ToggleCell
        label={t('modelSettingsKeepRefusedLabel')}
        description={t('modelSettingsKeepRefusedDesc')}
        checked={settings.keepRefusedContent}
        onChange={setKeepRefusedContent}
      />
      <ToggleCell
        label={t('modelSettingsAllowRefusedContextLabel')}
        description={t('modelSettingsAllowRefusedContextDesc')}
        checked={settings.allowRefusedContext}
        onChange={setAllowRefusedContext}
      />
      <ToggleCell
        label={t('modelSettingsAllowEditAssistantLabel')}
        description={t('modelSettingsAllowEditAssistantDesc')}
        checked={settings.allowEditAssistant}
        onChange={setAllowEditAssistant}
      />

      <div className={styles.groupTitle}>{t('modelSettingsSectionRefusal')}</div>

      <ToggleCell
        label={t('modelSettingsRefusalEnabledLabel')}
        description={t('modelSettingsRefusalEnabledDesc')}
        checked={settings.refusalEnabled}
        onChange={setRefusalEnabled}
      />
      <ToggleCell
        label={t('modelSettingsRefusalCaseSensitiveLabel')}
        checked={settings.refusalCaseSensitive}
        onChange={setRefusalCaseSensitive}
      />

      <div className={styles.cell}>
        <div className={styles.field}>
          <div className={styles.label}>{t('modelSettingsRefusalKeywordsLabel')}</div>
          <div className={styles.description}>{t('modelSettingsRefusalKeywordsDesc')}</div>
          <textarea
            className={styles.textareaInput}
            placeholder={t('modelSettingsRefusalKeywordsPlaceholder')}
            value={settings.refusalKeywords}
            onChange={(event) => setRefusalKeywords(event.target.value)}
          />
        </div>
      </div>

      <div className={styles.cell}>
        <div className={styles.field}>
          <div className={styles.fieldHeader}>
            <div className={styles.label}>{t('modelSettingsRefusalMessageLabel')}</div>
            {settings.refusalMessage ? (
              <button
                type="button"
                className={styles.linkAction}
                onClick={() => setRefusalMessage('')}
              >
                {t('modelSettingsRestoreDefault')}
              </button>
            ) : null}
          </div>
          <div className={styles.description}>{t('modelSettingsRefusalMessageDesc')}</div>
          <textarea
            className={styles.textareaInput}
            placeholder={t('replyRefused')}
            value={settings.refusalMessage}
            onChange={(event) => setRefusalMessage(event.target.value)}
          />
        </div>
      </div>

      <div className={styles.resetRow}>
        <Button variant="outlined" size="s" onClick={resetModelAndPolicySettings}>
          {t('modelSettingsResetAll')}
        </Button>
      </div>
    </>
  )
}
