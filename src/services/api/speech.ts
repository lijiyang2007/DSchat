import { ApiError, request } from './client.js'
import { getApiOrigin, isDeepSeekOrigin, joinApiPath, normalizeOrigin } from './origin.js'
import { accountToken } from '../account.js'

/**
 * 语音接口：
 * - DeepSeek 官方（主服务或自定义渠道填了官方地址）：ASR POST /v1/tools/asr、TTS POST /v1/tools/tts
 * - 其他 OpenAI 兼容服务：ASR POST /v1/audio/transcriptions、TTS POST /v1/audio/speech
 *
 * 注意：主服务地址可能是第三方中转（此时聊天可用，但中转没有 tools 接口），
 * 所以自定义渠道里单独填 https://api.deepseek.com + 官方 Key 是推荐做法。
 */
/**
 * 第三方接口的鉴权：只认 Bearer Key；没有 Key 就不带头（空 Bearer 只会换来 401）。
 */
const bearerAuth = (apiKey: string): Record<string, string> =>
  apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}

/**
 * 官方接口的鉴权（与聊天同源）：
 * - 渠道里显式填了 Key → 用这把 Key
 * - 登录了 DeepSeek 账号 → x-dsh-auth-token（走账号额度，与聊天、余额接口一致）
 * - 都没有 → Bearer 主 Key；主 Key 也没有就不带头
 */
const officialAuth = (apiKey: string, explicitKey?: string): Record<string, string> => {
  if (explicitKey?.trim()) {
    return bearerAuth(explicitKey)
  }
  const token = accountToken()
  if (token) {
    return { 'x-dsh-auth-token': token }
  }
  return bearerAuth(apiKey)
}
/**
 * DeepSeek tools 接口地址。
 * 允许用户把渠道地址填成 `https://api.deepseek.com`、`…/v1` 或带结尾斜杠，
 * 统一归一化到根域名再拼 `/v1/tools/*`，避免出现 `/v1/v1/tools` 这种路径。
 */
const toolsBaseUrl = (origin?: string): string => {
  const raw = normalizeOrigin(origin ?? '') || getApiOrigin()
  // 去掉可能已经带上的版本后缀，tools 路径由这里统一补齐
  const root = raw.replace(/\/v\d+(?:beta)?(?:\/openai)?$/i, '').replace(/\/+$/, '')
  return `${root}/v1/tools`
}

export type TtsVoice = 'stella' | 'tide'

/** TTS 输出的裸 PCM 参数：24kHz、单声道、16-bit 小端 */
export const TTS_SAMPLE_RATE = 24000

export type SpeechChannelOverride = {
  baseUrl: string
  apiKey: string
  model: string
  voice?: string
}

/** 自定义渠道是否配置了地址或模型；只有配置过才考虑覆盖主服务 */
const isChannelConfigured = (custom: SpeechChannelOverride | undefined): boolean =>
  Boolean(custom && (normalizeOrigin(custom.baseUrl) || custom.model.trim()))

/**
 * 自定义渠道是否指向 DeepSeek 官方。
 * 指向官方时要用官方的 /v1/tools/* 协议，而不是 OpenAI 的 /audio/* 路径——
 * 官方没有 /audio/speech，中转没有 /tools/tts，走错路径两边都会 404。
 */
const isDeepSeekChannel = (custom: SpeechChannelOverride): boolean =>
  isDeepSeekOrigin(custom.baseUrl)

/** 语音识别：支持 DeepSeek tools 接口与自定义 OpenAI 兼容 /audio/transcriptions */
export const transcribe = async (
  apiKey: string,
  audio: Blob,
  signal?: AbortSignal,
  custom?: SpeechChannelOverride
): Promise<string> => {
  const useCustom = isChannelConfigured(custom) && custom ? custom : undefined
  // 自定义渠道指向 DeepSeek 官方时仍走官方 tools 接口，只是换了地址和密钥
  const useDeepSeekTools = !useCustom || isDeepSeekChannel(useCustom)

  const form = new FormData()
  form.append('file', audio, 'recording.wav')

  if (!useDeepSeekTools && useCustom) {
    if (useCustom.model.trim()) {
      form.append('model', useCustom.model.trim())
    }
    const url = joinApiPath(useCustom.baseUrl, '/audio/transcriptions')
    const key = useCustom.apiKey.trim() || apiKey
    const response = await request(url, {
      method: 'POST',
      headers: bearerAuth(key),
      body: form,
      signal,
    })
    const raw = await response.text()
    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      return raw.trim()
    }
    if (
      typeof body === 'object' &&
      body !== null &&
      'text' in body &&
      typeof (body as { text: unknown }).text === 'string'
    ) {
      return (body as { text: string }).text
    }
    throw new ApiError('protocol', raw)
  }

  const origin = useCustom?.baseUrl.trim() ? normalizeOrigin(useCustom.baseUrl) : undefined
  const key = useCustom?.apiKey.trim() || apiKey
  const response = await request(`${toolsBaseUrl(origin)}/asr`, {
    method: 'POST',
    headers: officialAuth(apiKey, key),
    body: form,
    signal,
  })
  const raw = await response.text()
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    throw new ApiError('protocol', raw)
  }
  if (
    typeof body !== 'object' ||
    body === null ||
    !('text' in body) ||
    typeof (body as { text: unknown }).text !== 'string'
  ) {
    throw new ApiError('protocol', raw)
  }
  return (body as { text: string }).text
}

export type SynthesizeResult = {
  stream: ReadableStream<Uint8Array>
  isPcm: boolean
}

/** 语音合成：DeepSeek 官方返回裸 PCM；其他渠道兼容 OpenAI /audio/speech（pcm 或封装音频） */
export const synthesize = async (
  apiKey: string,
  text: string,
  voice: TtsVoice,
  signal: AbortSignal,
  custom?: SpeechChannelOverride
): Promise<SynthesizeResult> => {
  const useCustom = isChannelConfigured(custom) && custom ? custom : undefined
  const useDeepSeekTools = !useCustom || isDeepSeekChannel(useCustom)

  if (!useDeepSeekTools && useCustom) {
    const url = joinApiPath(useCustom.baseUrl, '/audio/speech')
    const key = useCustom.apiKey.trim() || apiKey
    const response = await request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...bearerAuth(key),
      },
      body: JSON.stringify({
        model: useCustom.model.trim() || 'tts-1',
        input: text,
        voice: useCustom.voice?.trim() || 'alloy',
        response_format: 'pcm',
      }),
      signal,
    })
    if (!response.body) {
      throw new ApiError('protocol', await response.text())
    }
    const contentType = (response.headers.get('Content-Type') ?? '').toLowerCase()
    const isEncodedAudio =
      contentType.includes('mpeg') ||
      contentType.includes('mp3') ||
      contentType.includes('wav') ||
      contentType.includes('ogg') ||
      contentType.includes('opus') ||
      contentType.includes('aac') ||
      contentType.includes('flac') ||
      contentType.includes('mp4')
    return { stream: response.body, isPcm: !isEncodedAudio }
  }

  // DeepSeek 官方（主服务，或自定义渠道指向官方）
  const origin = useCustom?.baseUrl.trim() ? normalizeOrigin(useCustom.baseUrl) : undefined
  const key = useCustom?.apiKey.trim() || apiKey
  const response = await request(`${toolsBaseUrl(origin)}/tts`, {
    method: 'POST',
    headers: { ...officialAuth(apiKey, key), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice_id: voice, format: 'pcm', filter_markdown: true }),
    signal,
  })
  if (!response.body) {
    throw new ApiError('protocol', await response.text())
  }
  return { stream: response.body, isPcm: true }
}
