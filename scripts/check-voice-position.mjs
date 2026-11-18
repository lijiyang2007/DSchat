/**
 * 语音按钮位置检查（v2.8.1）：语音按钮放到发送按钮正上方（竖排），
 * 不再占用横向空间挡住「深度思考 / 智能搜索」文字。
 *
 * 纯读源码，随时可跑：node scripts/check-voice-position.mjs
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

const tsx = read('src/components/chatInput/ChatInput.tsx')
const css = read('src/components/chatInput/ChatInput.module.css')

console.log('\n一、语音按钮放到发送按钮上方（竖排容器）')
check('存在 sendColumn 容器', /className=\{styles\.sendColumn\}/.test(tsx))
check(
  'VoiceButton 在 sendColumn 内',
  /sendColumn[^>]*>[\s\S]{0,120}<VoiceButton/.test(tsx)
)
check(
  '发送/停止按钮也在 sendColumn 内',
  /sendColumn[\s\S]{0,1800}IconSendOutline16/.test(tsx) &&
    /sendColumn[\s\S]{0,1800}IconStopFill16/.test(tsx)
)
check(
  '横排原位置不再单独放 VoiceButton',
  (tsx.match(/<VoiceButton/g) ?? []).length === 1
)

console.log('\n二、CSS 竖排 + 不占横向空间')
check('sendColumn 是纵向排列', /\.sendColumn\s*\{[\s\S]{0,120}flex-direction:\s*column/.test(css))
check(
  'sendColumn 有左外边距替代原 sendButton 的',
  /\.sendColumn\s*\{[\s\S]{0,200}margin-left:\s*8px/.test(css)
)
check(
  'sendButton 不再有 margin-left（避免重复间距）',
  !/\.sendButton\s*\{[\s\S]{0,220}margin-left/.test(css)
)

console.log(failed === 0 ? '\n全部通过\n' : `\n${failed} 项失败\n`)
process.exit(failed === 0 ? 0 : 1)
