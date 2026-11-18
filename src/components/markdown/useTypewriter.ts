import { useEffect, useRef, useState } from 'react'
import { useSettings, type StreamThrottle } from '../../services/settings.js'

/**
 * 固定字速打字机（v2.7.3，参考官方 chat-demo 的流式观感）：
 * 非流式请求拿到完整回答后，按固定字/秒逐字揭示，配合尾部闪烁光标，
 * 观感与官方流式一致，且速度与网关/网络差异无关。
 *
 * - 时间驱动：按「锚点（已揭示长度，时间戳）+ 经过时间 × 字速」计算揭示长度，
 *   后台标签页暂停 rAF 后恢复时自动追平，平均字速始终固定
 * - 积压加速：长回答积压过多时按倍率追赶，避免播放时间远超生成时间
 * - 档位复用「输出速度」设置（原流式输出）：流畅 32 字/秒、均衡 55、完整 320
 * - messageKey 变化（重新生成/编辑重发）时从头重放；
 *   续写追加的内容在追平旧内容后按同一字速继续揭示，不重打已有部分
 * - 系统开启「减少动态效果」时跳过动画直接展示全文
 */

/** 各档位的固定字速（字/秒） */
const SPEEDS: Record<StreamThrottle, number> = {
  smooth: 32,
  balanced: 55,
  full: 320,
}

/** 揭示积压超过该字数时开始加速追赶 */
const CATCH_UP_SOFT = 300
/** 积压超过该字数时全速追赶 */
const CATCH_UP_HARD = 800
const CATCH_UP_SOFT_MULT = 3
const CATCH_UP_HARD_MULT = 6

/** 光标占位符：附在揭示文本尾部，由 Markdown 渲染层替换成闪烁光标 */
export const TYPEWRITER_SENTINEL = '\uE000'

/** 这些字符后面不放光标：markdown 语法字符，尾部光标会干扰解析展示 */
const CARET_UNSAFE = new Set([
  '`',
  '*',
  '_',
  '~',
  '[',
  ']',
  '(',
  ')',
  '#',
  '>',
  '|',
  '$',
  '\\',
  '<',
  '\n',
  ' ',
])

/** 反引号/美元符号成对出现才放光标：奇数个说明尾部在行内代码或公式里 */
const pairsAreEven = (text: string, char: string) =>
  (text.split(char).length - 1) % 2 === 0

/** 三引号代码围栏成对出现才放光标：奇数个说明尾部在代码块里 */
const fencesAreEven = (text: string) =>
  (text.split('```').length - 1) % 2 === 0

/** 当前揭示尾部是否适合放光标 */
const caretAllowed = (revealed: string): boolean => {
  if (revealed.length === 0) {
    return false
  }
  const last = revealed.at(-1) ?? ''
  if (CARET_UNSAFE.has(last)) {
    return false
  }
  return pairsAreEven(revealed, '`') && pairsAreEven(revealed, '$') && fencesAreEven(revealed)
}

/** 揭示文本加光标占位符；不适合时原样返回 */
const withCaret = (revealed: string): string =>
  caretAllowed(revealed) ? revealed + TYPEWRITER_SENTINEL : revealed

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * @param content 完整回答文本
 * @param revealing 是否处于揭示中（streaming 且已有正文）
 * @param messageKey 消息 id：变化时重置揭示进度
 * @returns 当前应展示的文本（揭示中带光标占位符）
 */
export const useTypewriter = (
  content: string,
  revealing: boolean,
  messageKey: string
): string => {
  const throttle = useSettings((state) => state.streamThrottle)
  const [output, setOutput] = useState(() => (revealing && !prefersReducedMotion() ? '' : content))
  /** 锚点：揭示到的长度与该位置对应的时间戳 */
  const anchorRef = useRef({ length: 0, at: 0 })
  /** 上一轮揭示动画的目标长度；追平后再追加的新内容重置锚点计时 */
  const prevTargetRef = useRef(0)
  const keyRef = useRef(messageKey)

  // 消息切换（重新生成/编辑重发）→ 从头重放。渲染期同步复位已展示的文本，
  // 避免新回答的第一帧还挂着上一条消息的全文。
  if (keyRef.current !== messageKey) {
    keyRef.current = messageKey
    anchorRef.current = { length: 0, at: 0 }
    prevTargetRef.current = 0
    setOutput(revealing && !prefersReducedMotion() ? '' : content)
  }

  useEffect(() => {
    // 未在揭示中（历史消息、已结束、思考阶段）或系统减少动态效果：直接全文
    if (!revealing || prefersReducedMotion()) {
      anchorRef.current = { length: content.length, at: performance.now() }
      prevTargetRef.current = content.length
      setOutput(content)
      return
    }
    const now = performance.now()
    // 首次揭示，或上一段已追平又追加了新内容（续写）：锚点从当前位置重新计时
    if (
      anchorRef.current.at === 0 ||
      (anchorRef.current.length >= prevTargetRef.current &&
        content.length > anchorRef.current.length)
    ) {
      anchorRef.current = { length: anchorRef.current.length, at: now }
    }
    let frame = 0
    const tick = () => {
      const target = content.length
      const anchor = anchorRef.current
      const elapsed = (performance.now() - anchor.at) / 1000
      const backlog = target - anchor.length
      const mult =
        backlog > CATCH_UP_HARD
          ? CATCH_UP_HARD_MULT
          : backlog > CATCH_UP_SOFT
            ? CATCH_UP_SOFT_MULT
            : 1
      const desired = Math.min(
        target,
        Math.max(anchor.length, anchor.length + Math.floor(elapsed * SPEEDS[throttle] * mult))
      )
      if (desired > anchor.length) {
        anchorRef.current = anchor
        setOutput(withCaret(content.slice(0, desired)))
      }
      if (desired < target) {
        frame = requestAnimationFrame(tick)
      } else {
        // 已追平完整内容：保持光标闪烁到 streaming 结束
        prevTargetRef.current = target
        setOutput(withCaret(content))
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [content, revealing, throttle])

  return output
}
