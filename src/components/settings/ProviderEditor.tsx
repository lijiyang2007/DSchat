import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  CONTEXT_WINDOW_PRESETS,
  setChatProtocol,
  setThinkingEffort,
  updateProvider,
  useSettings,
  type ChatProtocol,
  type ThinkingEffort,
} from '../../services/settings.js'
import {
  DEFAULT_THINKING_EFFORT,
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

/**
 * 折叠区块（v2.9.2）。
 *
 * 参照用户给的截图：编辑页拆成「自定义设置 / 思考强度 / 模型目录」几个可折叠入口，
 * 默认收起，点标题展开——一屏就能看到全貌，不用一直往下滚。
 * 官方与第三方共用这套布局，官方只渲染「思考强度」一项。
 */
const Section = ({
  title,
  hint,
  open,
  onToggle,
  children,
}: {
  title: string
  hint?: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) => (
  <div className={styles.block}>
    <button
      type="button"
      className={styles.disclosure}
      aria-expanded={open}
      onClick={onToggle}
    >
      <span className={clsx(styles.disclosureIcon, open && styles.disclosureIconOpen)}>
        <IconChevronDownOutline14 />
      </span>
      {title}
    </button>
    {hint ? <div className={styles.fieldHint}>{hint}</div> : null}
    {open ? <div className={styles.customBody}>{children}</div> : null}
  </div>
)

/** 思考强度四档：官方与第三方共用 */
const THINKING_OPTIONS = [
  ['off', 'thinkingEffortOff'],
  ['low', 'thinkingEffortLow'],
  ['high', 'thinkingEffortHigh'],
  ['max', 'thinkingEffortMax'],
] as const

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
 *
 * v2.9.2：
 * - 拆成「自定义设置 / 思考强度 / 模型目录」三个折叠入口（参照截图布局）。
 * - **官方条目也能进来**，但页面里只有「思考强度」一项——地址/协议/请求头/模型目录
 *   全部由内置值决定（save() 对 builtin 只写 thinkingEffort，自愈也会重建其余字段），
 *   这样官方既改不坏，用户又能给官方单独调强度。
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
  // 默认都收起：一屏看完「自定义设置 / 思考强度 / 模型目录」三个入口
  const [customOpen, setCustomOpen] = useState(false)
  const [thinkingOpen, setThinkingOpen] = useState(false)
  const [modelsOpen, setModelsOpen] = useState(false)

  // 切到另一个供应商时重置草稿与折叠状态
  useEffect(() => {
    setDraft(provider)
    setCustomOpen(false)
    setThinkingOpen(false)
    setModelsOpen(false)
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
    if (draft.builtin) {
      // 官方条目只写思考强度一项：地址/协议/请求头/模型目录全部由内置值决定，
      // 界面里也不给这些入口，用户不可能把官方配置改坏。
      updateProvider(draft.id, {
        thinkingEffort: draft.thinkingEffort ?? DEFAULT_THINKING_EFFORT,
      })
      // 正在用的就是官方时，全局镜像值要同步，否则改完强度请求里还是旧值
      if (draft.id === activeProviderId) {
        setThinkingEffort(draft.thinkingEffort ?? DEFAULT_THINKING_EFFORT)
      }
      onSaved()
      return
    }
    updateProvider(draft.id, { ...draft, name })
    // 正在用的供应商要同步全局协议与思考强度，否则请求仍走旧配置
    if (draft.id === activeProviderId) {
      setChatProtocol(draft.protocol)
      setThinkingEffort(draft.thinkingEffort ?? DEFAULT_THINKING_EFFORT)
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

      {/* API 密钥（官方走账号登录，不需要也不显示 Key 入口） */}
      {draft.builtin ? (
        <div className={styles.block}>
          <div className={styles.fieldHint}>{t('providerOfficialBaseUrlHint')}</div>
        </div>
      ) : (
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
            placeholder={t('providerApiKeyPlaceholderCustom')}
            autoComplete="off"
            spellCheck={false}
            value={draft.apiKey}
            onChange={(event) => patch({ apiKey: event.target.value })}
          />
        </div>
      )}

      {/* 自定义设置：地址 / 协议 / 请求头（官方隐藏，由内置值决定） */}
      {draft.builtin ? null : (
        <Section
          title={t('providerCustomSettings')}
          open={customOpen}
          onToggle={() => setCustomOpen((value) => !value)}
        >
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
        </Section>
      )}

      {/*
        思考强度：官方与第三方共用。
        v2.9.2 以前只有一个全局值、也没有入口，第三方实际调不了强度；
        现在按供应商保存，官方也能单独设（用户明确要求官方只开放这一项）。
      */}
      <Section
        title={t('providerThinkingEffort')}
        hint={t('providerThinkingEffortHint')}
        open={thinkingOpen}
        onToggle={() => setThinkingOpen((value) => !value)}
      >
        <div className={styles.field}>
          <Select
            value={draft.thinkingEffort ?? DEFAULT_THINKING_EFFORT}
            options={THINKING_OPTIONS.map(([value, key]) => ({
              value,
              label: t(key as never),
            }))}
            ariaLabel={t('providerThinkingEffort')}
            onChange={(value) => patch({ thinkingEffort: value as ThinkingEffort })}
          />
        </div>
      </Section>

      {/* 模型目录（官方隐藏：模型与参数由内置值决定，save() 也不会写它们） */}
      {draft.builtin ? null : (
        <Section
          title={t('providerModelCatalog')}
          open={modelsOpen}
          onToggle={() => setModelsOpen((value) => !value)}
        >
          <div className={styles.blockHead}>
            <span className={styles.fieldHint}>{t('providerModelCatalogHint')}</span>
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
        </Section>
      )}

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
