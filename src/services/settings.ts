import { create } from 'zustand'
import { setRuntimeApiOrigin } from './api/origin.js'
import type { TtsVoice } from './api/speech.js'
import {
  DEFAULT_COMPACT_LEVEL,
  isCompactLevel,
  type CompactLevel,
} from './chat/compaction.js'
import { normalizeLocation, type UserLocation } from './location.js'
import {
  createOfficialProvider,
  newProviderId,
  type Provider,
} from './providers.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 主语言模型接口协议：deepseek / openai / responses / local（本地部署免密钥） */
export type ChatProtocol = 'deepseek' | 'openai' | 'responses' | 'local'

/** 思考程度：关闭 / 轻 / 深 / 最高（对应 DeepSeek 的 output_config.effort） */
export type ThinkingEffort = 'off' | 'low' | 'high' | 'max'

/** 模型的上下文窗口（token）：用于上下文压缩与用量展示 */
export const CONTEXT_WINDOW_PRESETS = [
  16000, 32000, 64000, 128000, 200000, 1000000,
] as const

/** 模型是否支持看图 */
export type VisionSupport = 'auto' | 'yes' | 'no'

/** 流式输出节流：流畅=丢帧多渲染快，完整=尽量显示每个字 */
export type StreamThrottle = 'smooth' | 'balanced' | 'full'

/** 子能力渠道模式：inherit 跟随主 DeepSeek 服务，custom 使用独立的别家服务 */
export type ServiceChannelMode = 'inherit' | 'custom'

export type ServiceChannelConfig = {
  mode: ServiceChannelMode
  baseUrl: string
  apiKey: string
  model: string
}

export type TtsChannelConfig = ServiceChannelConfig & {
  voice: string
}

const EMPTY_CHANNEL: ServiceChannelConfig = {
  mode: 'inherit',
  baseUrl: '',
  apiKey: '',
  model: '',
}

const EMPTY_TTS_CHANNEL: TtsChannelConfig = {
  ...EMPTY_CHANNEL,
  voice: 'alloy',
}

