import { memo, useMemo } from 'react'
import type { Source } from '../../services/chat/view.js'
import { toMdAst } from '../../services/markdown/parse.js'
import { useScrollToBottom } from '../messages/scrollContext.js'
import { MarkdownAstRenderer } from './MarkdownAstRenderer.js'
import { useThrottleMarkdownRender } from './useThrottleMarkdownRender.js'
import { TYPEWRITER_SENTINEL } from './useTypewriter.js'
import './markdown.css'
import './highlight.css'

/**
 * 渲染链路：打字机揭示 → 节流 → 解析 AST → 渲染。
 * 传入 sources 时把正文里的 [citation:N] 渲染为角标。
 * 揭示中的文本尾部带光标占位符（U+E000），渲染时替换成闪烁光标。
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
  /** 打字机揭示键：正文来源消息的 id；不传则不启用揭示（工具步骤、模板等） */
  revealKey?: string
}) {
  const scrollToBottom = useScrollToBottom()
  const throttledMarkdown = useThrottleMarkdownRender(content, loading)
  const markdown = revealKey && loading ? throttledMarkdown : content
  // 尾部光标占位符拆成独立段落交给渲染层，避免它粘在长文本末尾参与逐字比对
  const display = markdown.endsWith(TYPEWRITER_SENTINEL)
    ? `${markdown.slice(0, -1)}${TYPEWRITER_SENTINEL}`
    : markdown
  const caret = display.endsWith(TYPEWRITER_SENTINEL)
  const body = caret ? display.slice(0, -1) : display
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
