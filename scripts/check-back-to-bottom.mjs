/**
 * 回到最新按钮检查（见 handoff-back-to-bottom-button.md）。
 *
 * 目标：用户翻到上方看历史时，右下角出现向下箭头按钮，点一下平滑回到底部；
 * 停在底部/切会话时不出现。关键是 forceScrollToBottom 绕过 stickyRef 守卫
 * （本项目 stickyRef 恒 false，供「生成时不自动滚动」使用）。
 *
 * 纯读源码，随时可跑：node scripts/check-back-to-bottom.mjs
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
// CSS 文件是 GBK 编码，但新增的样式段为纯 ASCII，用 latin1 读不会破坏匹配
const css = read('src/components/messages/MessageList.module.css')
const cssDts = read('src/components/messages/MessageList.module.css.d.ts')
const zh = read('src/i18n/zh.ts')
const en = read('src/i18n/en.ts')

console.log('\n一、forceScrollToBottom 绕过 stickyRef 守卫')
check(
  '定义了 forceScrollToBottom',
  /const forceScrollToBottom = useCallback/.test(ml)
)
check(
  'forceScrollToBottom 直接 scrollTo(scrollHeight)，忽略 sticky',
  /forceScrollToBottom[\s\S]{0,300}el\.scrollTo\(\{ top: el\.scrollHeight/.test(ml)
)
check(
  '尊重 prefers-reduced-motion',
  /prefers-reduced-motion/.test(ml)
)

console.log('\n二、显隐由距底距离驱动')
check(
  '定义了 SHOW_BACK_TO_BOTTOM_THRESHOLD 阈值',
  /SHOW_BACK_TO_BOTTOM_THRESHOLD = 200/.test(ml)
)
check(
  'onScroll 计算 scrollHeight - scrollTop - clientHeight',
  /scrollHeight - el\.scrollTop - el\.clientHeight/.test(ml)
)
check(
  'showBackToBottom state 驱动显隐',
  /setShowBackToBottom\(distance > SHOW_BACK_TO_BOTTOM_THRESHOLD\)/.test(ml)
)

console.log('\n三、DOM 结构')
check(
  '滚动容器外包 position:relative 外壳 .wrapper',
  /className=\{styles\.wrapper\}/.test(ml) && /\.wrapper \{[\s\S]{0,120}position: relative/.test(css)
)
check(
  '按钮挂在外壳上且用 forceScrollToBottom',
  /styles\.backToBottom[\s\S]{0,200}onClick=\{forceScrollToBottom\}/.test(ml)
)
check(
  '按钮用向下箭头图标 IconChevronDownOutline14',
  /<IconChevronDownOutline14 \/>/.test(ml)
)
check(
  '切会话时重置按钮',
  /lastSessionIdRef\.current !== session\.id[\s\S]{0,200}setShowBackToBottom\(false\)/.test(ml)
)

console.log('\n四、样式与文案')
check('CSS 有 .backToBottom 圆形按钮', /\.backToBottom \{[\s\S]{0,300}border-radius: 50%/.test(css))
check('CSS .backToBottom 定位在右下且高于输入框', /\.backToBottom \{[\s\S]{0,120}right: 20px[\s\S]{0,80}bottom: (1[6-9]\d|\d{3,})px/.test(css))
check('CSS .backToBottom z-index 高于输入框容器(z=10)', /\.backToBottom \{[\s\S]{0,160}z-index: 1[1-9]/.test(css))
check('css.d.ts 声明了 wrapper / backToBottom', /"wrapper"/.test(cssDts) && /"backToBottom"/.test(cssDts))
check('未改动 scrollContext.ts（不动消费者）', /useContext\(ScrollToBottomContext\)\.scrollToBottom|createContext<\(\) => void>/.test(read('src/components/messages/scrollContext.ts')))
check('zh 文案 backToLatest', /backToLatest: '回到最新'/.test(zh))
check('en 文案 backToLatest', /backToLatest: 'Back to latest'/.test(en))

console.log(failed === 0 ? '\n全部通过\n' : `\n${failed} 项失败\n`)
process.exit(failed === 0 ? 0 : 1)
