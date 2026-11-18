/**
 * 非流式对话层：流式输出在部分网关上表现不稳定（增量丢失、蹦段、断流），
 * 从 v2.7.1 起整体回归非流式：请求一次拿完整回答，界面按「一次性出结果」展示。
 *
 * 三条协议都实现为统一的 MessageStreamEvent 异步生成器——
 * store 的渲染、用量统计、标题提取、错误处理管线原样复用，只是事件一次性到达。
 */

import { ApiError, request, anthropicUrl, anthropicAuthHeaders } from './client.js'
import { joinApiPath, parseCustomHeaders } from './origin.js'
import type { CreateMessageRequest, MessageStreamEvent, MessageUsage } from './types.js'
import {
  toOpenAIMessages,
  toResponsesInput,
  parseOpenAIUsage,
  mapFinishReason,
} from './openai.js'

const toUsageInt = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0

const authHeaders = (apiKey: string, customHeadersRaw = ''): Record<string, string> => ({
  'Content-Type': 'application/json',
  Accept: 'application/json',
  ...parseCustomHeaders(customHeadersRaw),
  ...(apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}),
})

/** 把一次完整响应合成事件流；thinking 放前面，与流式的块顺序一致 */
const emitUnified = async function* (
  model: string,
  thinking: string,
  text: string,
  finishReason: 'end_turn' | 'max_tokens' | 'refusal',
  usage: MessageUsage | undefined
): AsyncGenerator<MessageStreamEvent> {
  let index = 0
  yield { type: 'message_start', message: { id: `nf_${Date.now()}`, model } }
  if (thinking) {
    yield {
      type: 'content_block_start',
      index,
      content_block: { type: 'thinking', thinking: '', signature: '' },
    }
    yield { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking } }
    yield { type: 'content_block_stop', index }
    index += 1
  }
  if (text) {
    yield { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }
    yield { type: 'content_block_delta', index, delta: { type: 'text_delta', text } }
    yield { type: 'content_block_stop', index }
    index += 1
  }
  yield {
    type: 'message_delta',
    delta: { stop_reason: finishReason, stop_sequence: null },
    ...(usage ? { usage } : {}),
  }
  yield { type: 'message_stop' }
}

const readErrorBody = async (response: Response): Promise<ApiError> => {
  const raw = await response.text().catch(() => '')
  let message = raw || response.statusText
  try {
    const body = JSON.parse(raw) as { error?: { message?: string }; message?: string }
    message = body.error?.message ?? body.message ?? raw
  } catch {
    // 非 JSON 响应体直接展示原文
  }
  return new ApiError('http', message, response.status)
}

/** OpenAI 兼容 /v1/chat/completions 非流式 */
export async function* fetchOpenAIMessage(
  baseUrl: string,
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal,
  inlineImages: ReadonlyMap<string, string> = new Map(),
  inlineTexts: ReadonlyMap<string, string> = new Map(),
  customHeadersRaw = ''
): AsyncGenerator<MessageStreamEvent> {
  const url = joinApiPath(baseUrl, '/chat/completions')
  const payload: Record<string, unknown> = {
    model: body.model,
    messages: toOpenAIMessages(body, inlineImages, inlineTexts),
    stream: false,
    ...(body.reasoning_effort ? { reasoning_effort: body.reasoning_effort } : {}),
    ...(body.enable_thinking !== undefined ? { enable_thinking: body.enable_thinking } : {}),
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(body.top_p !== undefined ? { top_p: body.top_p } : {}),
    ...(body.max_tokens !== undefined ? { max_tokens: body.max_tokens } : {}),
  }
  const response = await request(url, {
    method: 'POST',
    headers: authHeaders(apiKey, customHeadersRaw),
    body: JSON.stringify(payload),
    signal,
  })
  if (!response.ok) {
    throw await readErrorBody(response)
  }
  const json: unknown = await response.json()
  if (typeof json !== 'object' || json === null) {
    throw new ApiError('protocol', '')
  }
  const obj = json as Record<string, unknown>
  if (
    typeof obj.error === 'object' &&
    obj.error !== null &&
    typeof (obj.error as Record<string, unknown>).message === 'string'
  ) {
    throw new ApiError('stream', (obj.error as Record<string, unknown>).message as string)
  }
  const usage = parseOpenAIUsage(obj.usage)
  const choices = Array.isArray(obj.choices) ? obj.choices : []
  const choice = (choices[0] ?? {}) as Record<string, unknown>
  const message = (choice.message ?? {}) as Record<string, unknown>
  const finishReason = mapFinishReason(choice.finish_reason)
  const thinking =
    typeof message.reasoning_content === 'string'
      ? message.reasoning_content
      : typeof message.reasoning === 'string'
        ? message.reasoning
        : ''
  const text = typeof message.content === 'string' ? message.content : ''
  if (!text && !thinking) {
    throw new ApiError('protocol', '')
  }
  yield* emitUnified(body.model, thinking, text, finishReason, usage)
}

