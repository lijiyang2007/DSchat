import type { Message, UserMessage } from './types.js'

/**
 * 会话标题兜底生成。
 *
 * 服务端只在 DeepSeek 原生协议下、且请求带 title.enabled 时才会下发标题；
 * 走 OpenAI 兼容 / 第三方中转时永远没有标题，列表就只能全显示「新对话」。
 * 这里在本地根据首条提问生成一个标题，作为服务端标题缺失时的兜底。
 */

/** 标题最长字符数，超出截断并加省略号 */
export const LOCAL_TITLE_MAX = 30

/** 去掉附件占位、换行与多余空白，压成一行 */
const normalize = (text: string): string =>
  text
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * 从提问里提炼标题：
 * 取第一句（按中英文句末标点切分），再按长度上限截断。
 * 换行与空白只折叠不切分，避免多行提问只剩第一行。
 * 纯附件提问没有文字时，用文件名兜底。
 */
export const buildLocalTitle = (question: UserMessage): string => {
  const text = normalize(question.content)
  if (text) {
    const firstSentence = text.split(/[。！？!?；;]/)[0]?.trim() || text
    const clipped =
      firstSentence.length > LOCAL_TITLE_MAX
        ? `${firstSentence.slice(0, LOCAL_TITLE_MAX)}…`
        : firstSentence
    return clipped
  }
  const fileName = question.files[0]?.name?.trim()
  if (fileName) {
    return fileName.length > LOCAL_TITLE_MAX ? `${fileName.slice(0, LOCAL_TITLE_MAX)}…` : fileName
  }
  return ''
}

/** 会话里第一条用户消息 */
export const firstUserMessage = (messages: Message[]): UserMessage | undefined =>
  messages.find((message): message is UserMessage => message.role === 'user')

/**
 * 计算会话应该显示的标题：
 * 已有服务端标题时保持不动，否则用首条提问生成。
 */
export const resolveSessionTitle = (messages: Message[], current: string): string => {
  if (current.trim()) {
    return current
  }
  const first = firstUserMessage(messages)
  return first ? buildLocalTitle(first) : ''
}
