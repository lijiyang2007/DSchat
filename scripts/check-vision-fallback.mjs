/**
 * 官方账号图片/文件处理检查（v2.8.3）。
 *
 * 官方 pro 模型不支持图片/文件（thinking 时会变成 [Unsupported Image] 或报
 * images are not supported by this model）。v2.8.3 的决定：**不擅自改模型**，
 * 只在带图片/文件且当前是 pro 时弹提示，让用户自己决定是否切回 Flash。
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

console.log('\n一、Pro 带图/文件时只提示、不换模型')
check('检测 image 与 document 块', /block\.type === 'image' \|\| block\.type === 'document'/.test(store))
check('仅官方协议', /chatProtocol === 'deepseek'/.test(store))
check('pro 模型识别', /\/pro\/i\.test\(requestModel\)/.test(store))
check('弹提示 visionProNoImage', /showToast\(\{ key: 'visionProNoImage' \}\)/.test(store))
check(
  '不再擅自把模型改成 flash',
  !/requestModel = 'deepseek-flash'/.test(store)
)
check('请求仍用当前模型 requestModel', /const requestBody[\s\S]{0,120}model: requestModel/.test(store))
check('提示文案双语齐备', /visionProNoImage/.test(zh) && /visionProNoImage/.test(en))

console.log('\n二、双语键一致')
const keys = (s) => [...s.matchAll(/^  (\w+):/gm)].map((m) => m[1]).sort().join(',')
check('zh/en 键集合完全一致', keys(zh) === keys(en))

console.log(failed === 0 ? '\n全部通过\n' : `\n${failed} 项失败\n`)
process.exit(failed === 0 ? 0 : 1)