/** OpenAI Responses /v1/responses 非流式（stream: false 时直接返回 response 对象） */
export async function* fetchResponsesMessage(
  baseUrl: string,
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal,
  inlineImages: ReadonlyMap<string, string> = new Map(),
  inlineTexts: ReadonlyMap<string, string> = new Map(),
  customHeadersRaw = ''
): AsyncGenerator<MessageStreamEvent> {
  const url = joinApiPath(baseUrl, '/responses')
  const payload: Record<string, unknown> = {
    model: body.model,
    ...(body.system?.trim() ? { instructions: body.system.trim() } : {}),
    input: toResponsesInput(body, inlineImages, inlineTexts),
    stream: false,
    store: false,
    ...(body.reasoning ? { reasoning: body.reasoning } : {}),
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(body.top_p !== undefined ? { top_p: body.top_p } : {}),
    ...(body.max_tokens !== undefined ? { max_output_tokens: body.max_tokens } : {}),
  }
  const response = await request(url, {
    method: 'POST',
    headers: authHeaders(apiKey, customHeadersRaw),
    body: JSON.stringify(payload),
    signal,
  })
  if (!response.ok) {
    throw await readErrorBody(response)
  }
  const json: unknown = await response.json()
  if (typeof json !== 'object' || json === null) {
    throw new ApiError('protocol', '')
  }
  const obj = json as Record<string, unknown>
  const status = typeof obj.status === 'string' ? obj.status : ''
  if (status === 'failed') {
    const errObj = (obj.error as Record<string, unknown> | undefined) ?? {}
    throw new ApiError('stream', typeof errObj.message === 'string' ? errObj.message : 'Responses API error')
  }
  const usage = parseOpenAIUsage(obj.usage)
  const output = Array.isArray(obj.output) ? obj.output : []
  const incomplete =
    status === 'incomplete'
      ? ((obj.incomplete_details as Record<string, unknown> | undefined)?.reason as
          | string
          | undefined)
      : undefined
  let thinking = ''
  let text = ''
  for (const item of output) {
    if (typeof item !== 'object' || item === null) {
      continue
    }
    const entry = item as Record<string, unknown>
    const contentType = typeof entry.type === 'string' ? entry.type : ''
    if (contentType === 'reasoning') {
      const summary = Array.isArray(entry.summary) ? entry.summary : []
      for (const part of summary) {
        if (typeof part === 'object' && part !== null && typeof (part as Record<string, unknown>).text === 'string') {
          thinking += (part as Record<string, unknown>).text as string
        }
      }
      continue
    }
    if (contentType === 'message') {
      const content = Array.isArray(entry.content) ? entry.content : []
      for (const part of content) {
        if (
          typeof part === 'object' &&
          part !== null &&
          (part as Record<string, unknown>).type === 'output_text' &&
          typeof (part as Record<string, unknown>).text === 'string'
        ) {
          text += (part as Record<string, unknown>).text as string
        }
      }
    }
  }
  if (!text && !thinking) {
    throw new ApiError('protocol', '')
  }
  yield* emitUnified(body.model, thinking, text, mapFinishReason(incomplete), usage)
}

/** Anthropic 兼容 /anthropic/v1/messages 非流式（DeepSeek 官方走这条） */
export async function* fetchAnthropicMessage(
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const response = await request(anthropicUrl(), {
    method: 'POST',
    headers: { ...anthropicAuthHeaders(apiKey, false), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...body,
      // 非流式请求不带 title 生成（title 参数只在流式扩展模式验证过），避免网关报错
      ...(body.title ? {} : {}),
      stream: false,
    }),
    signal,
  })
  if (!response.ok) {
    throw await readErrorBody(response)
  }
  const json: unknown = await response.json()
  if (typeof json !== 'object' || json === null) {
    throw new ApiError('protocol', '')
  }
  const obj = json as Record<string, unknown>
  const content = Array.isArray(obj.content) ? obj.content : []
  const stopRaw = typeof obj.stop_reason === 'string' ? obj.stop_reason : 'end_turn'
  const finishReason =
    stopRaw === 'max_tokens' ? ('max_tokens' as const) : stopRaw === 'refusal' ? ('refusal' as const) : ('end_turn' as const)
  const usageRaw = obj.usage as Record<string, unknown> | undefined
  const usage = usageRaw
    ? {
        input_tokens: toUsageInt(usageRaw.input_tokens ?? usageRaw.inputTokens ?? usageRaw.prompt_tokens),
        cache_creation_input_tokens: toUsageInt(usageRaw.cache_creation_input_tokens),
        cache_read_input_tokens: toUsageInt(usageRaw.cache_read_input_tokens),
        output_tokens: toUsageInt(usageRaw.output_tokens ?? usageRaw.completion_tokens),
      }
    : undefined
  let thinking = ''
  let text = ''
  for (const block of content) {
    if (typeof block !== 'object' || block === null) {
      continue
    }
    const entry = block as Record<string, unknown>
    if (entry.type === 'thinking' && typeof entry.thinking === 'string') {
      thinking += entry.thinking
    } else if (entry.type === 'text' && typeof entry.text === 'string') {
      text += entry.text
    }
  }
  if (!text && !thinking) {
    throw new ApiError('protocol', '')
  }
  yield* emitUnified(body.model, thinking, text, finishReason, usage)
}
