import { memo, useMemo } from 'react'
import type { Source } from '../../services/chat/view.js'
import { toMdAst } from '../../services/markdown/parse.js'
import { useScrollToBottom } from '../messages/scrollContext.js'
import { MarkdownAstRenderer } from './MarkdownAstRenderer.js'
import { useThrottleMarkdownRender } from './useThrottleMarkdownRender.js'
import './markdown.css'
import './highlight.css'

/**
 * 渲染链路：节流 → 解析 AST → 渲染。
 * 传入 sources 时把正文里的 [citation:N] 渲染为角标。
 *
 * v2.7.7 起恢复真流式（官方 chat-demo 同款）：内容随 SSE 增量增长，
 * 这里只按渲染耗时节流，避免长回答时每来一个字都重新解析整棵 AST。
 * 生成中在尾部挂一个闪烁光标，表示仍在输出。
 */
export const Markdown = memo(function Markdown({
  content,
  loading,
  cacheKey,
  className,
  disableLink,
  sources,
  revealKey,
}: {
  content: string
  loading: boolean
  cacheKey: string
  className?: string
  disableLink: boolean
  sources?: Source[]
  /** 是否为可揭示的消息正文；不传则不显示生成中光标（工具步骤、模板等） */
  revealKey?: string
}) {
  const scrollToBottom = useScrollToBottom()
  const throttledMarkdown = useThrottleMarkdownRender(content, loading)
  // 流式增量：节流后再解析；非流式/已结束直接全文
  const markdown = revealKey && loading ? throttledMarkdown : content
  // 生成中且已有正文时挂光标；空正文不挂，避免只有孤零零一个光标
  const caret = Boolean(revealKey) && loading && markdown.length > 0
  const body = markdown
  const ast = useMemo(
    () => (body ? toMdAst(body, { sources, disableLink }) : null),
    [body, sources, disableLink]
  )
  return ast ? (
    <MarkdownAstRenderer
      key={cacheKey}
      className={className}
      ast={ast}
      loading={loading}
      caret={caret}
      onUpdate={scrollToBottom}
    />
  ) : caret ? (
    <span className="ds-typewriter-caret" aria-hidden />
  ) : null
})
