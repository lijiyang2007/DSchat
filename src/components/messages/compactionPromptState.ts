import { create } from 'zustand'

/**
 * 压缩进行中的全局提示（v2.9.1）。
 *
 * 用户明确要求：无论自动压缩还是手动压缩，压缩时都要弹一个「压缩中，请不要关闭」的
 * 弹窗，并且说明「压缩时和压缩后短期卡顿属于正常现象」。
 *
 * 为什么用独立 store 而不是直接在 ContextUsage 里放个 Modal：
 * - 自动压缩发生在**发送消息的请求链路里**（store.streamReply → maybeCompactContext），
 *   那一刻用户可能已经离开设置页、甚至停在别的会话上，弹窗必须挂在应用根部；
 * - 手动压缩在设置页触发，同样走这里，两种入口共用一套 UI，不会出现两套文案。
 *
 * 计数而不是布尔：同一会话的压缩锁保证串行，但不同会话理论上可能同时压，
 * 用计数避免其中一个结束时把另一个的弹窗关掉。
 */
type CompactionPromptState = {
  /** 正在压缩的任务数；> 0 时显示弹窗 */
  active: number
  /** 触发来源：手动点「立即压缩」还是发送时自动压缩，文案略有差别 */
  origin: 'manual' | 'auto'
}

export const useCompactionPrompt = create<CompactionPromptState>(() => ({
  active: 0,
  origin: 'auto',
}))

/** 开始一次压缩：显示「压缩中，请不要关闭」弹窗 */
export const beginCompactionPrompt = (origin: 'manual' | 'auto') => {
  useCompactionPrompt.setState((state) => ({
    active: state.active + 1,
    // 手动优先展示手动文案：用户自己点的按钮，措辞要对得上
    origin: origin === 'manual' ? 'manual' : state.origin,
  }))
}

/** 结束一次压缩：计数归零才真正隐藏弹窗 */
export const endCompactionPrompt = () => {
  useCompactionPrompt.setState((state) => ({ active: Math.max(0, state.active - 1) }))
}
