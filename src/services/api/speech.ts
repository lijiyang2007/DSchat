/**
 * 语音接口（v2.7.5 起锁死官方）：
 * ASR POST /v1/tools/asr、TTS POST /v1/tools/tts，只由 DeepSeek 官方提供。
 *
 * 鉴权只认登录账号的 x-dsh-auth-token（走账号额度）：
 * 未登录 DeepSeek 账号时语音功能整体不可用——未登录直接抛 NO_ACCOUNT，
 * 界面把入口禁用并提示「登录官方账号后可用」。
 * API Key 不再用于语音：官方语音按账号额度计费，Key 用户走聊天即可。
 */

import { ApiError, request } from './client.js'
import { getApiOrigin, normalizeOrigin } from './origin.js'
import { accountToken } from '../account.js'

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

/** 当前账号是否可使用语音功能：必须登录 DeepSeek 官方账号 */
export const speechAccountReady = (): boolean => Boolean(accountToken())

/** 未登录账号时抛出的固定错误；界面层据此提示登录 */
export const speechAccountError = (): ApiError =>
  new ApiError('http', 'speech requires a signed-in DeepSeek account', 401)

/** 语音识别：POST /v1/tools/asr（官方账号额度） */
export const transcribe = async (
  audio: Blob,
  signal?: AbortSignal
): Promise<string> => {
  const token = accountToken()
  if (!token) {
    throw speechAccountError()
  }
  const form = new FormData()
  form.append('file', audio, 'recording.wav')
  const response = await request(`${toolsBaseUrl()}/asr`, {
    method: 'POST',
    headers: { 'x-dsh-auth-token': token },
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

/** 语音合成：POST /v1/tools/tts（官方账号额度），返回裸 PCM */
export const synthesize = async (
  text: string,
  voice: TtsVoice,
  signal: AbortSignal
): Promise<SynthesizeResult> => {
  const token = accountToken()
  if (!token) {
    throw speechAccountError()
  }
  const response = await request(`${toolsBaseUrl()}/tts`, {
    method: 'POST',
    headers: { 'x-dsh-auth-token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice_id: voice, format: 'pcm', filter_markdown: true }),
    signal,
  })
  if (!response.body) {
    throw new ApiError('protocol', await response.text())
  }
  return { stream: response.body, isPcm: true }
}
