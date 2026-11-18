/**
 * 语音按钮位置检查（v2.8.3）。
 *
 * 目标：除语音图标外，所有图标位置完全不动；只把语音图标用绝对定位浮到
 * 发送箭头正上方。发送/加号/思考/搜索都保持在原来的横排位置。
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

console.log('\n一、语音图标用绝对定位浮在发送箭头上方')
check('存在 sendAnchor 定位参照', /className=\{styles\.sendAnchor\}/.test(tsx))
check('存在 voiceFloat 浮层', /className=\{styles\.voiceFloat\}/.test(tsx))
check(
  'VoiceButton 在 voiceFloat 浮层内',
  /voiceFloat[^>]*>[\s\S]{0,80}<VoiceButton/.test(tsx)
)
check(
  '发送按钮也在 sendAnchor 内（语音浮在它上方）',
  /sendAnchor[\s\S]{0,900}IconSendOutline16/.test(tsx) &&
    /sendAnchor[\s\S]{0,900}IconStopFill16/.test(tsx)
)
check('VoiceButton 只出现一次', (tsx.match(/<VoiceButton/g) ?? []).length === 1)
check('旧的 sendColumn 竖排已移除', !/sendColumn/.test(tsx) && !/sendColumn/.test(css))

console.log('\n二、CSS：绝对定位，不占横向空间、不改其它图标')
check('sendAnchor 是相对定位参照', /\.sendAnchor\s*\{[\s\S]{0,120}position:\s*relative/.test(css))
check(
  'voiceFloat 绝对定位到上方',
  /\.voiceFloat\s*\{[\s\S]{0,160}position:\s*absolute[\s\S]{0,160}bottom:\s*calc\(100%/.test(css)
)
check(
  'voiceFloat 水平居中于发送按钮',
  /\.voiceFloat\s*\{[\s\S]{0,240}left:\s*50%[\s\S]{0,120}translateX\(-50%\)/.test(css)
)
check(
  '横排间距由 sendAnchor 提供（原发送按钮位置不变）',
  /\.sendAnchor\s*\{[\s\S]{0,220}margin-left:\s*8px/.test(css) &&
    !/\.sendButton\s*\{[\s\S]{0,220}margin-left/.test(css)
)

console.log(failed === 0 ? '\n全部通过\n' : `\n${failed} 项失败\n`)
process.exit(failed === 0 ? 0 : 1)
