/**
 * v2.7.8 修复检查：深度思考切 Pro、更新公告正文补全、版本括号标注。
 *
 * 纯读源码，随时可跑：node scripts/check-v278.mjs
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

const chatInput = read('src/components/chatInput/ChatInput.tsx')
const updater = read('src/services/updater.ts')
const zh = read('src/i18n/zh.ts')
const en = read('src/i18n/en.ts')

console.log('\n一、深度思考 → 官方账号自动切 Pro')
check('导入 accountToken', /accountToken/.test(chatInput))
check('导入 setModel / activeProvider', /setModel/.test(chatInput) && /activeProvider/.test(chatInput))
check('点击处理切 pro 模型', /deepseek-v4-pro/.test(chatInput) && /setModel\(pro\.id\)/.test(chatInput))
check('仅官方账号触发', /isOfficial && accountToken\(\)/.test(chatInput))
check('弹额度提示', /thinkingProQuotaHint/.test(chatInput))
check('按钮 onClick 已换成新处理', /onClick=\{onThinkingClick\}/.test(chatInput))
check('双语提示文案齐备', /thinkingProQuotaHint/.test(zh) && /thinkingProQuotaHint/.test(en))

console.log('\n二、更新公告正文补全（竞速探针 body 为空的修复）')
check('有 fillReleaseBody 补全逻辑', /const fillReleaseBody/.test(updater))
check('补全前检查 body 为空', /release\.body\.trim\(\)/.test(updater))
check('按版本号匹配 Release 取正文', /compareVersionNumbers\(parsed\.version, release\.version\)/.test(updater))
check('applyReleaseResult 是异步且等待补全', /await fillReleaseBody\(release\)/.test(updater))
check('补全后带正文落库', /latest: withBody/.test(updater))
check('检查更新处 await applyReleaseResult', /await applyReleaseResult\(release, manual\)/.test(updater))
check('本版公告仍可用', /loadInstalledRelease/.test(updater))

console.log('\n三、双语键一致')
const keys = (s) => [...s.matchAll(/^  (\w+):/gm)].map((m) => m[1]).sort().join(',')
check('zh/en 键集合完全一致', keys(zh) === keys(en))

console.log(failed === 0 ? '\n全部通过\n' : `\n${failed} 项失败\n`)
process.exit(failed === 0 ? 0 : 1)