export const DEFAULT_MODEL = 'deepseek-flash'
export const DEFAULT_SYSTEM_PROMPT = '该助手为DeepSeek，由深度求索公司创造。'
/** 本机设置，存 localStorage */
export type Settings = {
  /** @deprecated 迁移到 providers；保留以兼容旧的读取点，始终反映当前供应商 */
  apiKey: string | null
  /** 所有供应商，第一个是内置的官方条目 */
  providers: Provider[]
  /** 当前使用的供应商 id */
  activeProviderId: string
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  autoPlayVoice: boolean
  autoCheckUpdate: boolean
  tokenLimitEnabled: boolean
  dailyTokenLimit: number
  /** 旧的布尔开关，保留用于兼容；实际请求以 thinkingEffort 为准 */
  thinking: boolean
  /** 本轮默认的思考程度 */
  thinkingEffort: ThinkingEffort
  search: boolean
  siderCollapsed: boolean
  // 模型与请求参数
  chatProtocol: ChatProtocol
  apiOrigin: string
  customHeaders: string
  model: string
  systemPrompt: string
  /** 上下文接近模型窗口 80% 时自动把早期轮次压成摘要 */
  autoCompactContext: boolean
  /**
   * 压缩档位（v2.8.9）：占到窗口 20/40/60/80% 时触发压缩，
   * 并决定压缩后保留几轮原文。见 compaction.ts 的 COMPACT_LEVELS。
   */
  compactLevel: CompactLevel
  temperature: number | null
  topP: number | null
  maxTokens: number | null
  /** 模型上下文窗口（token）；用于压缩阈值与用量展示 */
  contextWindow: number
  /** 该模型能否直接识别图片；auto 表示按模型名自动判断 */
  visionSupport: VisionSupport
  /** 流式输出的节流强度 */
  streamThrottle: StreamThrottle
  /** 是否在每条回复下方显示 token 用量 */
  showTokenUsage: boolean
  /** 界面字号缩放：0.9 / 1 / 1.1 / 1.2，跟随系统为 1 */
  fontScale: number
  /** 思考结束后自动折叠思考内容 */
  autoCollapseThinking: boolean
  // 多能力独立渠道
  asrChannel: ServiceChannelConfig
  ttsChannel: TtsChannelConfig
  // 协议与工具开关
  safetyCheck: boolean
  readUrl: boolean
  sendLatestReminder: boolean
  autoTitle: boolean
  // 回复与拒答策略
  keepRefusedContent: boolean
  allowRefusedContext: boolean
  allowEditAssistant: boolean
  savedMemoryEnabled: boolean
  autoExtractMemory: boolean
  crossChatMemory: boolean
  crossChatMemoryLimit: number
  // 自定义关键词拒答（仅检查用户输入）
  refusalEnabled: boolean
  refusalKeywords: string
  refusalCaseSensitive: boolean
  refusalMessage: string
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  providers: 'chat-demo:providers',
  activeProviderId: 'chat-demo:active-provider',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  autoPlayVoice: 'chat-demo:auto-play-voice',
  autoCheckUpdate: 'chat-demo:auto-check-update',
  tokenLimitEnabled: 'chat-demo:token-limit-enabled',
  dailyTokenLimit: 'chat-demo:daily-token-limit',
  thinking: 'chat-demo:thinking',
  thinkingEffort: 'chat-demo:thinking-effort',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
  chatProtocol: 'chat-demo:chat-protocol',
  apiOrigin: 'chat-demo:api-origin',
  customHeaders: 'chat-demo:custom-headers',
  model: 'chat-demo:model',
  systemPrompt: 'chat-demo:system-prompt',
  autoCompactContext: 'chat-demo:auto-compact-context',
  compactLevel: 'chat-demo:compact-level',
  temperature: 'chat-demo:temperature',
  topP: 'chat-demo:top-p',
  maxTokens: 'chat-demo:max-tokens',
  contextWindow: 'chat-demo:context-window',
  visionSupport: 'chat-demo:vision-support',
  streamThrottle: 'chat-demo:stream-throttle',
  showTokenUsage: 'chat-demo:show-token-usage',
  fontScale: 'chat-demo:font-scale',
  autoCollapseThinking: 'chat-demo:auto-collapse-thinking',
  asrChannel: 'chat-demo:asr-channel',
  ttsChannel: 'chat-demo:tts-channel',
  safetyCheck: 'chat-demo:safety-check',
  readUrl: 'chat-demo:read-url',
  sendLatestReminder: 'chat-demo:send-latest-reminder',
  autoTitle: 'chat-demo:auto-title',
  keepRefusedContent: 'chat-demo:keep-refused-content',
  allowRefusedContext: 'chat-demo:allow-refused-context',
  allowEditAssistant: 'chat-demo:allow-edit-assistant',
  savedMemoryEnabled: 'chat-demo:saved-memory-enabled',
  autoExtractMemory: 'chat-demo:auto-extract-memory',
  crossChatMemory: 'chat-demo:cross-chat-memory',
  crossChatMemoryLimit: 'chat-demo:cross-chat-memory-limit',
  refusalEnabled: 'chat-demo:refusal-enabled',
  refusalKeywords: 'chat-demo:refusal-keywords',
  refusalCaseSensitive: 'chat-demo:refusal-case-sensitive',
  refusalMessage: 'chat-demo:refusal-message',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时跟随系统（1.0） */
/** 可选字号档位 */
export const FONT_SCALES = [0.9, 1, 1.1, 1.2] as const

const initialFontScale = (): number => {
  const saved = Number(read(KEYS.fontScale))
  return FONT_SCALES.includes(saved as (typeof FONT_SCALES)[number]) ? saved : 1
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

const readBool = (key: string, fallback: boolean): boolean => {
  const saved = read(key)
  if (saved === 'true') {
    return true
  }
  if (saved === 'false') {
    return false
  }
  return fallback
}

const readNumber = (key: string): number | null => {
  const saved = read(key)
  if (saved === null || saved === '') {
    return null
  }
  const value = Number(saved)
  return Number.isFinite(value) ? value : null
}

const readChannel = (key: string): ServiceChannelConfig => {
  try {
    const parsed: unknown = JSON.parse(read(key) ?? 'null')
    if (typeof parsed !== 'object' || parsed === null) {
      return { ...EMPTY_CHANNEL }
    }
    const obj = parsed as Record<string, unknown>
    return {
      mode: obj.mode === 'custom' ? 'custom' : 'inherit',
      baseUrl: typeof obj.baseUrl === 'string' ? obj.baseUrl : '',
      apiKey: typeof obj.apiKey === 'string' ? obj.apiKey : '',
      model: typeof obj.model === 'string' ? obj.model : '',
    }
  } catch {
    return { ...EMPTY_CHANNEL }
  }
}

const readTtsChannel = (key: string): TtsChannelConfig => {
  try {
    const parsed: unknown = JSON.parse(read(key) ?? 'null')
    if (typeof parsed !== 'object' || parsed === null) {
      return { ...EMPTY_TTS_CHANNEL }
    }
    const obj = parsed as Record<string, unknown>
    return {
      ...readChannel(key),
      voice: typeof obj.voice === 'string' ? obj.voice : 'alloy',
    }
  } catch {
    return { ...EMPTY_TTS_CHANNEL }
  }
}

const initialThinkingEffort = (): ThinkingEffort => {
  const saved = read(KEYS.thinkingEffort)
  // 兼容旧值：medium 归一到 high
  if (saved === 'medium') {
    return 'high'
  }
  if (saved === 'off' || saved === 'low' || saved === 'high' || saved === 'max') {
    return saved
  }
  // 默认关闭思考：普通聊天用不到，开着更慢更贵
  return 'off'
}

const initialVisionSupport = (): VisionSupport => {
  const saved = read(KEYS.visionSupport)
  return saved === 'yes' || saved === 'no' ? saved : 'auto'
}

const initialStreamThrottle = (): StreamThrottle => {
  const saved = read(KEYS.streamThrottle)
  return saved === 'smooth' || saved === 'full' ? saved : 'balanced'
}

const initialChatProtocol = (): ChatProtocol => {
  const saved = read(KEYS.chatProtocol)
  if (saved === 'openai' || saved === 'responses' || saved === 'local') {
    return saved
  }
  return 'deepseek'
}

/**
 * 读取供应商列表。
 *
 * 老版本只有「一个 API Key + 一个地址 + 一个模型」的扁平配置，
 * 这里在首次读取时把它整体搬成第一个自定义供应商，用户升级后
 * 原来的 Key、地址、模型都还在，不会突然要求重新配置。
 */
const initialProviders = (): Provider[] => {
  const raw = read(KEYS.providers)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Provider[]
      if (Array.isArray(parsed) && parsed.length > 0) {
        // 补齐内置条目，防止旧数据里没有它
        const hasOfficial = parsed.some((item) => item.id === 'deepseek-official')
        const list = hasOfficial ? parsed : [createOfficialProvider(), ...parsed]
        // 官方条目配置自愈（2.7.4）：v2.7.1 前允许编辑官方条目，部分设备上
        // 它被改成了第三方协议/地址——切回官方就 404。锁死后用内置值修复脏配置。
        return list.map((item) =>
          item.id === 'deepseek-official' ? { ...createOfficialProvider(), apiKey: item.apiKey } : item
        )
      }
    } catch {
      // 解析失败时走下面的迁移
    }
  }

  // 迁移旧的扁平配置
  const legacyKey = read(KEYS.apiKey) ?? ''
  const legacyOrigin = read(KEYS.apiOrigin) ?? ''
  const legacyModel = read(KEYS.model) ?? ''
  const legacyProtocol = initialChatProtocol()
  const legacyHeaders = read(KEYS.customHeaders) ?? ''
  const official = createOfficialProvider()

  // 旧配置就是官方默认（没改地址、没自定义模型）时，不算额外的供应商
  const isPlainOfficial =
    !legacyOrigin && (!legacyModel || legacyModel === DEFAULT_MODEL) && legacyProtocol === 'deepseek'

  if (isPlainOfficial) {
    return [legacyKey ? { ...official, apiKey: legacyKey } : official]
  }

  return [
    official,
    {
      id: newProviderId(),
      name: legacyOrigin ? hostLabel(legacyOrigin) : 'DeepSeek',
      custom: true,
      protocol: legacyProtocol,
      baseUrl: legacyOrigin,
      apiKey: legacyKey,
      headers: legacyHeaders,
      models: legacyModel
        ? [{ id: legacyModel, name: '', inputs: { text: true, image: true } }]
        : [],
      model: legacyModel,
    },
  ]
}

