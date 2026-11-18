// 固定字速打字机（v2.7.3）功能检查：逐字揭示、光标渲染、档位字速
// 运行：node scripts/build-checks.mjs && node scripts/check-typewriter.mjs
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const typewriter = read('src/components/markdown/useTypewriter.ts')
const markdown = read('src/components/markdown/Markdown.tsx')
const renderer = read('src/components/markdown/MarkdownAstRenderer.tsx')
const css = read('src/components/markdown/markdown.css')
const assistant = read('src/components/messages/AssistantMessage.tsx')
const settings = read('src/services/settings.ts')
const zh = read('src/i18n/zh.ts')
const en = read('src/i18n/en.ts')

let failures = 0
const check = (name, ok, detail = '') => {
  if (ok) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name} ${detail}`)
  }
}

console.log('一、打字机核心（useTypewriter）')
check('有 useTypewriter hook', typewriter.includes('export const useTypewriter'))
check('时间驱动揭示（rAF tick）', typewriter.includes('requestAnimationFrame(tick)'))
check('锚点重置（续写不重打）', typewriter.includes('anchorRef.current = { length:'))
check('消息切换从头重放', typewriter.includes("keyRef.current !== messageKey"))
check('积压加速追赶', typewriter.includes('CATCH_UP_HARD_MULT') && typewriter.includes('CATCH_UP_SOFT_MULT'))
check('减少动态效果直接全文', typewriter.includes('prefers-reduced-motion'))
check('光标占位符 U+E000', typewriter.includes("TYPEWRITER_SENTINEL = '\\uE000'"))
check('语法字符后不放光标', typewriter.includes('CARET_UNSAFE'))
check('代码围栏成对才放光标', typewriter.includes('fencesAreEven'))

console.log('\n二、固定字速档位（复用输出速度设置）')
check('流畅 32 字/秒', /smooth: 32/.test(typewriter))
check('均衡 55 字/秒', /balanced: 55/.test(typewriter))
check('完整 320 字/秒', /full: 320/.test(typewriter))
check('复用 streamThrottle 设置', typewriter.includes('state.streamThrottle'))

console.log('\n三、光标渲染接入')
check('Markdown 接收 revealKey', markdown.includes('revealKey'))
check('AST 渲染器支持 caret', renderer.includes('caret?: boolean') && renderer.includes('ds-typewriter-caret'))
check('CSS 有闪烁动画', css.includes('ds-typewriter-caret') && css.includes('ds-typewriter-blink'))
check('CSS 尊重减少动态效果', css.includes('@media (prefers-reduced-motion: reduce)'))
check('主回答接入打字机', assistant.includes('useTypewriter(') && assistant.includes('revealKey={message.id}'))

console.log('\n四、i18n 双语一致')
const keys = (src) => [...src.matchAll(/^  (\w+):/gm)].map((m) => m[1]).sort().join(',')
check('中英键集合一致', keys(zh) === keys(en))

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
