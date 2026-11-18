import type { TranslationMessage } from '../../i18n/index.js'
import type { ApiErrorKind } from '../api/client.js'
import type {
  ChatModel,
  MessageUsage,
  ServerToolBlock,
  StopDetails,
  StopReason,
  TextCitation,
} from '../api/types.js'

/**
 * 消息附件。id 是本地标识（IndexedDB files 表的主键，原件按它存储，所有引用同一 id 的消息共用一份），
 * 导入的附件沿用导出产物里的文件 ID；本地没有原件的附件只展示文件名，不进入请求。
 * serverId 是 Files API 返回的 file_id，导入的数据或尚未上传成功的文件为 null，发送前补传。
 */
export type FileAttachment = {
  id: string
  serverId: string | null
  name: string
  size: number
  /** 附件类别；导入时沿用归档的 is_image，不由 MIME 识别结果决定。 */
  isImage: boolean
  /** 具体 MIME；导入时没有原件或无法识别的为空字符串，不影响图片身份。 */
  mimeType: string
}

/** 本地消息的分支关系；字段缺省时按线性消息列表处理。 */
type MessageBranch = {
  parentId?: string | null
  /** 当前选中的下一条消息；切换版本时保留每条分支原有的选择。 */
  selectedChildId?: string
}

export type UserMessage = MessageBranch & {
  id: string
  role: 'user'
  content: string
  files: FileAttachment[]
  createdAt: number
}

/** 思考块：thinking_delta 累积，签名随 signature_delta 到达；历史轮次的思考服务端会丢弃，不回传 */
export type ThinkingPart = {
  type: 'thinking'
  thinking: string
  signature?: string
  /** content_block_start 的时间；没有事件时间的历史块缺省 */
  startedAt?: number
  /** content_block_stop（或回复结束）的时间 */
  endedAt?: number
  /** 仅有耗时、没有事件时间时保存秒数。 */
  elapsedSeconds?: number
}

/** 文本块：text_delta 累积，citations_delta 追加引用 */
export type TextPart = {
  type: 'text'
  text: string
  citations?: TextCitation[]
  /** 服务端提示文案，仅用于展示，不作为模型回答参与上下文或续写。 */
  isTemplate?: boolean
}

/** 服务端工具调用与结果块按协议原样保存；历史请求只回传 read_link 调用与结果 */
export type ReplyBlock = ThinkingPart | TextPart | ServerToolBlock

/**
 * pending：已发出请求，还没收到事件；streaming：正在接收；
 * done：收到 message_stop；stopped：用户停止或页面关闭；error：请求或流出错
 */
export type ReplyStatus = 'pending' | 'streaming' | 'done' | 'stopped' | 'error'

export type AssistantMessage = MessageBranch & {
  id: string
  role: 'assistant'
  createdAt: number
  /** 未记录模型时为 null，续写使用当前默认模型。 */
  model: ChatModel | null
  /** 请求时是否开启深度思考 */
  thinking?: boolean
  /** 请求时是否声明 deepseek_web_search；关闭时仍声明 deepseek_read_url */
  search?: boolean
  /** 本轮请求的系统信息快照；各回答版本独立保存，续写沿用。历史消息中缺省的快照保持为空。 */
  latestReminder?: string
  /** 是否允许作为续写前缀；仍需满足回复状态与内容限制。 */
  prefix: boolean
  status: ReplyStatus
  /** 可识别的内容块按接收顺序排列；续写产生的块追加在已有块之后 */
  blocks: ReplyBlock[]
  stopReason?: StopReason
  stopDetails?: StopDetails
  /** 最近一次请求的用量，续写后更新 */
  usage?: MessageUsage
  error?: {
    /** upload：发送前补传附件失败，请求没有发出 */
    kind: ApiErrorKind | 'upload'
    message: string
    status?: number
    localMessage?: TranslationMessage
    /** 仅 upload：重新上传是否可能成功（网络、限流、服务端繁忙）；过大、格式不支持为 false */
    retryable?: boolean
  }
}

export type Message = UserMessage | AssistantMessage

/** 上下文压缩结果：早期轮次被摘要替代，原文仍保留在本地消息里 */
export type SessionCompaction = {
  /** 替代早期历史的摘要正文 */
  summary: string
  /** 已被摘要覆盖的最后一条消息 id；之前的轮次只以摘要形式发送 */
  throughMessageId: string
  /** 压缩时的估算 token，用于展示 */
  tokens: number
  compactedAt: number
  /** 累计压缩次数，便于排查 */
  count: number
}

export type Session = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /** 包含所有分支的消息，按创建顺序存储。 */
  messages: Message[]
  /** undefined 表示线性消息列表；null 表示空会话。 */
  rootMessageId?: string | null
  /** 上下文自动压缩结果；未压缩过时缺省 */
  compaction?: SessionCompaction
  /** 置顶：列表里始终排在前面 */
  pinned?: boolean
  /** 归档：从对话历史移出，放进「归档」页；恢复后回到历史列表 */
  archived?: boolean
  /** 归档时间，用于归档页按归档先后排序 */
  archivedAt?: number
  /**
   * 导入时间（v2.8.7）：导入的会话据此排在列表最前，方便立刻找到。
   * 原始 updatedAt 保持不变；用户在该会话里继续聊之后，listTime 自然回到真实更新时间。
   */
  importedAt?: number
  /**
   * 导入来源 ID（v2.9.1）：导入时若本机已有同 ID 会话，会给这份换新 ID 另存，
   * 用它记下它在导入包里的原始 ID，重复导入同一个包时据此去重（见 db.commitStaging）。
   */
  sourceId?: string
}

/** 会话列表元数据；消息只在打开会话时加载。 */
export type SessionSummary = Pick<Session, 'id' | 'title' | 'createdAt' | 'updatedAt'> & {
  /** 置顶标记，跟随会话一起持久化 */
  pinned?: boolean
  /** 归档标记，跟随会话一起持久化 */
  archived?: boolean
  /** 归档时间 */
  archivedAt?: number
  /** 导入时间：让刚导入的会话排在列表最前，见 Session.importedAt */
  importedAt?: number
}

/**
 * 会话在列表里的排序/分组时间（v2.8.7）。
 *
 * 导入的会话原始 updatedAt 可能是几个月前，直接按它排会被埋进历史里找不到；
 * 所以取 updatedAt 与 importedAt 的较大值：导入后立刻排最前，
 * 一旦用户在这个会话里继续聊（updatedAt 超过 importedAt），自动回到正常时间线。
 */
export const listTime = (session: { updatedAt: number; importedAt?: number }): number =>
  Math.max(session.updatedAt, session.importedAt ?? 0)

/** 显式提取字段，避免将完整会话的消息带进列表。 */
export const toSessionSummary = (session: SessionSummary): SessionSummary => ({
  id: session.id,
  title: session.title,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  ...(session.pinned ? { pinned: true } : {}),
  ...(session.archived ? { archived: true } : {}),
  ...(session.archivedAt ? { archivedAt: session.archivedAt } : {}),
  ...(session.importedAt ? { importedAt: session.importedAt } : {}),
})
