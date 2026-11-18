import type {
  AssistantMessage,
  Message,
  Session,
  SessionCompaction,
  UserMessage,
} from './types.js'
import { getContextRounds } from './reply.js'

/**
 * 上下文自动压缩。
 *
 * 会话越聊越长，历史会一直堆进每次请求，直到服务端因为超出上下文窗口直接报错。
 * 这里在请求前量一下历史体积，接近模型上下文上限（默认 80%）时，把较早的轮次交给模型
 * 总结成一段摘要，之后只把「摘要 + 最近若干轮原文」发出去。
 *
 * 关键取舍：
 * - 只影响**发送给模型的内容**，本地消息一条不删，界面照旧能往上翻。
 * - 摘要挂在会话上并记录「已压缩到哪条消息」，后续只在新增轮次上增量压缩，不重复总结。
 * - 估算用字符数 / 2.2（中英混排的经验值），不引入 tokenizer，宁可估高避免卡在边界。
 */

/** 单次请求里给历史留的上下文预算，按模型粗略给出；未知模型用保守值。 */
const CONTEXT_WINDOWS: Record<string, number> = {
  'deepseek-flash': 128_000,
  'deepseek-chat': 128_000,
  'deepseek-reasoner': 128_000,
  'deepseek-v3': 128_000,
  'deepseek-r1': 128_000,
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4.1': 128_000,
  'gpt-4.1-mini': 128_000,
  'claude-3-5-sonnet': 200_000,
  'claude-sonnet-4': 200_000,
  'claude-opus-4': 200_000,
  'qwen-max': 32_000,
  'qwen-plus': 128_000,
  'gemini-2.5-pro': 1_000_000,
  'gemini-2.5-flash': 1_000_000,
}

/** 未知模型的默认窗口，宁小勿大，避免第三方接口提前报错。 */
const DEFAULT_CONTEXT_WINDOW = 64_000
/** 中英混排下 1 token ≈ 2.2 个字符 */
const CHARS_PER_TOKEN = 2.2
/** 触发压缩的占比 */
const COMPACT_TRIGGER_RATIO = 0.8
/** 压缩后至少保留最近几轮原文，保证衔接自然 */
const MIN_KEEP_ROUNDS = 2
/** 压缩后目标占用量，压到 50% 左右，避免立刻再次触发 */
const COMPACT_TARGET_RATIO = 0.5
/** 摘要自身的长度上限 */
export const SUMMARY_MAX_CHARS = 3000
/** 每轮提问/回答在摘要输入里的截断长度 */
const SUMMARY_INPUT_CLIP = 900
/** 摘要输入的总体积硬上限（字符）：导入的超长对话也不会把压缩请求自己撑爆 */
const SUMMARY_INPUT_TOTAL_MAX = 240_000
/** 至少要有这么多轮才值得压缩 */
const MIN_ROUNDS_TO_COMPACT = 4

export const getContextWindow = (model: string, override?: number): number => {
  // 用户显式配置过窗口时以用户为准
  if (override && Number.isFinite(override) && override >= 4000) {
    return override
  }
  const id = model.trim().toLowerCase()
  const direct = CONTEXT_WINDOWS[id]
  if (direct) {
    return direct
  }
  // 带日期或后缀的模型名（gpt-4o-2024-08-06）按前缀匹配
  const prefix = Object.keys(CONTEXT_WINDOWS).find((key) => id.startsWith(key))
  return prefix ? CONTEXT_WINDOWS[prefix] : DEFAULT_CONTEXT_WINDOW
}

/** 粗略估算一段文本的 token 数 */
export const estimateTokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN)

/** 一条消息在请求里占用的估算 token：正文 + 思考（历史不回传思考，不计）+ 少量结构开销 */
const messageTokens = (message: Message): number => {
  if (message.role === 'user') {
    return estimateTokens(message.content) + message.files.length * 8 + 4
  }
  const text = message.blocks
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n')
  return estimateTokens(text) + 4
}

/**
 * 请求里历史部分的估算 token：未被摘要覆盖的轮次 + 摘要本身。
 * 已压缩的轮次不再发送，因此不计入，否则会一直判定超阈值、反复压缩。
 */
export const estimateHistoryTokens = (
  history: Message[],
  compaction: Compaction | undefined,
  allowRefused = false
): number => {
  const summaryTokens = compaction?.summary ? estimateTokens(compaction.summary) : 0
  const rounds = getContextRounds(history, allowRefused)
  const through = compaction?.throughMessageId
  const startIndex = through
    ? rounds.findIndex(([, reply]) => reply.id === through) + 1
    : 0
  let total = summaryTokens
  for (const [user, reply] of rounds.slice(Math.max(0, startIndex))) {
    total += messageTokens(user) + messageTokens(reply)
  }
  return total
}

export type Compaction = SessionCompaction

