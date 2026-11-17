import { ApiError, request } from './client.js'
import { joinApiPath, parseCustomHeaders } from './origin.js'
import { readServerSentEvents } from './sse.js'
import type { CreateMessageRequest, MessageStreamEvent, MessageUsage } from './types.js'

const toUsageInt = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0

const parseOpenAIUsage = (raw: unknown): MessageUsage | undefined => {
  if (typeof raw !== 'object' || raw === null) {
    return undefined
  }
  const obj = raw as Record<string, unknown>
  const prompt = toUsageInt(obj.prompt_tokens ?? obj.input_tokens)
  const output = toUsageInt(obj.completion_tokens ?? obj.output_tokens)
  const promptDetails =
    typeof obj.prompt_tokens_details === 'object' && obj.prompt_tokens_details !== null
      ? (obj.prompt_tokens_details as Record<string, unknown>)
      : typeof obj.input_tokens_details === 'object' && obj.input_tokens_details !== null
        ? (obj.input_tokens_details as Record<string, unknown>)
        : undefined
  const cached = toUsageInt(promptDetails?.cached_tokens)
  const input = Math.max(0, prompt - cached)
  if (prompt === 0 && output === 0) {
    return undefined
  }
  return {
    input_tokens: input,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: cached,
    output_tokens: output,
  }
}

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string | OpenAIContentPart[]
}

export const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('Failed to read blob'))
      }
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'))
    reader.readAsDataURL(blob)
  })

const buildAuthHeaders = (apiKey: string, customHeadersRaw = ''): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...parseCustomHeaders(customHeadersRaw),
  ...(apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}),
})

const toOpenAIMessages = (
  body: CreateMessageRequest,
  inlineImages: ReadonlyMap<string, string>,
  inlineTexts: ReadonlyMap<string, string>
): OpenAIMessage[] => {
  const result: OpenAIMessage[] = []
  if (body.system?.trim()) {
    result.push({ role: 'system', content: body.system.trim() })
  }
  let pendingReminder = ''
  for (const msg of body.messages) {
    if (msg.role === 'latest_reminder') {
      pendingReminder = msg.content
      continue
    }
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        const text = pendingReminder
          ? `[上下文信息：${pendingReminder}]\n${msg.content}`
          : msg.content
        pendingReminder = ''
        result.push({ role: 'user', content: text })
      } else {
        const parts: OpenAIContentPart[] = []
        if (pendingReminder) {
          parts.push({ type: 'text', text: `[上下文信息：${pendingReminder}]` })
          pendingReminder = ''
        }
        for (const block of msg.content) {
          if (block.type === 'text') {
            parts.push({ type: 'text', text: block.text })
          } else if (block.type === 'image') {
            const url = inlineImages.get(block.source.file_id)
            if (url) {
              parts.push({ type: 'image_url', image_url: { url } })
            }
          } else if (block.type === 'document') {
            const docText = inlineTexts.get(block.source.file_id)
            if (docText) {
              parts.push({ type: 'text', text: docText })
            }
          }
        }
        result.push({
          role: 'user',
          content: parts.length > 0 ? parts : [{ type: 'text', text: '' }],
        })
      }
      continue
    }
    const text = msg.content
      .flatMap((block) => (block.type === 'text' && block.text ? [block.text] : []))
      .join('\n\n')
    if (text) {
      result.push({ role: 'assistant', content: text })
    }
  }
  return result
}

type ResponsesInputPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string }
  | { type: 'output_text'; text: string }

type ResponsesInputItem = {
  role: 'user' | 'assistant'
  content: ResponsesInputPart[]
}

