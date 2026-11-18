/**
 * 生成时不自动滚动检查（v2.8.2，见 handoff-deepseek-scroll.md）。
 *
 * 目标：AI 流式输出时不把用户视角拽到底部；内容向下延伸，用户停哪留哪。
 * 做法：stickyRef 恒 false（scrollToBottom 守卫恒拦截），删掉 onScroll 的
 * 「回到底部恢复跟随」，删掉新消息强制滚到底；仅切换会话时一次性滚到底。
 *
 * 纯读源码，随时可跑：node scripts/check-no-autoscroll.mjs
 */
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

let failed = 0
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok   ${label}`)
  else {
    failed += 1
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const ml = read('src/components/messages/MessageList.tsx')

console.log('\n一、sticky 跟随恒关闭')
check('stickyRef 初始为 false', /stickyRef = useRef\(false\)/.test(ml))
check(
  'scrollToBottom 仍有 stickyRef 守卫',
  /if \(el && stickyRef\.current\)/.test(ml)
)
check(
  '已删除 STICKY_THRESHOLD 常量',
  !/STICKY_THRESHOLD/.test(ml)
)

console.log('\n二、onScroll 不再恢复跟随')
check(
  'onScroll 不再有 nearBottom 恢复跟随',
  !/nearBottom/.test(ml) && !/stickyRef\.current = true/.test(ml)
)

console.log('\n三、新消息不再强制滚到底')
check(
  '新消息 effect 不再 scrollToBottom',
  /lastMessageId[^\n]*\n[\s\S]{0,400}新消息[^\n]*不再强制/.test(ml) ||
    !/stickyRef\.current = true[\s\S]{0,80}scrollToBottom/.test(ml)
)

console.log('\n四、切换会话仍滚到底（体验保留）')
check('有 lastSessionIdRef', /lastSessionIdRef/.test(ml))
check(
  '切换会话时落底（绕过 stickyRef）',
  // v2.8.6 起落底交给窗口化的 scrollWindowToBottom（它内部绕过 stickyRef 并持续贴底到高度稳定）；
  // 旧实现是这里直接 el.scrollTop = el.scrollHeight
  /lastSessionIdRef\.current !== session\.id[\s\S]{0,400}(scrollWindowToBottom\(\)|scrollTop = el\.scrollHeight)/
    .test(ml)
)
check(
  '首次挂载也落底（ref 初值不是当前会话 id）',
  /lastSessionIdRef = useRef<string \| null>\(null\)/.test(ml)
)

console.log(failed === 0 ? '\n全部通过\n' : `\n${failed} 项失败\n`)
process.exit(failed === 0 ? 0 : 1)