export type CompactionPlan = {
  /** 需要摘要掉的轮次 */
  covered: [UserMessage, AssistantMessage][]
  /** 保留原文的轮次 */
  kept: [UserMessage, AssistantMessage][]
  /** 覆盖到的最后一条消息（回答）的 id */
  throughMessageId: string
}

/**
 * 判断是否需要压缩，并算出压缩边界。
 * `usedTokens` 传本轮请求扣除待发内容后的历史用量。
 */
export const planCompaction = ({
  history,
  compaction,
  model,
  allowRefused,
  contextWindow,
}: {
  history: Message[]
  compaction: Compaction | undefined
  model: string
  allowRefused: boolean
  /** 用户配置的上下文窗口；缺省时按模型名推断 */
  contextWindow?: number
}): CompactionPlan | null => {
  const window = getContextWindow(model, contextWindow)
  const trigger = window * COMPACT_TRIGGER_RATIO
  const used = estimateHistoryTokens(history, compaction, allowRefused)
  if (used < trigger) {
    return null
  }
  const rounds = getContextRounds(history, allowRefused)
  if (rounds.length < MIN_ROUNDS_TO_COMPACT) {
    return null
  }
  // 已经压过的轮次不再进 covered：throughMessageId 记的是被覆盖的最后一条「回答」
  const compactedThrough = compaction?.throughMessageId
  const cutIndex = compactedThrough
    ? rounds.findIndex(([, reply]) => reply.id === compactedThrough) + 1
    : 0
  const pending = rounds.slice(Math.max(0, cutIndex))
  if (pending.length < MIN_ROUNDS_TO_COMPACT) {
    return null
  }
  // 从尾部往前保留，直到估算用量回落到目标线以下
  const target = window * COMPACT_TARGET_RATIO
  const kept: [UserMessage, AssistantMessage][] = []
  let keptTokens = 0
  let splitAt = pending.length
  for (let i = pending.length - 1; i >= 0; i--) {
    const [user, reply] = pending[i]
    const pairTokens = messageTokens(user) + messageTokens(reply)
    if (kept.length >= MIN_KEEP_ROUNDS && keptTokens + pairTokens > target) {
      splitAt = i + 1
      break
    }
    kept.unshift(pending[i])
    keptTokens += pairTokens
    splitAt = i
  }
  const covered = pending.slice(0, splitAt)
  if (covered.length < 2) {
    return null
  }
  const lastCovered = covered.at(-1)?.[1]
  if (!lastCovered) {
    return null
  }
  return { covered, kept, throughMessageId: lastCovered.id }
}

/**
 * 手动（主动）压缩的计划（v2.8.8）。
 *
 * 和自动压缩的区别：**不看是否到 80% 阈值**，由用户点「立即压缩」触发。
 * 语义是「把较早的轮次压成摘要，只保留最近 keepRounds 轮原文」。
 *
 * @param keepRounds 保留最近多少轮原文；至少 MIN_KEEP_ROUNDS 轮
 * @returns 没有可压缩的内容时返回 null（轮次太少 / 已经全压过了）
 */
export const planManualCompaction = ({
  history,
  compaction,
  allowRefused,
  keepRounds = 3,
}: {
  history: Message[]
  compaction: Compaction | undefined
  allowRefused: boolean
  keepRounds?: number
}): CompactionPlan | null => {
  const rounds = getContextRounds(history, allowRefused)
  // 已经压过的轮次不再进 covered：throughMessageId 记的是被覆盖的最后一条「回答」
  const compactedThrough = compaction?.throughMessageId
  const cutIndex = compactedThrough
    ? rounds.findIndex(([, reply]) => reply.id === compactedThrough) + 1
    : 0
  const pending = rounds.slice(Math.max(0, cutIndex))
  const keep = Math.max(MIN_KEEP_ROUNDS, keepRounds)
  // 至少要能压掉 1 轮，否则没有意义
  if (pending.length <= keep) {
    return null
  }
  const splitAt = pending.length - keep
  const covered = pending.slice(0, splitAt)
  const kept = pending.slice(splitAt)
  const lastCovered = covered.at(-1)?.[1]
  if (!lastCovered) {
    return null
  }
  return { covered, kept, throughMessageId: lastCovered.id }
}

/**
 * 手动压缩可用的轮次统计，用于界面提示「可压缩 N 轮」。
 */
export const manualCompactionStats = ({
  history,
  compaction,
  allowRefused,
  keepRounds = 3,
}: {
  history: Message[]
  compaction: Compaction | undefined
  allowRefused: boolean
  keepRounds?: number
}): { total: number; compactable: number; keep: number } => {
  const rounds = getContextRounds(history, allowRefused)
  const compactedThrough = compaction?.throughMessageId
  const cutIndex = compactedThrough
    ? rounds.findIndex(([, reply]) => reply.id === compactedThrough) + 1
    : 0
  const pending = rounds.slice(Math.max(0, cutIndex))
  const keep = Math.max(MIN_KEEP_ROUNDS, keepRounds)
  return {
    total: rounds.length,
    compactable: Math.max(0, pending.length - keep),
    keep: Math.min(keep, pending.length),
  }
}