const toResponsesInput = (
  body: CreateMessageRequest,
  inlineImages: ReadonlyMap<string, string>,
  inlineTexts: ReadonlyMap<string, string>
): ResponsesInputItem[] => {
  const result: ResponsesInputItem[] = []
  let pendingReminder = ''
  for (const msg of body.messages) {
    if (msg.role === 'latest_reminder') {
      pendingReminder = msg.content
      continue
    }
    if (msg.role === 'user') {
      const parts: ResponsesInputPart[] = []
      if (pendingReminder) {
        parts.push({ type: 'input_text', text: `[上下文信息：${pendingReminder}]` })
        pendingReminder = ''
      }
      if (typeof msg.content === 'string') {
        parts.push({ type: 'input_text', text: msg.content })
      } else {
        for (const block of msg.content) {
          if (block.type === 'text') {
            parts.push({ type: 'input_text', text: block.text })
          } else if (block.type === 'image') {
            const url = inlineImages.get(block.source.file_id)
            if (url) {
              parts.push({ type: 'input_image', image_url: url })
            }
          } else if (block.type === 'document') {
            const docText = inlineTexts.get(block.source.file_id)
            if (docText) {
              parts.push({ type: 'input_text', text: docText })
            }
          }
        }
      }
      result.push({
        role: 'user',
        content: parts.length > 0 ? parts : [{ type: 'input_text', text: '' }],
      })
      continue
    }
    const text = msg.content
      .flatMap((block) => (block.type === 'text' && block.text ? [block.text] : []))
      .join('\n\n')
    if (text) {
      result.push({ role: 'assistant', content: [{ type: 'output_text', text }] })
    }
  }
  return result
}

const mapFinishReason = (reason: unknown): 'end_turn' | 'max_tokens' | 'refusal' => {
  if (reason === 'length' || reason === 'max_output_tokens') {
    return 'max_tokens'
  }
  if (reason === 'content_filter') {
    return 'refusal'
  }
  return 'end_turn'
}

/**
 * 调用 OpenAI 兼容 /v1/chat/completions 流式接口，并转换为统一 MessageStreamEvent。
 */
export async function* streamOpenAIMessage(
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
    stream: true,
    stream_options: { include_usage: true },
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(body.top_p !== undefined ? { top_p: body.top_p } : {}),
    ...(body.max_tokens !== undefined ? { max_tokens: body.max_tokens } : {}),
  }

  const response = await request(url, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(apiKey, customHeadersRaw),
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(payload),
    signal,
  })

  if (!response.body) {
    throw new ApiError('protocol', '')
  }

  let started = false
  let thinkingIndex: number | null = null
  let textIndex: number | null = null
  let nextBlockIndex = 0
  let finishReason: 'end_turn' | 'max_tokens' | 'refusal' = 'end_turn'
  let usage: MessageUsage | undefined

  const ensureStart = function* () {
    if (!started) {
      started = true
      yield {
        type: 'message_start',
        message: { id: `oai_${Date.now()}`, model: body.model },
      } satisfies MessageStreamEvent
    }
  }

  for await (const { data } of readServerSentEvents(response.body, signal)) {
    const trimmed = data.trim()
    if (!trimmed || trimmed === '[DONE]') {
      if (trimmed === '[DONE]') {
        break
      }
      continue
    }
    let chunk: unknown
    try {
      chunk = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (typeof chunk !== 'object' || chunk === null) {
      continue
    }
    const obj = chunk as Record<string, unknown>
    if (
      typeof obj.error === 'object' &&
      obj.error !== null &&
      typeof (obj.error as Record<string, unknown>).message === 'string'
    ) {
      throw new ApiError('stream', (obj.error as Record<string, unknown>).message as string)
    }
    if (obj.usage !== undefined) {
      usage = parseOpenAIUsage(obj.usage) ?? usage
    }
    const choices = Array.isArray(obj.choices) ? obj.choices : []
    const choice = choices[0] as Record<string, unknown> | undefined
    if (!choice) {
      continue
    }
    if (typeof choice.finish_reason === 'string') {
      finishReason = mapFinishReason(choice.finish_reason)
    }
    const delta =
      typeof choice.delta === 'object' && choice.delta !== null
        ? (choice.delta as Record<string, unknown>)
        : undefined
    if (!delta) {
      continue
    }

    const reasoningDelta =
      typeof delta.reasoning_content === 'string'
        ? delta.reasoning_content
        : typeof delta.reasoning === 'string'
          ? delta.reasoning
          : ''
    if (reasoningDelta) {
      yield* ensureStart()
      if (thinkingIndex === null) {
        thinkingIndex = nextBlockIndex++
        yield {
          type: 'content_block_start',
          index: thinkingIndex,
          content_block: { type: 'thinking', thinking: '', signature: '' },
        }
      }
      yield {
        type: 'content_block_delta',
        index: thinkingIndex,
        delta: { type: 'thinking_delta', thinking: reasoningDelta },
      }
    }

    const textDelta = typeof delta.content === 'string' ? delta.content : ''
    if (textDelta) {
      yield* ensureStart()
      if (thinkingIndex !== null && textIndex === null) {
        yield { type: 'content_block_stop', index: thinkingIndex }
      }
      if (textIndex === null) {
        textIndex = nextBlockIndex++
        yield {
          type: 'content_block_start',
          index: textIndex,
          content_block: { type: 'text', text: '' },
        }
      }
      yield {
        type: 'content_block_delta',
        index: textIndex,
        delta: { type: 'text_delta', text: textDelta },
      }
    }
  }

  yield* ensureStart()
  if (thinkingIndex !== null && textIndex === null) {
    yield { type: 'content_block_stop', index: thinkingIndex }
  }
  if (textIndex !== null) {
    yield { type: 'content_block_stop', index: textIndex }
  }
  yield {
    type: 'message_delta',
    delta: { stop_reason: finishReason, stop_sequence: null },
    ...(usage ? { usage } : {}),
  }
  yield { type: 'message_stop' }
}

