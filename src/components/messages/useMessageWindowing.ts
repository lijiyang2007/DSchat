import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Message } from '../../services/chat/types.js'

/**
 * 长会话窗口化渲染（v2.8.6）。
 *
 * 2.3.0~2.8.5 用的是 `content-visibility: auto` + `contain-intrinsic-size: 160px`
 * 这套「假虚拟化」：消息全部挂在 DOM 里，只跳过视口外的绘制。两个硬伤：
 * 1. 160px 的估算和真实高度差一个数量级（实测 120 条消息真实 227998px，估算 19224px），
 *    每条消息滚进视口都把估算换成实测，滚动条一缩一胀 → 界面乱跳；
 * 2. DOM 节点一个没少（实测 30126 个），长会话打开和滚动都卡。
 *
 * 这里换成真窗口化：只挂载视口上下各 1.25 屏内的消息，视口外用等高占位块撑住，
 * 滚动条长度与位置跟真实内容一致；实测高度缓存下来，滚动时不再反复重算。
 */

/** 视口上下各多渲染的屏数：太小快速滚动会露白，太大就失去窗口化的意义 */
const OVERSCAN_SCREENS = 1.25
/** 还没量到视口高度时的兜底值 */
const FALLBACK_VIEWPORT = 720
/** 单条消息的估算上限，避免超长回答把估算值拉爆 */
const MAX_ESTIMATE = 12000
/** 生成中始终保留的末尾消息条数（最后一条在长高，多留几条避免边界抖动） */
const TAIL_KEEP_MESSAGES = 6

export type MessageWindow = {
  /** 第一个挂载的消息下标（含） */
  start: number
  /** 最后一个挂载的消息下标（不含） */
  end: number
  /** 上方占位块高度 */
  padTop: number
  /** 下方占位块高度 */
  padBottom: number
  /** 绕过 sticky 守卫直接落到底部，并持续贴底直到高度测量稳定 */
  scrollToBottom: (options?: { smooth?: boolean }) => void
}

/**
 * 估算单条消息的高度（像素），只用于还没被真正渲染测量过的消息占位。
 * 目标不是精确，而是让滚动条长度和上下占位块接近真实，开长会话时不会一缩一胀。
 *
 * v2.9.1：加 WeakMap 缓存。流式生成时每来一批增量都会重算整个估算数组，
 * 长会话（上千条消息）里这段遍历会跟着每帧跑一次，是生成期卡顿的固定开销。
 * 消息是不可变更新的（增量会产生新对象），按消息身份缓存安全。
 */
const heightCache = new WeakMap<Message, number>()

export const estimateMessageHeight = (message: Message): number => {
  const cached = heightCache.get(message)
  if (cached !== undefined) {
    return cached
  }
  const height = measureEstimate(message)
  heightCache.set(message, height)
  return height
}

const measureEstimate = (message: Message): number => {
  if (message.role === 'user') {
    const lines = Math.max(1, Math.ceil(message.content.length / 20))
    return 56 + lines * 24 + message.files.length * 132
  }
  let chars = 0
  for (const block of message.blocks) {
    if (block.type === 'text') {
      chars += block.text.length
    } else if (block.type === 'thinking') {
      chars += block.thinking.length
    }
  }
  return 120 + Math.min(MAX_ESTIMATE, chars * 1.05)
}

