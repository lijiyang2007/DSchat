import { useEffect, useRef, useState } from 'react'
import { useSettings, type StreamThrottle } from '../../services/settings.js'

/** 两次更新的最长间隔 */
const MAX_WAIT = 2000
/** 上次渲染耗时的倍数，过了这段时间才允许下次更新 */
const TIME_CONSUMING_RATE = 2

/** 各档位的节流参数：倍率越高、最长间隔越大，渲染次数越少越流畅 */
const PROFILES: Record<StreamThrottle, { rate: number; maxWait: number } | null> = {
  // 完整：不节流，每个字都显示
  full: null,
  // 均衡：默认，按渲染耗时自适应
  balanced: { rate: TIME_CONSUMING_RATE, maxWait: MAX_WAIT },
  // 流畅：更激进，减少渲染次数，弱机上更顺滑
  smooth: { rate: TIME_CONSUMING_RATE * 2, maxWait: MAX_WAIT * 2 },
}

/**
 * 流式过程中按渲染耗时节流 Markdown 内容的更新：
 * 更新输出时记录开始时间，提交后按耗时 × rate（不超过 maxWait）算出下次允许更新的时间点；
 * 新内容在到期时更新，连续输入合并为最新内容。
 * 档位由用户在设置里选择：完整（不节流）/ 均衡 / 流畅。
 */
export const useThrottleMarkdownRender = (content: string, loading: boolean) => {
  const streamThrottle = useSettings((state) => state.streamThrottle)
  const profile = PROFILES[streamThrottle]
  const enable = loading && profile !== null

  // 首次渲染从挂载时开始计时
  const startRef = useRef(performance.now())
  const updatableAtRef = useRef(0)
  const [output, setOutput] = useState(content)

  useEffect(() => {
    if (!profile) {
      return
    }
    const now = performance.now()
    updatableAtRef.current = now + Math.min(profile.maxWait, (now - startRef.current) * profile.rate)
  }, [output, profile])

  useEffect(() => {
    if (!enable || !profile) {
      return
    }
    const update = () => {
      startRef.current = performance.now()
      setOutput(content)
    }
    const delay = updatableAtRef.current - performance.now()
    if (delay <= 0) {
      update()
      return
    }
    const timer = setTimeout(update, delay)
    return () => clearTimeout(timer)
  }, [content, enable, profile])

  return enable && profile ? output : content
}
