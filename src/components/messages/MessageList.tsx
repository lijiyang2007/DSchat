import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import {
  buildMessageVersions,
  getVisibleMessages,
  type MessageVersions,
} from '../../services/chat/branches.js'
import { selectMessageVersion } from '../../services/chat/store.js'
import type { Session } from '../../services/chat/types.js'
import { closeSearchPanel } from '../search/searchPanelState.js'
import { AssistantMessage } from './AssistantMessage.js'
import { ScrollToBottomContext } from './scrollContext.js'
import { UserMessage } from './UserMessage.js'
import type { Message } from '../../services/chat/types.js'

/**
 * 会话共用可重试的附件上传失败入口，覆盖当前提问与历史消息中的附件。
 * 点击后按失败的回答重新补传附件并请求。
 */
const getUploadRetryId = (messages: Message[], streaming: boolean) => {
  const last = messages.at(-1)
  return !streaming &&
    last?.role === 'assistant' &&
    last.status === 'error' &&
    last.error?.kind === 'upload' &&
    last.error.retryable
    ? last.id
    : null
}
import styles from './MessageList.module.css'

const EMPTY_VERSIONS: MessageVersions = { ids: [], index: -1 }
/** 消息数超过这个值时启用视口外跳过渲染，避免长会话卡顿 */
const VIRTUALIZE_THRESHOLD = 30

export const MessageList = ({
  session,
  streaming,
  footer,
}: {
  session: Session
  streaming: boolean
  footer: React.ReactNode
}) => {
  const isMobile = useIsMobile()
  const t = useTranslate()
  const [summaryOpen, setSummaryOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  // 不自动跟随底部：AI 流式输出时用户视角停在哪就留在哪，新文字在下方累积。
  // 恒为 false → scrollToBottom() 的守卫始终拦截自动滚动（见下方 scrollToBottom）。
  const stickyRef = useRef(false)
  const scrollTopRef = useRef(0)
  const restoreScrollRef = useRef<{ messageId: string; top: number } | null>(null)
  const messages = getVisibleMessages(session)
  const [previousVersions, setPreviousVersions] = useState(() =>
    buildMessageVersions(session, new Map())
  )
  const versions = useMemo(
    () => buildMessageVersions(session, previousVersions),
    [session, previousVersions]
  )
  if (versions !== previousVersions) {
    setPreviousVersions(versions)
  }
  const lastMessageId = messages.at(-1)?.id
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el && stickyRef.current) {
      el.scrollTop = el.scrollHeight
      scrollTopRef.current = el.scrollTop
    }
  }, [])

  // 内容、键盘和输入框高度变化时，继续遵循当前跟随状态。
  useLayoutEffect(() => {
    const content = contentRef.current
    const scroll = scrollRef.current
    if (!content || !scroll) {
      return
    }
    const observer = new ResizeObserver(scrollToBottom)
    observer.observe(content)
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [isMobile, scrollToBottom])

  // 切换版本后将选择器留在原位置，避免回答长短变化导致操作区跳出视口。
  useLayoutEffect(() => {
    const anchor = restoreScrollRef.current
    const scroll = scrollRef.current
    if (anchor && scroll) {
      const switcher = scroll.querySelector<HTMLElement>(
        `[data-message-version="${CSS.escape(anchor.messageId)}"]`
      )
      if (switcher) {
        scroll.scrollTop += switcher.getBoundingClientRect().top - anchor.top
      }
      restoreScrollRef.current = null
      return
    }
    // 新消息（lastMessageId 变化）不再强制恢复跟随——这是「生成时不自动滚动」的关键。
  }, [session.id, lastMessageId])

  // 切换会话时一次性滚到底部（绕过 stickyRef），让用户直接看到最新消息；
  // 这与「流式生成不跟随」不冲突：只认 session.id，不认 lastMessageId。
  const lastSessionIdRef = useRef(session.id)
  useLayoutEffect(() => {
    if (lastSessionIdRef.current !== session.id) {
      lastSessionIdRef.current = session.id
      const el = scrollRef.current
      if (el) {
        el.scrollTop = el.scrollHeight
        scrollTopRef.current = el.scrollTop
      }
    }
  }, [session.id])

  useEffect(closeSearchPanel, [session.id, lastMessageId])

  const selectVersion = useCallback(
    (messageId: string, anchorTop: number) => {
      if (streaming) {
        return
      }
      restoreScrollRef.current = { messageId, top: anchorTop }
      stickyRef.current = false
      closeSearchPanel()
      selectMessageVersion(session.id, messageId)
    },
    [session.id, streaming]
  )

  // 跨移动端断点时切换滚动层，并保持输入框及当前阅读位置。
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    if (stickyRef.current) {
      scrollToBottom()
    } else {
      el.scrollTop = scrollTopRef.current
    }
    const onScroll = () => {
      // 只记录用户当前水位；不再因为「滚回底部」就恢复跟随。
      // 自动滚动统一由 stickyRef（恒 false）拦截，避免生成时把视角拽到底。
      scrollTopRef.current = el.scrollTop
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [isMobile, scrollToBottom])

  const lastIndex = messages.length - 1
  const uploadRetryId = getUploadRetryId(messages, streaming)
  // 关闭虚拟化的场景：正在流式输出（末尾消息需实时刷新）或消息太少
  const virtualize = messages.length > VIRTUALIZE_THRESHOLD && !streaming
  // 每条消息外层：视口外时用 content-visibility 跳过渲染，
  // contain-intrinsic-size 给出估算高度让滚动条保持稳定。
  const itemClass = virtualize ? styles.virtualItem : undefined
  return (
    <ScrollToBottomContext.Provider value={scrollToBottom}>
      <div ref={isMobile ? undefined : scrollRef} className={styles.container}>
        <div ref={isMobile ? scrollRef : undefined} className={styles.scroll}>
          <div ref={contentRef} className={styles.column}>
            {session.compaction?.summary ? (
              <button
                type="button"
                className={styles.contextBanner}
                onClick={() => setSummaryOpen((open) => !open)}
                aria-expanded={summaryOpen}
              >
                <span className={styles.contextBannerText}>
                  {summaryOpen
                    ? t('contextCompactedBannerExpanded', {
                        summary: session.compaction.summary,
                      })
                    : t('contextCompactedBanner')}
                </span>
                <span className={styles.contextBannerHint}>
                  {t(summaryOpen ? 'contextCompactedHide' : 'contextCompactedShow')}
                </span>
              </button>
            ) : null}
            {messages.map((message, index) =>
              message.role === 'user' ? (
                <div key={message.id} className={itemClass}>
                <UserMessage
                  key={message.id}
                  sessionId={session.id}
                  message={message}
                  retryUploadId={uploadRetryId}
                  isFirst={index === 0}
                  isLast={index === lastIndex || index === lastIndex - 1}
                  busy={streaming}
                  versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                  onSelectVersion={selectVersion}
                />
                </div>
              ) : (
                <div key={message.id} className={itemClass}>
                <AssistantMessage
                  key={message.id}
                  sessionId={session.id}
                  message={message}
                  isLast={index === lastIndex}
                  streaming={streaming && index === lastIndex}
                  busy={streaming}
                  versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                  onSelectVersion={selectVersion}
                />
                </div>
              )
            )}
          </div>
        </div>
        {footer}
      </div>
    </ScrollToBottomContext.Provider>
  )
}
