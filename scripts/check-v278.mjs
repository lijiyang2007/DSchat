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
const chatInputCss = read('src/components/chatInput/ChatInput.module.css')
const updater = read('src/services/updater.ts')
const zh = read('src/i18n/zh.ts')
const en = read('src/i18n/en.ts')

console.log('\n一、深度思考按钮只切 Pro/Flash，不碰思考强度（v2.8.3）')
check('导入 accountToken', /accountToken/.test(chatInput))
check('导入 setModel / activeProvider', /setModel/.test(chatInput) && /activeProvider/.test(chatInput))
check('按钮 onClick 用 onThinkingClick', /onClick=\{onThinkingClick\}/.test(chatInput))
check('Pro 与 Flash 双向切换', /setModel\(pro\.id\)/.test(chatInput) && /setModel\(flash\.id\)/.test(chatInput))
check('仅官方账号可用', /!isOfficial \|\| !accountToken\(\)/.test(chatInput))
check(
  '绝不调用 setThinkingEffort（不改思考强度）',
  !/setThinkingEffort/.test(chatInput)
)
check('基于 model 判断 usingPro', /usingPro = \/pro\/i\.test\(model\)/.test(chatInput))
check('双语提示文案齐备', /thinkingProQuotaHint/.test(zh) && /thinkingProQuotaHint/.test(en))

console.log('\n一之二、按钮文字标签始终显示（不折叠成纯图标）')
check(
  'CSS 不再用 collapsedToggles 隐藏文字',
  !/\.collapsedToggles \.toggleLabel/.test(chatInputCss) && !/display:\s*none/.test(
    (chatInputCss.match(/\.toggleLabel[^}]*}/g) ?? []).join('')
  )
)
check(
  '移除折叠用的 ResizeObserver 逻辑',
  !/collapsedToggles/.test(chatInput) && !/ResizeObserver/.test(chatInput)
)
check(
  '窄屏改为横向滚动而非隐藏',
  /overflow-x:\s*auto/.test(chatInputCss)
)
check(
  '两个按钮都渲染文字标签',
  /toggleLabel/.test(chatInput) && (chatInput.match(/toggleLabel/g) ?? []).length >= 2
)

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
