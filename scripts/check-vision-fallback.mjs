/**
 * 官方账号图片/文件识别修复检查（v2.8.2）。
 *
 * 根因：2.7.8「深度思考自动切 pro」后，pro 模型在 thinking 开启时不支持
 * 图片/文件——服务端把图片变成 "[Unsupported Image]" 或报
 * "images are not supported by this model"。官方 /models 里 pro 的
 * input_modalities 只有 text，flash 才是 text+image。
 * 修复：请求组装时，官方协议 + 本轮含 image/document 块 + 当前是 pro → 用回 flash。
 *
 * 纯读源码，随时可跑：node scripts/check-vision-fallback.mjs
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

const store = read('src/services/chat/store.ts')
const zh = read('src/i18n/zh.ts')
const en = read('src/i18n/en.ts')

console.log('\n一、图片/文件请求兜底到 Flash')
check('请求组装处有兜底逻辑', /v2\.8\.2|pro/i.test(store) && /requestModel/.test(store))
check(
  '检测 image 与 document 块',
  /block\.type === 'image' \|\| block\.type === 'document'/.test(store)
)
check('仅官方协议时兜底', /chatProtocol === 'deepseek'/.test(store))
check('pro 模型识别', /\/pro\/i\.test\(requestModel\)/.test(store))
check('兜底为 deepseek-flash', /requestModel = 'deepseek-flash'/.test(store))
check('兜底后请求体用 requestModel', /const requestBody[\s\S]{0,120}model: requestModel/.test(store))
check('有提示文案', /visionFlashFallback/.test(zh) && /visionFlashFallback/.test(en))

console.log('\n二、双语键一致')
const keys = (s) => [...s.matchAll(/^  (\w+):/gm)].map((m) => m[1]).sort().join(',')
check('zh/en 键集合完全一致', keys(zh) === keys(en))

console.log(failed === 0 ? '\n全部通过\n' : `\n${failed} 项失败\n`)
process.exit(failed === 0 ? 0 : 1)
