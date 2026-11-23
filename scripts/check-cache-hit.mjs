/**
 * v2.9.3 检查：设置-对话设置里显示缓存命中百分数。
 *
 * 判定分两层：
 * 1. **行为断言**（优先）：直接跑 `.tmp-check/compaction.mjs` 里的 `cacheHitDetail`，
 *    用真实形状的 usage 验证命中率算得对不对——命中量取 cache_read_input_tokens，
 *    总输入是 input + cache_creation + cache_read 三者之和。
 * 2. **接线断言**：面板确实渲染了它、i18n 双语键齐备、CSS 类存在。
 *
 * 运行：node scripts/build-checks.mjs && node scripts/check-cache-hit.mjs
 */
import { readFileSync } from 'node:fs'
import { cacheHitDetail } from '../.tmp-check/compaction.mjs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

let failed = 0
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok   ${label}`)
  else {
    failed += 1
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const mkUser = (id, content) => ({ id, role: 'user', content, files: [], createdAt: 1 })
const mkReply = (id, text, usage) => ({
  id,
  role: 'assistant',
  createdAt: 2,
  model: 'm',
  prefix: false,
  status: 'done',
  stopReason: 'end_turn',
  blocks: [{ type: 'text', text }],
  ...(usage ? { usage } : {}),
})

const usage = (input, cached, output, created = 0) => ({
  input_tokens: input,
  cache_creation_input_tokens: created,
  cache_read_input_tokens: cached,
  output_tokens: output,
})

console.log('\n一、命中率算法（真实函数输出）')
check('没有 usage 时返回 null', cacheHitDetail([mkUser('u1', 'hi')]) === null)
check('没有助手消息时返回 null', cacheHitDetail([]) === null)

const hit = cacheHitDetail([mkUser('u1', '你好'), mkReply('a1', '回答', usage(2000, 8000, 300))])
check('命中量取 cache_read_input_tokens', hit?.hit === 8000, String(hit?.hit))
check('总输入不含输出 token', hit?.total === 10000, String(hit?.total))
check('比例 = 命中 / 总输入', Math.abs((hit?.ratio ?? 0) - 0.8) < 1e-9, String(hit?.ratio))

const created = cacheHitDetail([mkUser('u1', 'q'), mkReply('a1', 'a', usage(1000, 0, 50, 500))])
check('cache_creation 计入总输入', created?.total === 1500, String(created?.total))
check('没命中时为 0%', created?.ratio === 0, String(created?.ratio))

const full = cacheHitDetail([mkUser('u1', 'q'), mkReply('a1', 'a', usage(0, 5000, 100))])
check('全命中为 100%', full?.ratio === 1, String(full?.ratio))

const zero = cacheHitDetail([mkUser('u1', 'q'), mkReply('a1', 'a', usage(0, 0, 0))])
check('全 0 的 usage 视为无记录', zero === null)

console.log('\n二、只读本轮（和上下文用量面板口径一致）')
const multi = [
  mkUser('u1', 'q1'),
  mkReply('a1', 'a1', usage(10000, 0, 50)),
  mkUser('u2', 'q2'),
  mkReply('a2', 'a2', usage(2000, 6000, 80)),
]
const latest = cacheHitDetail(multi)
check('取最近一轮而不是累加历史', latest?.total === 8000, String(latest?.total))
check('最近一轮命中量正确', latest?.hit === 6000, String(latest?.hit))

const trailing = [...multi, mkUser('u3', '进行中的提问')]
check('末尾没有助手回复时仍取上一条', cacheHitDetail(trailing)?.total === 8000)

console.log('\n三、面板接线')
const contextUsage = read('src/components/settings/ContextUsage.tsx')
const css = read('src/components/settings/ContextUsage.module.css')
const compaction = read('src/services/chat/compaction.ts')
check('compaction 导出 cacheHitDetail', /export const cacheHitDetail/.test(compaction))
check('面板导入并调用它', /import \{[\s\S]{0,200}cacheHitDetail/.test(contextUsage) && /cacheHitDetail\(getVisibleMessages\(session\)\)/.test(contextUsage))
check('命中率按百分数展示', /\{Math\.round\(cacheHit\.ratio \* 100\)\}%/.test(contextUsage))
check('同时给出命中量 / 总输入量', /settingsCacheHitDetail/.test(contextUsage))
check('没有用量时不渲染该行', /\{cacheHit \? \(/.test(contextUsage))
check('CSS 有对应样式类', /\.cacheRow\s*\{/.test(css) && /\.cacheValue\s*\{/.test(css))

console.log('\n四、入口在 设置-对话设置 里')
const dialog = read('src/components/settings/SettingsDialog.tsx')
check('对话设置渲染 ContextUsage', /const ChatSettings = \(\)[\s\S]{0,600}<ContextUsage actions \/>/.test(dialog))
check('对话设置分组仍是「上下文用量」', dialog.includes("t('settingsContextUsageTitle')"))

console.log('\n五、i18n 双语齐备')
const zh = read('src/i18n/zh.ts')
const en = read('src/i18n/en.ts')
const keys = (s) => [...s.matchAll(/^  (\w+):/gm)].map((m) => m[1])
const zhKeys = keys(zh)
const enKeys = keys(en)
check('中文无重复键', new Set(zhKeys).size === zhKeys.length)
check('英文无重复键', new Set(enKeys).size === enKeys.length)
check('zh/en 键集合一致', [...zhKeys].sort().join(',') === [...enKeys].sort().join(','), `${zhKeys.length} vs ${enKeys.length}`)
for (const key of ['settingsCacheHitLabel', 'settingsCacheHitDetail', 'settingsCacheHitHint']) {
  check(`新增键 ${key} 双语齐备`, zhKeys.includes(key) && enKeys.includes(key))
}
check(
  'detail 占位符两边一致（{hit} / {total}）',
  /settingsCacheHitDetail: '\{hit\} \/ \{total\} tokens'/.test(zh) &&
    /settingsCacheHitDetail: '\{hit\} of \{total\} tokens'/.test(en)
)

console.log(failed === 0 ? '\n全部通过\n' : `\n${failed} 项失败\n`)
process.exit(failed === 0 ? 0 : 1)