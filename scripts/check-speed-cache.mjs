/**
 * v2.9.4 检查：输出速度显示 + 缓存命中提升三项（方案 A / B / D）。
 *
 * 一、输出速度：行为断言跑 `.tmp-check/compaction.mjs` 的 `outputSpeedDetail`
 *     （只认带 timing 的回复、区间 <200ms 跳过、思考 token 也算生成）。
 * 二、方案 A：动态记忆从 system 挪到本轮提问前导 —— 断言**实际请求体**的
 *     system 里不再出现记忆，记忆出现在最后一条 user 消息里。
 * 三、方案 B：长期记忆按 updatedAt 升序输出（新条目追加在末尾）。
 * 四、方案 D：autoExtractMemory 默认关闭；跨对话记忆打开时给警告。
 *
 * 运行：node scripts/build-checks.mjs && node scripts/check-speed-cache.mjs
 */
import { readFileSync } from 'node:fs'
import { outputSpeedDetail } from '../.tmp-check/compaction.mjs'

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
const mkReply = (id, text, extra = {}) => ({
  id,
  role: 'assistant',
  createdAt: 2,
  model: 'm',
  prefix: false,
  status: 'done',
  stopReason: 'end_turn',
  blocks: [{ type: 'text', text }],
  ...extra,
})
const usage = (output) => ({
  input_tokens: 1000,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  output_tokens: output,
})

console.log('\n一、输出速度算法（真实函数输出）')
check('没有 timing 时返回 null', outputSpeedDetail([mkUser('u1', 'q'), mkReply('a1', 'a', { usage: usage(500) })]) === null)
check('没有 usage 时返回 null', outputSpeedDetail([mkUser('u1', 'q'), mkReply('a1', 'a', { timing: { startedAt: 0, endedAt: 5000 } })]) === null)

const speed = outputSpeedDetail([
  mkUser('u1', 'q'),
  mkReply('a1', 'a', { usage: usage(400), timing: { startedAt: 1000, endedAt: 3000 } }),
])
check('token 取 output_tokens', speed?.tokens === 400, String(speed?.tokens))
check('秒数 = 区间 / 1000', speed?.seconds === 2, String(speed?.seconds))
check('速度 = token / 秒', speed?.perSecond === 200, String(speed?.perSecond))

const fast = outputSpeedDetail([
  mkUser('u1', 'q'),
  mkReply('a1', 'a', { usage: usage(37), timing: { startedAt: 0, endedAt: 1500 } }),
])
check('保留一位小数', fast?.perSecond === 24.7, String(fast?.perSecond))

const tooShort = [
  mkUser('u1', 'q'),
  mkReply('a0', 'old', { usage: usage(900), timing: { startedAt: 0, endedAt: 4000 } }),
  mkUser('u2', 'q2'),
  mkReply('a1', 'a', { usage: usage(10), timing: { startedAt: 0, endedAt: 100 } }),
]
check('区间 <200ms 视为测不准，往前找', outputSpeedDetail(tooShort)?.tokens === 900)

const zeroTokens = [
  mkUser('u1', 'q'),
  mkReply('a0', 'old', { usage: usage(600), timing: { startedAt: 0, endedAt: 2000 } }),
  mkUser('u2', 'q2'),
  mkReply('a1', 'a', { usage: usage(0), timing: { startedAt: 0, endedAt: 3000 } }),
]
check('输出 0 token 的回复跳过', outputSpeedDetail(zeroTokens)?.tokens === 600)

const multi = [
  mkUser('u1', 'q1'),
  mkReply('a1', 'a1', { usage: usage(100), timing: { startedAt: 0, endedAt: 1000 } }),
  mkUser('u2', 'q2'),
  mkReply('a2', 'a2', { usage: usage(300), timing: { startedAt: 0, endedAt: 3000 } }),
]
check('取最近一轮而不是累加', outputSpeedDetail(multi)?.tokens === 300, String(outputSpeedDetail(multi)?.tokens))
check('末尾是进行中的提问时仍取上一条', outputSpeedDetail([...multi, mkUser('u3', '进行中')])?.tokens === 300)

