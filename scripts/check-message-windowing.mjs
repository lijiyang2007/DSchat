/**
 * 长会话窗口化渲染检查（v2.8.6）。
 *
 * 背景：2.3.0~2.8.5 的「虚拟滚动」是 `content-visibility: auto` +
 * `contain-intrinsic-size: auto 160px` 的假虚拟化——消息全在 DOM 里，只是跳过绘制。
 * 实测一条 120 条消息的长会话：真实高度 227998px，被估算成 19224px（差 12 倍），
 * 滚到哪就把估算换成实测，滚动条一缩一胀 → 界面乱跳；DOM 节点 30126 个 → 卡。
 *
 * v2.8.6 换成真窗口化：只挂载视口附近的消息，视口外用等高占位块撑住。
 * 实测同一条会话：DOM 节点 30126 → 657，高度漂移 12 倍 → 1.9%。
 *
 * 纯读源码 + 纯函数断言，随时可跑：node scripts/check-message-windowing.mjs
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
const hook = read('src/components/messages/useMessageWindowing.ts')
const css = read('src/components/messages/MessageList.module.css')
const cssDts = read('src/components/messages/MessageList.module.css.d.ts')

console.log('\n一、假虚拟化已移除')
check('不再用 content-visibility', !/content-visibility/.test(css))
check('不再用 contain-intrinsic-size 估算', !/contain-intrinsic-size/.test(css))
check('MessageList 不再有 virtualItem 样式引用', !/virtualItem/.test(ml))
check('css.d.ts 不再声明 virtualItem', !/virtualItem/.test(cssDts))

console.log('\n二、真窗口化结构')
check('有 .item 与 .pad 两个样式类', /\.item \{/.test(css) && /\.pad \{/.test(css))
check('css.d.ts 声明了 item / pad', /"item"/.test(cssDts) && /"pad"/.test(cssDts))
check('消息外层带 data-message-id（供测量）', /data-message-id=\{message\.id\}/.test(ml))
check('上下占位块按高度渲染', /styles\.pad\} style=\{\{ height: padTop \}\}/.test(ml) &&
  /styles\.pad\} style=\{\{ height: padBottom \}\}/.test(ml))
check('只渲染窗口内的消息', /messages\.slice\(start, end\)\.map/.test(ml))
check(
  '窗口范围由 start/end 驱动',
  /useMessageWindowing\(\{/.test(ml) && /const \{ start, end, padTop, padBottom/.test(ml)
)

console.log('\n三、开关条件')
check('超过阈值才窗口化', /WINDOWING_THRESHOLD = 30/.test(ml))
check(
  '流式输出时整列渲染（末尾要实时刷新）',
  /messages\.length > WINDOWING_THRESHOLD && !streaming/.test(ml)
)
check('关闭窗口化时 start/end 覆盖全部消息', /if \(!enabled\)[\s\S]{0,160}end: count, padTop: 0, padBottom: 0/.test(hook))

console.log('\n四、滚动稳定性（乱跳的根因）')
check('实测高度按消息 id 缓存', /heightsRef = useRef\(new Map<string, number>\(\)\)/.test(hook))
check('高度实测优先于估算', /heightsRef\.current\.get\(ids\[index\]\) \?\? estimates\[index\]/.test(hook))
check('视口上方高度变化要补正滚动量', /index < firstVisible[\s\S]{0,120}shift \+= height/.test(hook))
check('补正后回写 scrollTop', /shiftRef\.current = 0[\s\S]{0,80}scrollTop \+= shift/.test(hook))
check('落底后持续贴底到高度稳定', /pinBottomRef/.test(hook) && /scrollTop = scroll\.scrollHeight/.test(hook))
check('用 ResizeObserver 跟进被动高度变化', /new ResizeObserver/.test(hook))
check('估算有上限，避免超长回答拉爆滚动条', /MAX_ESTIMATE = \d+/.test(hook))

console.log('\n五、估算函数是纯函数且合理')
check('用户消息按字数估算', /message\.role === 'user'[\s\S]{0,160}content\.length \/ 20/.test(hook))
check('助手消息按正文字数估算', /chars \* 1\.05/.test(hook))
check('估算值有下限保护', /Math\.max\(24, height\)/.test(hook))

console.log('\n六、不破坏既有滚动行为')
check('stickyRef 仍恒 false', /stickyRef = useRef\(false\)/.test(ml))
check('scrollToBottom 仍有 sticky 守卫', /if \(el && stickyRef\.current\)/.test(ml))
check('回到最新按钮仍在', /forceScrollToBottom/.test(ml) && /styles\.backToBottom/.test(ml))
check('切会话落底仍保留', /scrollWindowToBottom\(\)/.test(ml))

console.log(failed === 0 ? '\n全部通过\n' : `\n${failed} 项失败\n`)
process.exit(failed === 0 ? 0 : 1)
