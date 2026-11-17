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

/** 把待压缩轮次拼成给总结模型的输入 */
export const buildSummaryPrompt = (
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
  return [previous ? `已有摘要（需要在此基础上续写）：\n${previous}\n` : '', body]
    .filter(Boolean)
    .join('\n')
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