/** 从地址里取一个能当名字用的主机名：https://x.com/v1 -> x.com */
const hostLabel = (url: string): string => {
  try {
    return new URL(url).hostname || url
  } catch {
    return url.replace(/^https?:\/\//i, '').split('/')[0] || url
  }
}

const initialProvidersCache = initialProviders()

/**
 * 官方条目终态自愈（2.7.5）：2.7.4 只修了 providers 列表，但启动时运行时
 * API 地址（setRuntimeApiOrigin）与全局扁平键仍从旧坏配置读取——用户停在
 * 官方条目上时，请求仍打到被改坏的第三方地址（Not Found 的漏网之鱼）。
 * 这里在 store 初始化前把官方条目的修复结果同步写回扁平键与运行时地址。
 */
const repairOfficialRuntimeKeys = (): void => {
  const official = initialProvidersCache.find((item) => item.id === 'deepseek-official')
  if (!official) {
    return
  }
  const activeId = read(KEYS.activeProviderId)
  if (activeId && activeId !== 'deepseek-official') {
    // 用户正在用第三方供应商：官方条目已修复入库，扁平键保持当前供应商
    return
  }
  // 停在官方（或首次启动）：扁平键与运行时地址一律取修复后的官方配置
  write(KEYS.chatProtocol, official.protocol)
  write(KEYS.apiOrigin, official.baseUrl || null)
  write(KEYS.customHeaders, official.headers || null)
  write(KEYS.model, official.model || null)
  setRuntimeApiOrigin(official.baseUrl)
}

repairOfficialRuntimeKeys()

// 官方自愈可能改写了扁平键（停在官方条目时）：apiOrigin 在修复后读取
const initialApiOrigin = read(KEYS.apiOrigin) ?? ''

const initialActiveProviderId = (): string => {
  const saved = read(KEYS.activeProviderId)
  if (saved && initialProvidersCache.some((item) => item.id === saved)) {
    return saved
  }
  return initialProvidersCache[0].id
}

/** 当前生效的供应商 */
export const activeProvider = (state: Settings = useSettings.getState()): Provider =>
  state.providers.find((item) => item.id === state.activeProviderId) ?? state.providers[0]

export const useSettings = create<Settings>(() => ({
  apiKey: initialProvidersCache.find((item) => item.id === initialActiveProviderId())?.apiKey || null,
  providers: initialProvidersCache,
  activeProviderId: initialActiveProviderId(),
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  autoPlayVoice: readBool(KEYS.autoPlayVoice, false),
  autoCheckUpdate: readBool(KEYS.autoCheckUpdate, true),
  tokenLimitEnabled: readBool(KEYS.tokenLimitEnabled, false),
  dailyTokenLimit: Math.max(1000, Math.round(readNumber(KEYS.dailyTokenLimit) ?? 100_000)),
  thinking: read(KEYS.thinking) === 'true',
  thinkingEffort: initialThinkingEffort(),
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
  chatProtocol: initialChatProtocol(),
  apiOrigin: initialApiOrigin,
  customHeaders: read(KEYS.customHeaders) ?? '',
  model: read(KEYS.model) ?? DEFAULT_MODEL,
  systemPrompt: read(KEYS.systemPrompt) ?? DEFAULT_SYSTEM_PROMPT,
  autoCompactContext: readBool(KEYS.autoCompactContext, true),
  compactLevel: (() => {
    const saved = read(KEYS.compactLevel)
    return isCompactLevel(saved) ? saved : DEFAULT_COMPACT_LEVEL
  })(),
  temperature: readNumber(KEYS.temperature),
  topP: readNumber(KEYS.topP),
  maxTokens: readNumber(KEYS.maxTokens),
  contextWindow: Math.max(4000, Math.round(readNumber(KEYS.contextWindow) ?? 1000000)),
  visionSupport: initialVisionSupport(),
  streamThrottle: initialStreamThrottle(),
  showTokenUsage: readBool(KEYS.showTokenUsage, false),
  fontScale: initialFontScale(),
  autoCollapseThinking: readBool(KEYS.autoCollapseThinking, true),
  asrChannel: readChannel(KEYS.asrChannel),
  ttsChannel: readTtsChannel(KEYS.ttsChannel),
  safetyCheck: readBool(KEYS.safetyCheck, true),
  readUrl: readBool(KEYS.readUrl, true),
  sendLatestReminder: readBool(KEYS.sendLatestReminder, true),
  autoTitle: readBool(KEYS.autoTitle, true),
  keepRefusedContent: readBool(KEYS.keepRefusedContent, false),
  allowRefusedContext: readBool(KEYS.allowRefusedContext, false),
  allowEditAssistant: readBool(KEYS.allowEditAssistant, true),
  savedMemoryEnabled: readBool(KEYS.savedMemoryEnabled, true),
  autoExtractMemory: readBool(KEYS.autoExtractMemory, true),
  crossChatMemory: readBool(KEYS.crossChatMemory, false),
  crossChatMemoryLimit: Math.min(10, Math.max(1, readNumber(KEYS.crossChatMemoryLimit) ?? 4)),
  refusalEnabled: readBool(KEYS.refusalEnabled, false),
  refusalKeywords: read(KEYS.refusalKeywords) ?? '',
  refusalCaseSensitive: readBool(KEYS.refusalCaseSensitive, false),
  refusalMessage: read(KEYS.refusalMessage) ?? '',
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setAutoPlayVoice = (value: boolean) =>
  setBoolSetting(KEYS.autoPlayVoice, 'autoPlayVoice', value)

export const setAutoCheckUpdate = (value: boolean) =>
  setBoolSetting(KEYS.autoCheckUpdate, 'autoCheckUpdate', value)

export const setTokenLimitEnabled = (value: boolean) =>
  setBoolSetting(KEYS.tokenLimitEnabled, 'tokenLimitEnabled', value)

export const setDailyTokenLimit = (value: number) => {
  const limit = Math.max(1000, Math.round(value))
  write(KEYS.dailyTokenLimit, String(limit))
  useSettings.setState({ dailyTokenLimit: limit })
}

/* ------------------------------ 供应商 ------------------------------ */

/** 把供应商列表写回本地，并同步旧的扁平字段（apiKey / model / apiOrigin 等） */
const commitProviders = (providers: Provider[], activeId: string) => {
  write(KEYS.providers, JSON.stringify(providers))
  write(KEYS.activeProviderId, activeId)
  const active = providers.find((item) => item.id === activeId) ?? providers[0]
  // 旧读取点（apiKey / model / apiOrigin / chatProtocol）跟随当前供应商，
  // 这样不用改所有调用处也能立刻生效
  write(KEYS.apiKey, active.apiKey || null)
  write(KEYS.model, active.model || null)
  write(KEYS.apiOrigin, active.baseUrl || null)
  write(KEYS.chatProtocol, active.protocol)
  write(KEYS.customHeaders, active.headers || null)
  setRuntimeApiOrigin(active.baseUrl)
  useSettings.setState({
    providers,
    activeProviderId: active.id,
    apiKey: active.apiKey || null,
    model: active.model || DEFAULT_MODEL,
    apiOrigin: active.baseUrl,
    chatProtocol: active.protocol,
    customHeaders: active.headers,
  })
}

/** 切换当前使用的供应商 */
export const setActiveProvider = (id: string) => {
  const { providers } = useSettings.getState()
  if (!providers.some((item) => item.id === id)) {
    return
  }
  // 官方条目运行时自愈：升级前被改坏的配置在切换瞬间修复并落盘（2.7.4）
  const official = providers.find((item) => item.id === 'deepseek-official')
  const repaired = official
    ? { ...createOfficialProvider(), apiKey: official.apiKey }
    : undefined
  const dirty =
    official !== undefined &&
    repaired !== undefined &&
    (official.baseUrl !== repaired.baseUrl ||
      official.protocol !== repaired.protocol ||
      official.headers !== repaired.headers)
  commitProviders(
    dirty && repaired
      ? providers.map((item) => (item.id === 'deepseek-official' ? repaired : item))
      : providers,
    id
  )
}

/** 新增一个空白供应商并直接切过去；返回它的 id */
export const addProvider = (seed?: Partial<Provider>): string => {
  const { providers } = useSettings.getState()
  const provider: Provider = {
    id: newProviderId(),
    name: seed?.name ?? '',
    custom: true,
    protocol: seed?.protocol ?? 'openai',
    baseUrl: seed?.baseUrl ?? '',
    apiKey: seed?.apiKey ?? '',
    headers: seed?.headers ?? '',
    models: seed?.models ?? [],
    model: seed?.model ?? '',
  }
  // 追加到末尾：列表按添加顺序向下增长
  commitProviders([...providers, provider], provider.id)
  return provider.id
}

/** 更新某个供应商的字段（只改传进来的部分） */
export const updateProvider = (id: string, patch: Partial<Provider>) => {
  const { providers } = useSettings.getState()
  const next = providers.map((item) => (item.id === id ? { ...item, ...patch, id: item.id } : item))
  commitProviders(next, useSettings.getState().activeProviderId === id ? id : useSettings.getState().activeProviderId)
}

/** 删除供应商；内置条目不能删，删掉当前的会切回官方 */
export const removeProvider = (id: string) => {
  const { providers, activeProviderId } = useSettings.getState()
  const target = providers.find((item) => item.id === id)
  if (!target || target.builtin) {
    return false
  }
  const next = providers.filter((item) => item.id !== id)
  const nextActive = activeProviderId === id ? next[0].id : activeProviderId
  commitProviders(next, nextActive)
  return true
}

/** 把某个字段同步到当前供应商（内部用，避免循环调用） */
const syncActiveProvider = (patch: Partial<Provider>) => {
  const { providers, activeProviderId } = useSettings.getState()
  const next = providers.map((item) =>
    item.id === activeProviderId ? { ...item, ...patch, id: item.id } : item
  )
  write(KEYS.providers, JSON.stringify(next))
  useSettings.setState({ providers: next })
}

export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
  // 同步回当前供应商，切换供应商时不会串
  syncActiveProvider({ apiKey: apiKey ?? '' })
}

/* -------------------------------------------------------------------- */

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setThinkingEffort = (thinkingEffort: ThinkingEffort) => {
  write(KEYS.thinkingEffort, thinkingEffort)
  // 同步旧开关，让界面上的「深度思考」按钮状态一致
  write(KEYS.thinking, String(thinkingEffort !== 'off'))
  useSettings.setState({ thinkingEffort, thinking: thinkingEffort !== 'off' })
}

export const setContextWindow = (value: number) => {
  const contextWindow = Math.max(4000, Math.round(value))
  write(KEYS.contextWindow, String(contextWindow))
  useSettings.setState({ contextWindow })
}

/** 上下文压缩档位（v2.8.9）：决定占到多少开始压、压完保留几轮原文 */
export const setCompactLevel = (compactLevel: CompactLevel) => {
  const next = isCompactLevel(compactLevel) ? compactLevel : DEFAULT_COMPACT_LEVEL
  write(KEYS.compactLevel, next)
  useSettings.setState({ compactLevel: next })
}

export const setVisionSupport = (visionSupport: VisionSupport) => {
  write(KEYS.visionSupport, visionSupport)
  useSettings.setState({ visionSupport })
}

export const setStreamThrottle = (streamThrottle: StreamThrottle) => {
  write(KEYS.streamThrottle, streamThrottle)
  useSettings.setState({ streamThrottle })
}

export const setShowTokenUsage = (value: boolean) =>
  setBoolSetting(KEYS.showTokenUsage, 'showTokenUsage', value)

/** 界面字号缩放；写入后立即应用到 <html> 上的 --ds-font-scale */
export const setFontScale = (fontScale: number) => {
  const next = FONT_SCALES.includes(fontScale as (typeof FONT_SCALES)[number]) ? fontScale : 1
  write(KEYS.fontScale, String(next))
  useSettings.setState({ fontScale: next })
  applyFontScale(next)
}

export const setAutoCollapseThinking = (value: boolean) =>
  setBoolSetting(KEYS.autoCollapseThinking, 'autoCollapseThinking', value)

/** 把字号缩放写到根元素：CSS 变量给继承字号用，data 属性给整页 zoom 用 */
export const applyFontScale = (fontScale: number) => {
  if (typeof document === 'undefined') {
    return
  }
  const root = document.documentElement
  root.style.setProperty('--ds-font-scale', String(fontScale))
  if (fontScale === 1) {
    delete root.dataset.fontScale
  } else {
    root.dataset.fontScale = String(fontScale)
  }
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

export const setChatProtocol = (chatProtocol: ChatProtocol) => {
  write(KEYS.chatProtocol, chatProtocol)
  useSettings.setState({ chatProtocol })
  syncActiveProvider({ protocol: chatProtocol })
}

export const setAsrChannel = (asrChannel: ServiceChannelConfig) => {
  write(KEYS.asrChannel, JSON.stringify(asrChannel))
  useSettings.setState({ asrChannel })
}

export const setTtsChannel = (ttsChannel: TtsChannelConfig) => {
  write(KEYS.ttsChannel, JSON.stringify(ttsChannel))
  useSettings.setState({ ttsChannel })
}

export const setApiOrigin = (apiOrigin: string) => {
  write(KEYS.apiOrigin, apiOrigin ? apiOrigin : null)
  setRuntimeApiOrigin(apiOrigin)
  useSettings.setState({ apiOrigin })
  syncActiveProvider({ baseUrl: apiOrigin })
}

export const setCustomHeaders = (customHeaders: string) => {
  write(KEYS.customHeaders, customHeaders ? customHeaders : null)
  useSettings.setState({ customHeaders })
  syncActiveProvider({ headers: customHeaders })
}

export const setModel = (model: string) => {
  write(KEYS.model, model)
  useSettings.setState({ model })
  syncActiveProvider({ model })
}

export const setSystemPrompt = (systemPrompt: string) => {
  write(KEYS.systemPrompt, systemPrompt)
  useSettings.setState({ systemPrompt })
}

export const setAutoCompactContext = (value: boolean) =>
  setBoolSetting(KEYS.autoCompactContext, 'autoCompactContext', value)

export const setTemperature = (temperature: number | null) => {
  write(KEYS.temperature, temperature === null ? null : String(temperature))
  useSettings.setState({ temperature })
}

export const setTopP = (topP: number | null) => {
  write(KEYS.topP, topP === null ? null : String(topP))
  useSettings.setState({ topP })
}

export const setMaxTokens = (maxTokens: number | null) => {
  write(KEYS.maxTokens, maxTokens === null ? null : String(maxTokens))
  useSettings.setState({ maxTokens })
}

const setBoolSetting = <K extends keyof Settings>(
  key: (typeof KEYS)[keyof typeof KEYS],
  field: K,
  value: boolean
) => {
  write(key, String(value))
  useSettings.setState({ [field]: value } as Pick<Settings, K>)
}

export const setSafetyCheck = (value: boolean) =>
  setBoolSetting(KEYS.safetyCheck, 'safetyCheck', value)

export const setReadUrl = (value: boolean) => setBoolSetting(KEYS.readUrl, 'readUrl', value)

export const setSendLatestReminder = (value: boolean) =>
  setBoolSetting(KEYS.sendLatestReminder, 'sendLatestReminder', value)

export const setAutoTitle = (value: boolean) => setBoolSetting(KEYS.autoTitle, 'autoTitle', value)

export const setKeepRefusedContent = (value: boolean) =>
  setBoolSetting(KEYS.keepRefusedContent, 'keepRefusedContent', value)

export const setAllowRefusedContext = (value: boolean) =>
  setBoolSetting(KEYS.allowRefusedContext, 'allowRefusedContext', value)

export const setAllowEditAssistant = (value: boolean) =>
  setBoolSetting(KEYS.allowEditAssistant, 'allowEditAssistant', value)

export const setSavedMemoryEnabled = (value: boolean) =>
  setBoolSetting(KEYS.savedMemoryEnabled, 'savedMemoryEnabled', value)

export const setAutoExtractMemory = (value: boolean) =>
  setBoolSetting(KEYS.autoExtractMemory, 'autoExtractMemory', value)

export const setCrossChatMemory = (value: boolean) =>
  setBoolSetting(KEYS.crossChatMemory, 'crossChatMemory', value)

export const setCrossChatMemoryLimit = (value: number) => {
  const limit = Math.min(10, Math.max(1, Math.round(value)))
  write(KEYS.crossChatMemoryLimit, String(limit))
  useSettings.setState({ crossChatMemoryLimit: limit })
}

export const setRefusalEnabled = (value: boolean) =>
  setBoolSetting(KEYS.refusalEnabled, 'refusalEnabled', value)

export const setRefusalKeywords = (refusalKeywords: string) => {
  write(KEYS.refusalKeywords, refusalKeywords || null)
  useSettings.setState({ refusalKeywords })
}

export const setRefusalCaseSensitive = (value: boolean) =>
  setBoolSetting(KEYS.refusalCaseSensitive, 'refusalCaseSensitive', value)

export const setRefusalMessage = (refusalMessage: string) => {
  write(KEYS.refusalMessage, refusalMessage || null)
  useSettings.setState({ refusalMessage })
}

export const resetModelAndPolicySettings = () => {
  setChatProtocol('deepseek')
  setApiOrigin('')
  setCustomHeaders('')
  setModel(DEFAULT_MODEL)
  setSystemPrompt(DEFAULT_SYSTEM_PROMPT)
  setAutoCompactContext(true)
  setCompactLevel(DEFAULT_COMPACT_LEVEL)
  setThinkingEffort('off')
  setContextWindow(1000000)
  setVisionSupport('auto')
  setStreamThrottle('balanced')
  setShowTokenUsage(false)
  setTemperature(null)
  setTopP(null)
  setMaxTokens(null)
  setAsrChannel({ ...EMPTY_CHANNEL })
  setTtsChannel({ ...EMPTY_TTS_CHANNEL })
  setSafetyCheck(true)
  setReadUrl(true)
  setSendLatestReminder(true)
  setAutoTitle(true)
  setKeepRefusedContent(false)
  setAllowRefusedContext(false)
  setAllowEditAssistant(true)
  setSavedMemoryEnabled(true)
  setAutoExtractMemory(true)
  setCrossChatMemory(true)
  setCrossChatMemoryLimit(4)
  setRefusalEnabled(false)
  setRefusalKeywords('')
  setRefusalCaseSensitive(false)
  setRefusalMessage('')
}

export { allowsVision } from './vision.js'

/** 按换行或中英文逗号拆分关键词，检查用户输入是否命中任一拒答关键词 */
export const matchesRefusalKeyword = (
  input: string,
  config: Pick<
    Settings,
    'refusalEnabled' | 'refusalKeywords' | 'refusalCaseSensitive'
  > = useSettings.getState()
): boolean => {
  if (!config.refusalEnabled || !input) {
    return false
  }
  const keywords = config.refusalKeywords
    .split(/[\n,，]+/)
    .map((item) => item.trim())
    .filter(Boolean)
  if (keywords.length === 0) {
    return false
  }
  const target = config.refusalCaseSensitive ? input : input.toLowerCase()
  return keywords.some((keyword) =>
    target.includes(config.refusalCaseSensitive ? keyword : keyword.toLowerCase())
  )
}
