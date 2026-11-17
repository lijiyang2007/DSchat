import { create } from 'zustand'
import { setRuntimeApiOrigin } from './api/origin.js'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'

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
  apiKey: string | null
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

const initialApiOrigin = read(KEYS.apiOrigin) ?? ''
setRuntimeApiOrigin(initialApiOrigin)

export const useSettings = create<Settings>(() => ({
  apiKey: read(KEYS.apiKey),
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
  temperature: readNumber(KEYS.temperature),
  topP: readNumber(KEYS.topP),
  maxTokens: readNumber(KEYS.maxTokens),
  contextWindow: Math.max(4000, Math.round(readNumber(KEYS.contextWindow) ?? 1000000)),
  visionSupport: initialVisionSupport(),
  streamThrottle: initialStreamThrottle(),
  showTokenUsage: readBool(KEYS.showTokenUsage, true),
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
  crossChatMemory: readBool(KEYS.crossChatMemory, true),
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

export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
}

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
}

export const setCustomHeaders = (customHeaders: string) => {
  write(KEYS.customHeaders, customHeaders ? customHeaders : null)
  useSettings.setState({ customHeaders })
}

export const setModel = (model: string) => {
  write(KEYS.model, model)
  useSettings.setState({ model })
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
  setThinkingEffort('off')
  setContextWindow(1000000)
  setVisionSupport('auto')
  setStreamThrottle('balanced')
  setShowTokenUsage(true)
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
