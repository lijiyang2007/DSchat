import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * 顶层错误边界（移植自 v2.9.6，并补 localStorage 落盘）。
 *
 * 任何渲染异常若无人接住，会把整个 React 树卸载 → 纯白屏（前两次白屏事故的模式）。
 * 这里兜住所有子组件渲染异常：显示可恢复提示，而不是让用户对着白屏无从下手。
 * 刻意不依赖 i18n / 主题 store —— 万一异常正来自它们，这里必须还能独立渲染。
 */
type State = { error: Error | null }

/** 与全局错误捕获共用同一个 key，方便反馈时一并导出 */
export const CRASH_LOG_KEY = 'dschat:last-crash'

/** 把崩溃信息写进 localStorage，供「反馈」时附上，下次白屏不再是没线索的悬案 */
export const recordCrash = (error: Error, componentStack?: string | null) => {
  try {
    const entry = {
      message: error.message,
      stack: error.stack,
      componentStack,
      at: Date.now(),
    }
    // 只留最后一条即可：多次崩溃时最新一条最有诊断价值
    localStorage.setItem(CRASH_LOG_KEY, JSON.stringify(entry))
  } catch {
    // localStorage 不可用（隐私模式 / 配额满）时静默忽略，绝不让错误处理本身抛错
  }
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] render crashed', error, info.componentStack)
    recordCrash(error, info.componentStack)
  }

  private reload = () => {
    window.location.reload()
  }

  override render() {
    const { error } = this.state
    if (!error) {
      return this.props.children
    }
    const isZh = navigator.language.toLowerCase().startsWith('zh')
    return (
      <div
        role="alert"
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 32,
          background: '#181818',
          color: '#eee',
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 600 }}>
          {isZh ? '界面出了点问题' : 'Something went wrong'}
        </div>
        <div style={{ fontSize: 13, opacity: 0.7, lineHeight: 1.6, maxWidth: 320 }}>
          {isZh
            ? '你的聊天记录都还在，重新进入即可恢复。如果反复出现，请到设置里反馈。'
            : 'Your chats are safe. Reopen the app to recover. If this keeps happening, please send feedback in settings.'}
        </div>
        <button
          onClick={this.reload}
          style={{
            marginTop: 8,
            padding: '10px 24px',
            borderRadius: 999,
            border: 'none',
            background: '#4f6bfe',
            color: '#fff',
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          {isZh ? '重新进入' : 'Restart'}
        </button>
      </div>
    )
  }
}

/**
 * 局部错误边界（移植自 v2.9.6）。
 *
 * 顶层边界一触发就是整页不可用，而最容易出问题的是单条消息的渲染
 * （Markdown / KaTeX / Mermaid / 附件缩略图）。一条消息渲染炸掉不该带走整个会话和输入框。
 *
 * `resetKey` 变化时自动清除错误状态（切会话、消息内容变了）。
 */
export class MessageBoundary extends Component<
  { children: ReactNode; resetKey?: unknown; fallback?: ReactNode },
  State
> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[MessageBoundary] message render crashed', error, info.componentStack)
    recordCrash(error, info.componentStack)
  }

  override componentDidUpdate(previous: { resetKey?: unknown }) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  override render() {
    if (!this.state.error) {
      return this.props.children
    }
    if (this.props.fallback !== undefined) {
      return this.props.fallback
    }
    const isZh = navigator.language.toLowerCase().startsWith('zh')
    return (
      <div
        role="alert"
        style={{
          padding: '10px 12px',
          borderRadius: 12,
          border: '1px solid rgba(238, 81, 56, 0.35)',
          background: 'rgba(238, 81, 56, 0.08)',
          color: 'inherit',
          fontSize: 13,
          lineHeight: 1.6,
          opacity: 0.85,
        }}
      >
        {isZh
          ? '这条内容渲染失败，其余对话不受影响。切换对话或重新进入可恢复。'
          : 'This message failed to render. Your other chats are unaffected.'}
      </div>
    )
  }
}