/**
 * 调用 OpenAI Responses API (/v1/responses) 流式接口，并转换为统一 MessageStreamEvent。
 */
export async function* streamResponsesMessage(
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
    stream: true,
    store: false,
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(body.top_p !== undefined ? { top_p: body.top_p } : {}),
    ...(body.max_tokens !== undefined ? { max_output_tokens: body.max_tokens } : {}),
  }

  const response = await request(url, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(apiKey, customHeadersRaw),
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(payload),
    signal,
  })

  if (!response.body) {
    throw new ApiError('protocol', '')
  }

  let started = false
  let thinkingIndex: number | null = null
  let textIndex: number | null = null
  let nextBlockIndex = 0
  let finishReason: 'end_turn' | 'max_tokens' | 'refusal' = 'end_turn'
  let usage: MessageUsage | undefined
  let receivedTextDelta = false

  const ensureStart = function* () {
    if (!started) {
      started = true
      yield {
        type: 'message_start',
        message: { id: `resp_${Date.now()}`, model: body.model },
      } satisfies MessageStreamEvent
    }
  }

  for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
    const trimmed = data.trim()
    if (!trimmed || trimmed === '[DONE]') {
      if (trimmed === '[DONE]') {
        break
      }
      continue
    }
    let chunk: unknown
    try {
      chunk = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (typeof chunk !== 'object' || chunk === null) {
      continue
    }
    const obj = chunk as Record<string, unknown>
    const type = typeof obj.type === 'string' ? obj.type : eventName

    if (type === 'error' || type === 'response.failed') {
      const errObj =
        (obj.error as Record<string, unknown> | undefined) ??
        ((obj.response as Record<string, unknown> | undefined)?.error as
          | Record<string, unknown>
          | undefined)
      const msg = typeof errObj?.message === 'string' ? errObj.message : 'Responses API error'
      throw new ApiError('stream', msg)
    }

    if (
      type === 'response.reasoning_summary_text.delta' ||
      type === 'response.reasoning_text.delta'
    ) {
      const delta = typeof obj.delta === 'string' ? obj.delta : ''
      if (delta) {
        yield* ensureStart()
        if (thinkingIndex === null) {
          thinkingIndex = nextBlockIndex++
          yield {
            type: 'content_block_start',
            index: thinkingIndex,
            content_block: { type: 'thinking', thinking: '', signature: '' },
          }
        }
        yield {
          type: 'content_block_delta',
          index: thinkingIndex,
          delta: { type: 'thinking_delta', thinking: delta },
        }
      }
      continue
    }

    if (type === 'response.output_text.delta') {
      const delta = typeof obj.delta === 'string' ? obj.delta : ''
      if (delta) {
        receivedTextDelta = true
        yield* ensureStart()
        if (thinkingIndex !== null && textIndex === null) {
          yield { type: 'content_block_stop', index: thinkingIndex }
        }
        if (textIndex === null) {
          textIndex = nextBlockIndex++
          yield {
            type: 'content_block_start',
            index: textIndex,
            content_block: { type: 'text', text: '' },
          }
        }
        yield {
          type: 'content_block_delta',
          index: textIndex,
          delta: { type: 'text_delta', text: delta },
        }
      }
      continue
    }

    if (type === 'response.output_text.done' && !receivedTextDelta) {
      const full = typeof obj.text === 'string' ? obj.text : ''
      if (full) {
        yield* ensureStart()
        if (textIndex === null) {
          textIndex = nextBlockIndex++
          yield {
            type: 'content_block_start',
            index: textIndex,
            content_block: { type: 'text', text: '' },
          }
        }
        yield {
          type: 'content_block_delta',
          index: textIndex,
          delta: { type: 'text_delta', text: full },
        }
      }
      continue
    }

    if (type === 'response.completed' || type === 'response.incomplete') {
      const respObj = obj.response as Record<string, unknown> | undefined
      usage = parseOpenAIUsage(respObj?.usage ?? obj.usage) ?? usage
    }

    if (type === 'response.incomplete') {
      const reason = (
        (obj.response as Record<string, unknown> | undefined)?.incomplete_details as
          | Record<string, unknown>
          | undefined
      )?.reason
      finishReason = mapFinishReason(reason)
    }
  }

  yield* ensureStart()
  if (thinkingIndex !== null && textIndex === null) {
    yield { type: 'content_block_stop', index: thinkingIndex }
  }
  if (textIndex !== null) {
    yield { type: 'content_block_stop', index: textIndex }
  }
  yield {
    type: 'message_delta',
    delta: { stop_reason: finishReason, stop_sequence: null },
    ...(usage ? { usage } : {}),
  }
  yield { type: 'message_stop' }
}