/** 把待压缩轮次拼成给总结模型的输入 */export const buildSummaryPrompt = (
  covered: [UserMessage, AssistantMessage][],
  previousSummary: string | undefined
): string => {
  const clip = (text: string) =>
    text.length > SUMMARY_INPUT_CLIP ? `${text.slice(0, SUMMARY_INPUT_CLIP)}…` : text
  const body = covered
    .map(([user, reply], index) => {
      const answer = reply.blocks
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('\n')
      return `### 第 ${index + 1} 轮\n用户：${clip(user.content)}\n助手：${clip(answer)}`
    })
    .join('\n\n')
  const previous = previousSummary?.trim()
  const joined = [previous ? `已有摘要（需要在此基础上续写）：\n${previous}\n` : '', body]
    .filter(Boolean)
    .join('\n')
  // 导入的超长对话一次可能带来几十轮原文；输入总体积再设硬上限，
  // 超限时从前往后保留（较新的轮次靠后，截掉的是最早的内容），保证压缩请求自身不超限
  return joined.length > SUMMARY_INPUT_TOTAL_MAX
    ? `${joined.slice(-SUMMARY_INPUT_TOTAL_MAX)}…`
    : joined
}

export const SUMMARY_SYSTEM_PROMPT = `你是对话压缩器。把给定的历史对话压缩成一段可供后续对话直接使用的摘要。

要求：
1. 只输出摘要正文，不要任何前言、标题、解释或 markdown 代码块。
2. 保留：用户的目标与需求、已达成的结论与决定、关键事实与数据（人名、数字、路径、版本、参数）、尚未解决或待办的事项、用户的偏好与明确要求。
3. 丢弃：寒暄、重复啰嗦的表述、已被推翻的中间方案、无关的旁支讨论。
4. 用第三人称、条目式中文表述（用「-」开头分行），控制在 800 字以内。
5. 如果给了「已有摘要」，把它和新内容合并成一段新摘要，不要出现「上面提到」「此前说过」这类依赖上下文的措辞。`

/** 会话是否已经压缩过 */
export const hasCompaction = (session: Session): boolean => Boolean(session.compaction?.summary)

/** 摘要用于注入请求的系统提示块 */
export const formatCompactionContext = (summary: string): string =>
  `以下是本次对话较早内容的压缩摘要（较早轮次原文已省略，需要细节时可按用户要求重新询问）：\n${summary}`

/** 压缩状态展示用的进度：0~1 */
export const contextUsageRatio = (
  history: Message[],
  compaction: Compaction | undefined,
  model: string,
  extraTokens = 0,
  override?: number
): number => {
  const window = getContextWindow(model, override)
  const used = estimateHistoryTokens(history, compaction) + extraTokens
  return window > 0 ? Math.min(1, used / window) : 0
}

/**
 * 从历史里读出服务端真实返回的上下文占用。
 *
 * 之前只按字符数估算（chars / 2.2），中文、代码、附件都估不准，
 * 用户看到的百分比和实际差得远，像是「只是个样子」。
 * 其实每条助手回复都带 usage：input_tokens 就是那一轮实际发过去的上下文，
 * 加上该轮输出，就是当前真实占用。
 *
 * @param history 当前可见消息（按时间顺序）
 * @returns 真实占用 token 数；没有任何 usage 记录时返回 null
 */
export const actualContextTokens = (history: Message[]): number | null => {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i]
    if (message.role !== 'assistant' || !message.usage) {
      continue
    }
    const { input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens } =
      message.usage
    // input 三类相加才是完整上下文（缓存命中的部分单独计）
    const total =
      (input_tokens ?? 0) +
      (cache_creation_input_tokens ?? 0) +
      (cache_read_input_tokens ?? 0) +
      (output_tokens ?? 0)
    if (total > 0) {
      return total
    }
  }
  return null
}

/**
 * 上下文占用比例：优先用服务端真实 token，没有记录时才退回估算。
 * @returns { ratio, tokens, estimated } —— estimated 为 true 表示是估算值
 */
export const contextUsageDetail = (
  history: Message[],
  compaction: Compaction | undefined,
  model: string,
  extraTokens = 0,
  override?: number
): { ratio: number; tokens: number; estimated: boolean } => {
  const window = getContextWindow(model, override)
  const actual = actualContextTokens(history)
  if (actual !== null) {
    const tokens = actual + extraTokens
    return { ratio: window > 0 ? Math.min(1, tokens / window) : 0, tokens, estimated: false }
  }
  const tokens = estimateHistoryTokens(history, compaction) + extraTokens
  return { ratio: window > 0 ? Math.min(1, tokens / window) : 0, tokens, estimated: true }
}
