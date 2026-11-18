import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { IconChevronDownOutline14 } from '../base/icons.js'
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
import { estimateMessageHeight, useMessageWindowing } from './useMessageWindowing.js'
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
/** 消息数超过这个值时启用窗口化渲染，避免长会话把全部消息都挂进 DOM */
const WINDOWING_THRESHOLD = 30
/** 距底部超过该值时显示「回到最新」按钮 */
const SHOW_BACK_TO_BOTTOM_THRESHOLD = 200
const EMPTY_ESTIMATES: number[] = []

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
  const bannerRef = useRef<HTMLButtonElement>(null)
  // 不自动跟随底部：AI 流式输出时用户视角停在哪就留在哪，新文字在下方累积。
  // 恒为 false → scrollToBottom() 的守卫始终拦截自动滚动（见下方 scrollToBottom）。
  const stickyRef = useRef(false)
  const scrollTopRef = useRef(0)
  const restoreScrollRef = useRef<{ messageId: string; top: number } | null>(null)
  const [showBackToBottom, setShowBackToBottom] = useState(false)
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

  // 长会话窗口化：只挂载视口附近的消息，其余用等高占位块撑住滚动条。
  //
  // v2.9.1 修：以前流式输出期间会整列渲染（`!streaming`），理由是「末尾要实时刷新」。
  // 但实测这恰恰是长对话最卡的场景——一压缩完就要接着发消息，生成期间几千条消息
  // 全部挂回 DOM，低配机直接卡到掉帧甚至被系统回收。现在流式期间照样窗口化：
  // 生成中的那条消息一定在列表末尾，只要保证窗口包含末尾即可（见 window 计算的 tail 参数）。
  const windowed = messages.length > WINDOWING_THRESHOLD
  const ids = useMemo(() => messages.map((message) => message.id), [messages])
  const estimates = useMemo(
    () => (windowed ? messages.map(estimateMessageHeight) : EMPTY_ESTIMATES),
    [messages, windowed]
  )
  const { start, end, padTop, padBottom, scrollToBottom: scrollWindowToBottom } =
    useMessageWindowing({
      scrollRef,
      columnRef: contentRef,
      leadRef: bannerRef,
      ids,
      estimates,
      enabled: windowed,
      layoutKey: `${session.id}:${isMobile}`,
      pinTail: streaming,
    })

  // 按钮专用：绕过 stickyRef 守卫（恒 false，供「生成时不自动滚动」使用），
  // 直接把滚动容器拉到最新。尊重系统「减少动画」偏好。
  // 窗口化时由 scrollWindowToBottom 接管：它会持续贴底到高度测量稳定，
  // 否则平滑动画会停在旧的目标高度（实测点完仍差十几万像素）。
  const forceScrollToBottom = useCallback(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    scrollWindowToBottom({ smooth: !reduceMotion })
  }, [scrollWindowToBottom])

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
  // 首次挂载同样要落底：从欢迎页进入会话时组件是新建的，ref 初值就是当前 id，
  // 只比较 id 会漏掉这一次（v2.8.6 修：开长会话停在顶部、要手动往下翻）。
  const lastSessionIdRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (lastSessionIdRef.current !== session.id) {
      lastSessionIdRef.current = session.id
      setShowBackToBottom(false)
      // 窗口化时先让占位块按真实高度落位，再贴底（scrollWindowToBottom 会持续贴到稳定）
      scrollWindowToBottom()
    }
  }, [session.id, scrollWindowToBottom])

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
      // 距底部超过阈值才显示「回到最新」按钮。
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      setShowBackToBottom(distance > SHOW_BACK_TO_BOTTOM_THRESHOLD)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [isMobile, scrollToBottom])

  const lastIndex = messages.length - 1
  const uploadRetryId = getUploadRetryId(messages, streaming)
  return (
    <ScrollToBottomContext.Provider value={scrollToBottom}>
      <div className={styles.wrapper}>
        <div ref={isMobile ? undefined : scrollRef} className={styles.container}>
          <div ref={isMobile ? scrollRef : undefined} className={styles.scroll}>
            <div ref={contentRef} className={styles.column}>
              {session.compaction?.summary ? (
                <button
                  ref={bannerRef}
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
              {padTop > 0 ? (
                <div className={styles.pad} style={{ height: padTop }} aria-hidden />
              ) : null}
              {messages.slice(start, end).map((message, offset) => {
                const index = start + offset
                return message.role === 'user' ? (
                  <div key={message.id} className={styles.item} data-message-id={message.id}>
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
                  <div key={message.id} className={styles.item} data-message-id={message.id}>
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
              })}
              {padBottom > 0 ? (
                <div className={styles.pad} style={{ height: padBottom }} aria-hidden />
              ) : null}
            </div>
          </div>
          {footer}
        </div>

        {showBackToBottom ? (
          <button
            type="button"
            className={styles.backToBottom}
            onClick={forceScrollToBottom}
            aria-label={t('backToLatest')}
            title={t('backToLatest')}
          >
            <IconChevronDownOutline14 />
          </button>
        ) : null}
      </div>
    </ScrollToBottomContext.Provider>
  )
}
