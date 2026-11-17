import clsx from 'clsx'
import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { fetchAvailableModels } from '../../services/api/models.js'
import type {
  ServiceChannelConfig,
  ServiceChannelMode,
  TtsChannelConfig,
} from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { Select, type SelectOption } from '../base/Select.js'
import styles from './Settings.module.css'

/** 自由输入模型名 + 从 /models 动态获取模型列表，不写死模型选项 */
export const ModelFetcherInput = ({
  value,
  baseUrl,
  apiKey,
  customHeaders = '',
  placeholder,
  onChange,
}: {
  value: string
  baseUrl: string
  apiKey: string
  customHeaders?: string
  placeholder: string
  onChange: (model: string) => void
}) => {
  const t = useTranslate()
  const [models, setModels] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null)

  const handleFetch = async () => {
    if (loading) {
      return
    }
    setLoading(true)
    setStatus(null)
    try {
      const list = await fetchAvailableModels(baseUrl, apiKey, undefined, customHeaders)
      setModels(list)
      setStatus({ text: t('fetchModelsSuccess', { count: list.length }) })
      if (!value.trim() && list.length > 0) {
        onChange(list[0])
      }
    } catch (error) {
      setStatus({
        text: t('fetchModelsFailed', {
          message: error instanceof Error ? error.message : String(error),
        }),
        error: true,
      })
    } finally {
      setLoading(false)
    }
  }

  const options: SelectOption<string>[] = models.map((id) => ({ value: id, label: id }))

  return (
    <div className={styles.field}>
      <div className={styles.fetchRow}>
        <input
          type="text"
          className={clsx(styles.textInput, styles.fetchInput)}
          placeholder={placeholder}
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <Button size="m" variant="outlined" disabled={loading} onClick={() => void handleFetch()}>
          {loading ? t('fetchingModels') : t('fetchModelsButton')}
        </Button>
      </div>
      {models.length > 0 ? (
        <Select
          value={models.includes(value) ? value : ''}
          options={options}
          placeholder={t('fetchedModelsPlaceholder')}
          className={styles.fetchSelect}
          onChange={onChange}
        />
      ) : null}
      {status ? (
        <div className={status.error ? styles.error : styles.fetchHint}>{status.text}</div>
      ) : null}
    </div>
  )
}

/** 语音识别 / 语音合成 / 图片识别 / 文字识别 的统一自定义渠道配置卡片 */
export const CapabilityChannelCard = <T extends ServiceChannelConfig | TtsChannelConfig>({
  title,
  channel,
  fallbackBaseUrl,
  fallbackApiKey,
  modelPlaceholder,
  withVoice = false,
  onChange,
}: {
  title: string
  channel: T
  fallbackBaseUrl: string
  fallbackApiKey: string
  modelPlaceholder: string
  withVoice?: boolean
  onChange: (next: T) => void
}) => {
  const t = useTranslate()
  const modeOptions: SelectOption<ServiceChannelMode>[] = [
    { value: 'inherit', label: t('channelModeInherit') },
    { value: 'custom', label: t('channelModeCustom') },
  ]

  return (
    <div className={styles.channelCard}>
      <div className={styles.channelCardHeader}>
        <span className={styles.label}>{title}</span>
        <Select
          value={channel.mode}
          options={modeOptions}
          ariaLabel={title}
          onChange={(mode) => onChange({ ...channel, mode })}
        />
      </div>
      {channel.mode === 'inherit' ? (
        <div className={styles.channelBody}>
          <div className={styles.description}>{t('channelInheritHint')}</div>
        </div>
      ) : (
        <div className={styles.channelBody}>
          <label className={styles.paramItem}>
            <span className={styles.paramLabel}>{t('channelBaseUrlLabel')}</span>
            <input
              type="url"
              className={styles.textInput}
              placeholder={'https://api.deepseek.com'}
              spellCheck={false}
              value={channel.baseUrl}
              onChange={(event) => onChange({ ...channel, baseUrl: event.target.value })}
            />
          </label>
          <label className={styles.paramItem}>
            <span className={styles.paramLabel}>{t('channelApiKeyLabel')}</span>
            <input
              type="password"
              className={styles.textInput}
              placeholder="sk-..."
              autoComplete="off"
              spellCheck={false}
              value={channel.apiKey}
              onChange={(event) => onChange({ ...channel, apiKey: event.target.value })}
            />
          </label>
          <div className={styles.paramItem}>
            <span className={styles.paramLabel}>{t('channelModelLabel')}</span>
            <ModelFetcherInput
              value={channel.model}
              baseUrl={channel.baseUrl.trim() || fallbackBaseUrl}
              apiKey={channel.apiKey.trim() || fallbackApiKey}
              placeholder={modelPlaceholder}
              onChange={(model) => onChange({ ...channel, model })}
            />
          </div>
          {withVoice && 'voice' in channel ? (
            <label className={styles.paramItem}>
              <span className={styles.paramLabel}>{t('channelVoiceLabel')}</span>
              <input
                type="text"
                className={styles.textInput}
                placeholder="alloy"
                spellCheck={false}
                value={channel.voice}
                onChange={(event) => onChange({ ...channel, voice: event.target.value })}
              />
            </label>
          ) : null}
        </div>
      )}
    </div>
  )
}