/** 二分查找：满足 offsets[i] <= y 的最大 i（0 ≤ i ≤ offsets.length - 2） */
const findIndex = (offsets: number[], y: number) => {
  let low = 0
  let high = Math.max(0, offsets.length - 2)
  let result = 0
  while (low <= high) {
    const mid = (low + high) >> 1
    if (offsets[mid] <= y) {
      result = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return result
}

export const useMessageWindowing = ({
  scrollRef,
  columnRef,
  leadRef,
  ids,
  estimates,
  enabled,
  layoutKey,
  pinTail = false,
}: {
  /** 实际滚动容器（桌面是 .container，移动端是 .scroll） */
  scrollRef: React.RefObject<HTMLDivElement | null>
  /** 消息列表容器 .column */
  columnRef: React.RefObject<HTMLDivElement | null>
  /** 列表上方的固定内容（压缩提示条），用于把滚动位置换算成消息坐标 */
  leadRef?: React.RefObject<HTMLElement | null>
  ids: string[]
  estimates: number[]
  /** 是否启用窗口化；关闭时整列渲染，只保留落底能力 */
  enabled: boolean
  /** 滚动容器换绑或切会话的时机 */
  layoutKey: unknown
  /** 生成中：末尾几条必须始终挂载（最后一条每秒都在长高） */
  pinTail?: boolean
}): MessageWindow => {
  /** 实测高度缓存，按消息 id 存；消息 id 全局唯一，可跨会话复用 */
  const heightsRef = useRef(new Map<string, number>())
  /** 实测高度版本号：变了就重算偏移 */
  const [version, setVersion] = useState(0)
  const [viewport, setViewport] = useState({ top: 0, height: 0 })
  const [leadHeight, setLeadHeight] = useState(0)
  /** 上方消息测出真实高度后需要补正的滚动量，避免内容被顶走 */
  const shiftRef = useRef(0)
  /** 当前视口顶部落在哪条消息上，用于判断高度变化在视口上方还是下方 */
  const firstVisibleRef = useRef(0)
  /** 落到底部期间持续贴底，直到高度测量稳定 */
  const pinBottomRef = useRef(false)
  /** 测量函数的最新引用，供 ResizeObserver 回调使用 */
  const measureRef = useRef<() => void>(() => {})

  const indexById = useMemo(() => {
    const map = new Map<string, number>()
    ids.forEach((id, index) => map.set(id, index))
    return map
  }, [ids])

  const offsets = useMemo(() => {
    // 读一次 version：实测高度更新后必须重算偏移，lint 也要求依赖被真正使用
    void version
    const out = new Array<number>(ids.length + 1)
    out[0] = 0
    for (let index = 0; index < ids.length; index += 1) {
      const height = heightsRef.current.get(ids[index]) ?? estimates[index] ?? 240
      out[index + 1] = out[index] + Math.max(24, height)
    }
    return out
  }, [ids, estimates, version])

  const total = offsets[ids.length] ?? 0

  const window = useMemo(() => {
    const count = ids.length
    if (count === 0) {
      return { start: 0, end: 0, padTop: 0, padBottom: 0 }
    }
    // 未启用窗口化：整列渲染，占位块为 0，行为和旧版一致
    if (!enabled) {
      return { start: 0, end: count, padTop: 0, padBottom: 0 }
    }
    const height = viewport.height || FALLBACK_VIEWPORT
    const top = Math.max(0, viewport.top - leadHeight)
    const overscan = height * OVERSCAN_SCREENS
    let start = Math.min(count - 1, findIndex(offsets, top - overscan))
    let end = Math.min(count, Math.max(start + 1, findIndex(offsets, top + height + overscan) + 1))
    // v2.9.1：生成中最后一条消息必须始终挂载——它每秒都在长高，
    // 用户就算上翻看历史，回来时也得看到最新内容，不能因为滚出了窗口就消失。
    if (pinTail) {
      end = count
      // 同时把窗口往上扩一点，避免「末尾单独一条挂在下面」时上方内容被卸掉又装回
      start = Math.min(start, Math.max(0, count - 1 - TAIL_KEEP_MESSAGES))
    }
    firstVisibleRef.current = Math.min(count - 1, findIndex(offsets, top))
    return { start, end, padTop: offsets[start], padBottom: Math.max(0, total - offsets[end]) }
  }, [ids.length, offsets, total, viewport, leadHeight, enabled, pinTail])

  /**
   * 落到底部。
   * `smooth` 只在整列渲染时用：窗口化下滚动过程中会不断挂载/卸载消息，
   * scrollHeight 一直在变，平滑动画会停在旧的目标高度上（实测点了「回到最新」
   * 仍差 12 万像素）。所以窗口化时一律直接跳，并持续贴底到高度稳定。
   */
  const scrollToBottom = useCallback(
    (options?: { smooth?: boolean }) => {
      const scroll = scrollRef.current
      if (!scroll) {
        return
      }
      pinBottomRef.current = true
      const smooth = options?.smooth === true && !enabled
      if (smooth) {
        scroll.scrollTo({ top: scroll.scrollHeight, behavior: 'smooth' })
      } else {
        scroll.scrollTop = scroll.scrollHeight
      }
      setViewport({ top: scroll.scrollTop, height: scroll.clientHeight })
    },
    [scrollRef, enabled]
  )

  // 测量已挂载消息的真实高度：视口上方的高度变化记下需要补正的滚动量
  const measure = useCallback(() => {
    const column = columnRef.current
    const scroll = scrollRef.current
    if (!column || !scroll) {
      return
    }
    const lead = leadRef?.current
    if (lead) {
      const nextLead = lead.getBoundingClientRect().height
      setLeadHeight((previous) => (Math.abs(previous - nextLead) > 0.5 ? nextLead : previous))
    }
    const firstVisible = firstVisibleRef.current
    let changed = false
    let shift = 0
    for (const node of column.querySelectorAll<HTMLElement>('[data-message-id]')) {
      const id = node.dataset.messageId
      if (!id) {
        continue
      }
      const height = node.getBoundingClientRect().height
      const index = indexById.get(id)
      const previous =
        heightsRef.current.get(id) ?? (index === undefined ? undefined : estimates[index])
      if (previous !== undefined && Math.abs(previous - height) <= 0.5) {
        continue
      }
      // 视口上方的高度变化会把当前阅读位置顶走，按差值补回滚动量
      if (index !== undefined && index < firstVisible) {
        shift += height - (previous ?? 0)
      }
      heightsRef.current.set(id, height)
      changed = true
    }
    if (shift !== 0) {
      shiftRef.current += shift
    }
    if (pinBottomRef.current) {
      scroll.scrollTop = scroll.scrollHeight
      setViewport({ top: scroll.scrollTop, height: scroll.clientHeight })
      // 高度还在变就继续贴底，稳定后放手
      if (!changed) {
        pinBottomRef.current = false
      }
    }
    if (changed) {
      setVersion((value) => value + 1)
    }
  }, [columnRef, scrollRef, leadRef, indexById, estimates])

  measureRef.current = measure

  // 每次提交后量一次；用 ResizeObserver 跟进图片加载、字体、折叠展开等被动高度变化
  useLayoutEffect(() => {
    measureRef.current()
  })

  useLayoutEffect(() => {
    const column = columnRef.current
    const scroll = scrollRef.current
    if (!column || !scroll) {
      return
    }
    const observer = new ResizeObserver(() => measureRef.current())
    observer.observe(column)
    if (leadRef?.current) {
      observer.observe(leadRef.current)
    }
    return () => observer.disconnect()
  }, [columnRef, scrollRef, leadRef, layoutKey])

  // 补正滚动量：等占位块按新高度渲染完再补，视觉上内容不移动
  useLayoutEffect(() => {
    const scroll = scrollRef.current
    const shift = shiftRef.current
    if (!scroll || shift === 0) {
      return
    }
    shiftRef.current = 0
    scroll.scrollTop += shift
  }, [scrollRef, version, layoutKey])

  // 滚动位置与视口高度驱动窗口范围
  useLayoutEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) {
      return
    }
    let frame = 0
    const update = () => {
      frame = 0
      const top = scroll.scrollTop
      const height = scroll.clientHeight
      setViewport((previous) =>
        Math.abs(previous.top - top) < 1 && Math.abs(previous.height - height) < 1
          ? previous
          : { top, height }
      )
    }
    update()
    const onScroll = () => {
      if (frame === 0) {
        frame = requestAnimationFrame(update)
      }
    }
    scroll.addEventListener('scroll', onScroll, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(scroll)
    return () => {
      scroll.removeEventListener('scroll', onScroll)
      if (frame !== 0) {
        cancelAnimationFrame(frame)
      }
      observer.disconnect()
    }
  }, [scrollRef, layoutKey])

  return { ...window, scrollToBottom }
}
