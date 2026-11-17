import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  CONTEXT_WINDOW_PRESETS,
  setChatProtocol,
  updateProvider,
  useSettings,
  type ChatProtocol,
} from '../../services/settings.js'
import {
  emptyModel,
  formatTokenSize,
  parseTokenSize,
  type Provider,
  type ProviderModel,
} from '../../services/providers.js'
import { IconChevronDownOutline14, IconTrashOutline16 } from '../base/icons.js'
import { Button } from '../base/Button.js'
import { Select, type SelectOption } from '../base/Select.js'
import { ModelFetcherInput } from './ChannelConfigField.js'
import styles from './ProviderEditor.module.css'

/** 单行模型：id + 显示名一行，展开后是上下文窗口 / 最大输出 / 输入类型 */
const ModelRow = ({
  model,
  onChange,
  onRemove,
}: {
  model: ProviderModel
  onChange: (next: ProviderModel) => void
  onRemove: () => void
}) => {
  const t = useTranslate()
  const [open, setOpen] = useState(Boolean(model.contextWindow || model.maxTokens))
  const [windowDraft, setWindowDraft] = useState(formatTokenSize(model.contextWindow))
  const [maxDraft, setMaxDraft] = useState(formatTokenSize(model.maxTokens))

  useEffect(() => {
    setWindowDraft(formatTokenSize(model.contextWindow))
    setMaxDraft(formatTokenSize(model.maxTokens))
  }, [model.contextWindow, model.maxTokens])

  const inputs = model.inputs ?? { text: true, image: false }

  return (
    <div className={styles.modelCard}>
      <div className={styles.modelHead}>
        <input
          className={styles.modelId}
          value={model.id}
          placeholder={t('providerModelIdPlaceholder')}
          spellCheck={false}
          onChange={(event) => onChange({ ...model, id: event.target.value })}
        />
        <input
          className={styles.modelName}
          value={model.name ?? ''}
          placeholder={t('providerModelNamePlaceholder')}
          spellCheck={false}
          onChange={(event) => onChange({ ...model, name: event.target.value })}
        />
        <button
          type="button"
          className={styles.expand}
          aria-label={t('providerModelAdvanced')}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className={clsx(styles.expandIcon, open && styles.expandIconOpen)}>
            <IconChevronDownOutline14 />
          </span>
        </button>
        <button type="button" className={styles.remove} aria-label={t('delete')} onClick={onRemove}>
          <IconTrashOutline16 />
        </button>
      </div>

      {open ? (
        <div className={styles.modelBody}>
          <div className={styles.modelGrid}>
            <label className={styles.miniField}>
              <span className={styles.miniLabel}>{t('providerModelContextWindow')}</span>
              <input
                className={styles.miniInput}
                value={windowDraft}
                placeholder="1M"
                spellCheck={false}
                onChange={(event) => setWindowDraft(event.target.value)}
                onBlur={() => {
                  const parsed = parseTokenSize(windowDraft)
                  onChange({ ...model, contextWindow: parsed })
                  setWindowDraft(formatTokenSize(parsed))
                }}
              />
            </label>
            <label className={styles.miniField}>
              <span className={styles.miniLabel}>{t('providerModelMaxTokens')}</span>
              <input
                className={styles.miniInput}
                value={maxDraft}
                placeholder="256K"
                spellCheck={false}
                onChange={(event) => setMaxDraft(event.target.value)}
                onBlur={() => {
                  const parsed = parseTokenSize(maxDraft)
                  onChange({ ...model, maxTokens: parsed })
                  setMaxDraft(formatTokenSize(parsed))
                }}
              />
            </label>
          </div>
          <div className={styles.presetRow}>
            {CONTEXT_WINDOW_PRESETS.map((size) => (
              <button
                key={size}
                type="button"
                className={styles.preset}
                onClick={() => {
                  onChange({ ...model, contextWindow: size })
                  setWindowDraft(formatTokenSize(size))
                }}
              >
                {formatTokenSize(size)}
              </button>
            ))}
          </div>
          <div className={styles.inputRow}>
            <span className={styles.miniLabel}>{t('providerModelInputTypes')}</span>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={inputs.text !== false}
                onChange={(event) =>
                  onChange({ ...model, inputs: { ...inputs, text: event.target.checked } })
                }
              />
              {t('providerModelInputText')}
            </label>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={Boolean(inputs.image)}
                onChange={(event) =>
                  onChange({ ...model, inputs: { ...inputs, image: event.target.checked } })
                }
              />
              {t('providerModelInputImage')}
            </label>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * 供应商编辑页。
 * 编辑期间改的是本地草稿，点「保存」才写回；点「取消」直接丢弃，
 * 不会把没保存的 Key / 地址留在配置里。
 */
export const ProviderEditor = ({
  provider,
  onSaved,
  onCancel,
}: {
  provider: Provider
  onSaved: () => void
  onCancel: () => void
}) => {
  const t = useTranslate()
  const activeProviderId = useSettings((state) => state.activeProviderId)
  const [draft, setDraft] = useState<Provider>(provider)
  const [customOpen, setCustomOpen] = useState(
    Boolean(provider.baseUrl || provider.headers) || !provider.builtin
  )

  // 切到另一个供应商时重置草稿
  useEffect(() => {
    setDraft(provider)
    setCustomOpen(Boolean(provider.baseUrl || provider.headers) || !provider.builtin)
  }, [provider])

  const protocolOptions: SelectOption<ChatProtocol>[] = [
    { value: 'deepseek', label: t('chatProtocolDeepSeek') },
    { value: 'openai', label: t('chatProtocolOpenAI') },
    { value: 'responses', label: t('chatProtocolResponses') },
    { value: 'local', label: t('chatProtocolLocal') },
  ]

  const patch = (next: Partial<Provider>) => setDraft((prev) => ({ ...prev, ...next }))

  const setModels = (models: ProviderModel[]) => {
    // 当前选中的模型被删掉时落到第一个，避免指向不存在的 id
    const model = models.some((item) => item.id === draft.model)
      ? draft.model
      : (models[0]?.id ?? '')
    patch({ models, model })
  }

  const save = () => {
    const name = draft.name.trim() || (draft.baseUrl ? hostOf(draft.baseUrl) : t('providerUntitled'))
    updateProvider(draft.id, { ...draft, name })
    // 正在用的供应商要同步全局协议，否则请求仍走旧协议
    if (draft.id === activeProviderId) {
      setChatProtocol(draft.protocol)
    }
    onSaved()
  }

  return (
    <>
      <div className={styles.titleRow}>
        {draft.builtin ? (
          <>
            <span className={styles.title}>{draft.name}</span>
            <span className={styles.slug}>{draft.id}</span>
          </>
        ) : (
          <input
            className={styles.nameInput}
            value={draft.name}
            placeholder={t('providerNamePlaceholder')}
            spellCheck={false}
            onChange={(event) => patch({ name: event.target.value })}
          />
        )}
      </div>

      {/* API 密钥 */}
      <div className={styles.block}>
        <div className={styles.blockLabel}>
          {t('providerApiKeyLabel')}
          <span className={styles.help} title={t('providerApiKeyHelp')}>
            ?
          </span>
        </div>
        <input
          type="password"
          className={styles.input}
          placeholder={t('providerApiKeyPlaceholder')}
          autoComplete="off"
          spellCheck={false}
          value={draft.apiKey}
          onChange={(event) => patch({ apiKey: event.target.value })}
        />
        {draft.builtin && !draft.apiKey ? (
          <div className={styles.warn}>{t('providerApiKeyMissing')}</div>
        ) : null}
      </div>

      {/* 自定义设置 */}
      <div className={styles.block}>
        <button
          type="button"
          className={styles.disclosure}
          aria-expanded={customOpen}
          onClick={() => setCustomOpen((value) => !value)}
        >
          <span className={clsx(styles.disclosureIcon, customOpen && styles.disclosureIconOpen)}>
            <IconChevronDownOutline14 />
          </span>
          {t('providerCustomSettings')}
        </button>

        {customOpen ? (
          <div className={styles.customBody}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t('providerBaseUrlLabel')}</span>
              <input
                className={styles.input}
                placeholder={t('providerBaseUrlPlaceholder')}
                spellCheck={false}
                value={draft.baseUrl}
                onChange={(event) => patch({ baseUrl: event.target.value })}
              />
              <span className={styles.fieldHint}>{t('providerBaseUrlHint')}</span>
            </label>

            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t('chatProtocolLabel')}</span>
              <Select
                value={draft.protocol}
                options={protocolOptions}
                ariaLabel={t('chatProtocolLabel')}
                onChange={(value) => patch({ protocol: value })}
              />
            </div>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t('providerHeadersLabel')}</span>
              <textarea
                className={styles.textarea}
                placeholder={'x-foo: bar'}
                spellCheck={false}
                value={draft.headers}
                onChange={(event) => patch({ headers: event.target.value })}
              />
              <span className={styles.fieldHint}>{t('providerHeadersHint')}</span>
            </label>
          </div>
        ) : null}
      </div>

      {/* 模型目录 */}
      <div className={styles.block}>
        <div className={styles.blockHead}>
          <span className={styles.blockLabel}>{t('providerModelCatalog')}</span>
          {draft.models.length > 0 ? (
            <button
              type="button"
              className={styles.linkAction}
              onClick={() => patch({ models: [], model: '' })}
            >
              {t('providerResetModels')}
            </button>
          ) : null}
        </div>

        {draft.models.length === 0 ? (
          <div className={styles.empty}>{t('providerNoModelYet')}</div>
        ) : (
          <div className={styles.modelList}>
            {draft.models.map((model, index) => (
              <ModelRow
                key={`${index}-${model.id}`}
                model={model}
                onChange={(next) =>
                  setModels(draft.models.map((item, i) => (i === index ? next : item)))
                }
                onRemove={() => setModels(draft.models.filter((_, i) => i !== index))}
              />
            ))}
          </div>
        )}

        <button
          type="button"
          className={styles.addModel}
          onClick={() => patch({ models: [...draft.models, emptyModel()] })}
        >
          {t('providerAddModel')}
        </button>

        <div className={styles.fetchRow}>
          <ModelFetcherInput
            value={draft.model}
            baseUrl={draft.baseUrl}
            apiKey={draft.apiKey}
            customHeaders={draft.headers}
            placeholder={t('providerModelIdPlaceholder')}
            onChange={(modelId) => {
              const exists = draft.models.some((item) => item.id === modelId)
              const models = exists
                ? draft.models
                : [...draft.models, { ...emptyModel(), id: modelId }]
              patch({ models, model: modelId })
            }}
          />
        </div>
      </div>

      <div className={styles.footer}>
        <Button variant="outlined" size="m" onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button variant="primary" size="m" onClick={save}>
          {t('save')}
        </Button>
      </div>
    </>
  )
}

/** 从地址取主机名当默认供应商名 */
const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname || url
  } catch {
    return url.replace(/^https?:\/\//i, '').split('/')[0] || url
  }
}