/** 使用自定义视觉 / OCR 模型（OpenAI Chat Completions 兼容）识别图片或文档内容 */
export const recognizeWithOpenAIVision = async ({
  baseUrl,
  apiKey,
  model,
  prompt,
  dataUrl,
  signal,
  customHeadersRaw = '',
}: {
  baseUrl: string
  apiKey: string
  model: string
  prompt: string
  dataUrl: string
  signal?: AbortSignal
  customHeadersRaw?: string
}): Promise<string> => {
  const url = joinApiPath(baseUrl, '/chat/completions')
  const response = await request(url, {
    method: 'POST',
    headers: buildAuthHeaders(apiKey, customHeadersRaw),
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
    signal,
  })
  const json: unknown = await response.json()
  if (typeof json !== 'object' || json === null) {
    return ''
  }
  const choices = (json as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) {
    return ''
  }
  const message = (choices[0] as { message?: { content?: unknown } }).message
  if (typeof message?.content === 'string') {
    return message.content.trim()
  }
  if (Array.isArray(message?.content)) {
    return message.content
      .map((part) =>
        typeof part === 'object' &&
        part !== null &&
        typeof (part as { text?: unknown }).text === 'string'
          ? (part as { text: string }).text
          : ''
      )
      .join('')
      .trim()
  }
  return ''
}

