/**
 * 语音接口（DeepSeek 官方 /v1/tools/*）：
 * ASR POST /v1/tools/asr、TTS POST /v1/tools/tts。
 *
 * 鉴权（2026-11-18 实测 + 官方文档核实）：
 * 这两个接口只认 `Authorization: Bearer <API Key>`（platform.deepseek.com 申请），
 * 完全不接受账号登录的 x-dsh-auth-token——带账号 token 一律 401
 * 「Authentication Fails (missing key)」。
 *
 * 所以语音不能用账号额度：必须在设置里填一把官方 API Key。
 * 2.7.5 曾把语音锁死到账号 token，结果 401，本版改回 API Key。
 */

import { ApiError, request } from './client.js'
import { getApiOrigin, normalizeOrigin } from './origin.js'

/** DeepSeek tools 接口地址（固定官方主服务，不再接受自定义渠道） */
const toolsBaseUrl = (): string => {
  const root = normalizeOrigin(getApiOrigin())
    .replace(/\/v\d+(?:beta)?(?:\/openai)?$/i, '')
    .replace(/\/+$/, '')
  return `${root}/v1/tools`
}

export type TtsVoice = 'stella' | 'tide'

/** TTS 输出的裸 PCM 参数：24kHz、单声道、16-bit 小端 */
export const TTS_SAMPLE_RATE = 24000

/**
 * 语音用的官方 API Key：官方 tools 接口只认 Bearer Key。
 * 未配置时返回空串，由调用方拦在发请求之前。
 */
export const speechApiKey = (): string => (readSpeechKey() ?? '').trim()

/** 本机保存的语音专用 Key（与聊天供应商的 Key 分开，互不影响） */
const SPEECH_KEY_STORAGE = 'chat-demo:speech-api-key'

const readSpeechKey = (): string | null => {
  try {
    return localStorage.getItem(SPEECH_KEY_STORAGE)
  } catch {
    return null
  }
}

/** 保存语音专用 Key；传空串表示清除 */
export const setSpeechApiKey = (key: string): void => {
  try {
    const trimmed = key.trim()
    if (trimmed) {
      localStorage.setItem(SPEECH_KEY_STORAGE, trimmed)
    } else {
      localStorage.removeItem(SPEECH_KEY_STORAGE)
    }
  } catch {
    // 存储不可用时只在本次会话里失效
  }
}

/** 当前是否可调用语音：有官方 API Key 才行（账号 token 不被 tools 接口接受） */
export const speechAccountReady = (): boolean => speechApiKey().length > 0

/** 未配置语音 Key 时抛出的固定错误；界面层据此提示去填 Key */
export const speechAccountError = (): ApiError =>
  new ApiError('http', 'speech requires a DeepSeek API key', 401)

/** 语音接口的鉴权头：只认 Bearer API Key */
const speechHeaders = (extra: Record<string, string> = {}): Record<string, string> => {
  const key = speechApiKey()
  if (!key) {
    throw speechAccountError()
  }
  return { Authorization: `Bearer ${key}`, ...extra }
}

/** 语音识别：POST /v1/tools/asr（Bearer API Key） */
export const transcribe = async (
  audio: Blob,
  signal?: AbortSignal
): Promise<string> => {
  const headers = speechHeaders()
  const form = new FormData()
  form.append('file', audio, 'recording.wav')
  const response = await request(`${toolsBaseUrl()}/asr`, {
    method: 'POST',
    headers,
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

/** 语音合成：POST /v1/tools/tts（Bearer API Key），返回裸 PCM */
export const synthesize = async (
  text: string,
  voice: TtsVoice,
  signal: AbortSignal
): Promise<SynthesizeResult> => {
  const response = await request(`${toolsBaseUrl()}/tts`, {
    method: 'POST',
    headers: speechHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ text, voice_id: voice, format: 'pcm', filter_markdown: true }),
    signal,
  })
  if (!response.body) {
    throw new ApiError('protocol', await response.text())
  }
  return { stream: response.body, isPcm: true }
}
