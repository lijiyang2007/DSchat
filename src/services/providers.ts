import type { ChatProtocol } from './settings.js'

/**
 * 一个供应商（Provider）。
 *
 * 一个供应商 = 一套「地址 + 密钥 + 协议 + 模型目录」。
 * 用户可以在同一台设备上配多个供应商（官方、中转、自建……），
 * 每个供应商下挂多个模型，切换供应商不会互相覆盖配置。
 */
export type ProviderModel = {
  /** 发给服务端的模型 id，例如 deepseek-flash */
  id: string
  /** 界面上显示的名字，留空则用 id */
  name?: string
  /** 该模型的上下文窗口（token） */
  contextWindow?: number
  /** 该模型的最大输出 token 数 */
  maxTokens?: number
  /** 输入类型：文本 / 图片 */
  inputs?: { text: boolean; image: boolean }
}

export type Provider = {
  id: string
  /** 显示名，例如「DeepSeek」「秋-纯ds」 */
  name: string
  /** 是否内置（只读的官方条目，可编辑但不能删除） */
  builtin?: boolean
  /** 是否为自定义（用户自建）供应商，界面上打「自定义」标签 */
  custom?: boolean
  protocol: ChatProtocol
  /** API 地址；留空表示用默认地址 */
  baseUrl: string
  /** API 密钥；留空表示用环境认证 / 账号登录 */
  apiKey: string
  /** 额外的请求头，每行一个 Key: Value */
  headers: string
  /** 模型目录；为空时使用全局默认模型 */
  models: ProviderModel[]
  /** 当前选中的模型 id */
  model: string
}

let seq = 0

/** 生成本地唯一 id；不依赖 crypto.randomUUID，老 WebView 也能用 */
export const newProviderId = (): string => {
  seq += 1
  return `p${Date.now().toString(36)}${seq.toString(36)}`
}

export const emptyModel = (): ProviderModel => ({
  id: '',
  name: '',
  contextWindow: undefined,
  maxTokens: undefined,
  inputs: { text: true, image: false },
})

/** 内置的官方供应商 */
export const createOfficialProvider = (): Provider => ({
  id: 'deepseek-official',
  name: 'DeepSeek',
  builtin: true,
  custom: false,
  protocol: 'deepseek',
  baseUrl: '',
  apiKey: '',
  headers: '',
  models: [
    {
      id: 'deepseek-flash',
      name: 'DeepSeek-V4.1-Flash',
      contextWindow: 1_000_000,
      inputs: { text: true, image: true },
    },
    {
      id: 'deepseek-v4-pro',
      name: 'DeepSeek-V4-Pro',
      contextWindow: 256_000,
      inputs: { text: true, image: true },
    },
  ],
  model: 'deepseek-flash',
})

/** 从一个供应商里取它当前选中的模型定义 */
export const activeModelOf = (provider: Provider): ProviderModel | undefined =>
  provider.models.find((item) => item.id === provider.model) ?? provider.models[0]

/** 界面上展示的模型名：优先别名，其次 id */
export const modelLabel = (model: ProviderModel): string =>
  (model.name ?? '').trim() || model.id

/**
 * 把用户输入的长度单位解析成 token 数：
 * 支持 128K / 1M / 1m / 200000 这些写法，无法识别返回 undefined。
 */
export const parseTokenSize = (raw: string): number | undefined => {
  const text = raw.trim().toLowerCase()
  if (!text) {
    return undefined
  }
  const match = /^([\d.]+)\s*([km]?)$/.exec(text)
  if (!match) {
    return undefined
  }
  const value = Number.parseFloat(match[1])
  if (!Number.isFinite(value) || value <= 0) {
    return undefined
  }
  const unit = match[2]
  const scale = unit === 'k' ? 1_000 : unit === 'm' ? 1_000_000 : 1
  return Math.round(value * scale)
}

/** token 数转回人类可读：1000000 -> 1M，128000 -> 128K */
export const formatTokenSize = (tokens: number | undefined): string => {
  if (!tokens || tokens <= 0) {
    return ''
  }
  if (tokens >= 1_000_000) {
    const value = tokens / 1_000_000
    return `${Number.isInteger(value) ? value : value.toFixed(1)}M`
  }
  if (tokens >= 1000) {
    return `${Math.round(tokens / 1000)}K`
  }
  return String(tokens)
}