console.log('\n二、输出速度接线')
const contextUsage = read('src/components/settings/ContextUsage.tsx')
const css = read('src/components/settings/ContextUsage.module.css')
const store = read('src/services/chat/store.ts')
const compaction = read('src/services/chat/compaction.ts')
const types = read('src/services/chat/types.ts')
check('AssistantMessage 有 timing 字段', /timing\?: \{ startedAt: number; endedAt: number \}/.test(types))
check('compaction 导出 outputSpeedDetail', /export const outputSpeedDetail/.test(compaction))
check('面板导入并调用它', /outputSpeedDetail\(getVisibleMessages\(session\)\)/.test(contextUsage))
check('面板按 token/s 展示', /settingsOutputSpeedLabel/.test(contextUsage) && /speed\.perSecond/.test(contextUsage))
check('没有计时时不渲染该行', /\{speed \? \(/.test(contextUsage))
check('CSS 有速度样式类', /\.speedValue\s*\{/.test(css))
check('第一个内容块开始计时', /event\.type === 'content_block_start' && firstBlockAt === 0[\s\S]{0,80}firstBlockAt = Date\.now\(\)/.test(store))
check('回复收尾写入 timing', /timing: \{ startedAt: firstContentAt, endedAt: Date\.now\(\) \}/.test(store))
check('没收到内容块就不记 timing', /if \(firstBlockAt\) \{\s*reply = \{ \.\.\.reply, timing:/.test(store))

console.log('\n三、方案 A：动态记忆挪出 system（缓存前缀）')
check('system 只留提示词 + 压缩摘要', /const system = \[baseSystem, compactionContext\][\s\S]{0,80}join\('\\n\\n'\)/.test(store))
check('system 不再拼长期记忆', !/const system = \[[^\]]*savedMemoryContext/.test(store))
check('system 不再拼跨对话记忆', !/const system = \[[^\]]*memoryContext\][\s\S]{0,40}join/.test(store))
check('有 composeDynamicContext', /const composeDynamicContext = \(savedMemoryContext: string, memoryContext: string\)/.test(store))
check('动态内容拼到本轮提问前面', /content: `\$\{dynamicContext\}\\n\\n\$\{inlinePrepared\.question\.content\}`/.test(store))
check('请求体用的是重组后的 messages', /messages: messagesWithContext/.test(store))
check('压缩摘要仍在 system（跟会话走，频率低）', /getCompactionContext\(sessionId\)/.test(store))

console.log('\n四、方案 B：长期记忆按 updatedAt 升序追加')
const savedMemory = read('src/services/chat/savedMemory.ts')
check('注入时按 updatedAt 升序排序', /\.sort\(\(a, b\) => a\.updatedAt - b\.updatedAt/.test(savedMemory))
check('排序是稳定的（同时间按 id）', /a\.id < b\.id \? -1 : a\.id > b\.id \? 1 : 0/.test(savedMemory))
check('不就地修改 state（先 slice）', /\.filter\(\(item\) => item\.enabled[\s\S]{0,80}\.slice\(\)/.test(savedMemory))
check('存储顺序保持不变（仍是新条目在前）', /commit\(\[created, \.\.\.current\]\)/.test(savedMemory))

console.log('\n五、方案 D：默认值与警告')
const settings = read('src/services/settings.ts')
const memorySettings = read('src/components/settings/MemorySettings.tsx')
check('autoExtractMemory 默认关闭', /autoExtractMemory: readBool\(KEYS\.autoExtractMemory, false\)/.test(settings))
check('跨对话记忆默认仍关闭', /crossChatMemory: readBool\(KEYS\.crossChatMemory, false\)/.test(settings))
check('打开跨对话记忆时显示缓存警告', /settings\.crossChatMemory \? \([\s\S]{0,120}memoryCrossChatCacheHint/.test(memorySettings) || /memoryCrossChatCacheHint/.test(memorySettings))

console.log('\n六、i18n 双语齐备')
const zh = read('src/i18n/zh.ts')
const en = read('src/i18n/en.ts')
const keys = (s) => [...s.matchAll(/^  (\w+):/gm)].map((m) => m[1])
const zhKeys = keys(zh)
const enKeys = keys(en)
check('中文无重复键', new Set(zhKeys).size === zhKeys.length)
check('英文无重复键', new Set(enKeys).size === enKeys.length)
check('zh/en 键集合一致', [...zhKeys].sort().join(',') === [...enKeys].sort().join(','), `${zhKeys.length} vs ${enKeys.length}`)
for (const key of [
  'settingsOutputSpeedLabel',
  'settingsOutputSpeedDetail',
  'settingsOutputSpeedHint',
  'memoryCrossChatCacheHint',
]) {
  check(`新增键 ${key} 双语齐备`, zhKeys.includes(key) && enKeys.includes(key))
}

console.log(failed === 0 ? '\n全部通过\n' : `\n${failed} 项失败\n`)
process.exit(failed === 0 ? 0 : 1)