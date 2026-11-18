/**
 * 主动压缩上下文检查（v2.8.8）。
 *
 * 需求：用户可以主动把较早的轮次压成摘要，不必等 80% 阈值。
 * 与自动压缩的区别：planManualCompaction **不看阈值**，按「保留最近 N 轮原文」切。
 *
 * 运行：node scripts/build-checks.mjs && node scripts/check-manual-compaction.mjs
 */
import { readFileSync } from 'node:fs'
import {
  buildSummaryPrompt,
  formatCompactionContext,
  getContextWindow,
  manualCompactionStats,
  planManualCompaction,
} from '../.tmp-check/compaction.mjs'

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
const compaction = read('src/services/chat/compaction.ts')
const usage = read('src/components/settings/ContextUsage.tsx')
const dialog = read('src/components/settings/SettingsDialog.tsx')
const zh = read('src/i18n/zh.ts')
const en = read('src/i18n/en.ts')

// —— 构造测试数据 ——
const user = (id, text) => ({ id, role: 'user', content: text, files: [], createdAt: 1 })
const reply = (id, text) => ({
  id,
  role: 'assistant',
  createdAt: 2,
  model: 'm',
  prefix: true,
  status: 'done',
  stopReason: 'end_turn',
  blocks: [{ type: 'text', text }],
})
const buildHistory = (rounds) => {
  const messages = []
  for (let i = 0; i < rounds; i += 1) {
    messages.push(user(`u${i}`, `问题 ${i} ` + 'x'.repeat(200)))
    messages.push(reply(`a${i}`, `回答 ${i} ` + 'y'.repeat(200)))
  }
  return messages
}

console.log('\n一、数据层：planManualCompaction 不看阈值')
check('有 planManualCompaction', /export const planManualCompaction/.test(compaction))
check('有 manualCompactionStats', /export const manualCompactionStats/.test(compaction))
check(
  '手动压缩不读取触发比例常量',
  !/planManualCompaction[\s\S]{0,800}COMPACT_TRIGGER_RATIO/.test(compaction)
)
check('至少保留 MIN_KEEP_ROUNDS 轮', /const keep = Math\.max\(MIN_KEEP_ROUNDS, keepRounds\)/.test(compaction))

console.log('\n二、切分行为（用真实函数跑）')
// 10 轮，保留 3 轮 → 应压掉 7 轮
const history10 = buildHistory(10)
const plan = planManualCompaction({
  history: history10,
  compaction: undefined,
  allowRefused: false,
  keepRounds: 3,
})
check('10 轮保留 3 轮时能压', plan !== null)
check('压掉 7 轮', plan?.covered.length === 7, String(plan?.covered.length))
check('保留 3 轮原文', plan?.kept.length === 3, String(plan?.kept.length))
check('保留的是最近的轮次', plan?.kept[0][0].id === 'u7' && plan?.kept.at(-1)[0].id === 'u9')
check('throughMessageId 是最后一条被压的回答', plan?.throughMessageId === 'a6')
check('covered 与 kept 首尾相接不重叠', plan?.covered.at(-1)[1].id === 'a6' && plan?.kept[0][0].id === 'u7')

// 轮次不足：4 轮保留 3 轮 → 只能压 1 轮，仍允许
const plan4 = planManualCompaction({
  history: buildHistory(4),
  compaction: undefined,
  allowRefused: false,
  keepRounds: 3,
})
check('4 轮能压掉 1 轮', plan4?.covered.length === 1)

// 刚好等于保留数：不能压
const plan3 = planManualCompaction({
  history: buildHistory(3),
  compaction: undefined,
  allowRefused: false,
  keepRounds: 3,
})
check('3 轮无可压缩（返回 null）', plan3 === null)

// 少于保留数：不能压
check(
  '2 轮无可压缩',
  planManualCompaction({ history: buildHistory(2), compaction: undefined, allowRefused: false, keepRounds: 3 }) === null
)

// keepRounds 小于下限时按 MIN_KEEP_ROUNDS 兜底
const planKeep1 = planManualCompaction({
  history: buildHistory(10),
  compaction: undefined,
  allowRefused: false,
  keepRounds: 1,
})
check('keepRounds 低于下限时按 2 轮兜底', planKeep1?.kept.length === 2, String(planKeep1?.kept.length))

// 已经压过一部分：只压新增的
const planIncremental = planManualCompaction({
  history: buildHistory(10),
  compaction: { summary: '旧摘要', throughMessageId: 'a4', tokens: 100, compactedAt: 1, count: 1 },
  allowRefused: false,
  keepRounds: 3,
})
check('增量压缩跳过已压过的轮次', planIncremental?.covered[0][0].id === 'u5')
check('增量压缩压掉 2 轮（5~6）', planIncremental?.covered.length === 2, String(planIncremental?.covered.length))

// 已压到倒数第 3 轮：没有可压的了
check(
  '已压到保留边界时返回 null',
  planManualCompaction({
    history: buildHistory(10),
    compaction: { summary: 's', throughMessageId: 'a6', tokens: 1, compactedAt: 1, count: 1 },
    allowRefused: false,
    keepRounds: 3,
  }) === null
)

console.log('\n三、统计函数（界面提示用）')
const stats = manualCompactionStats({
  history: buildHistory(10),
  compaction: undefined,
  allowRefused: false,
  keepRounds: 3,
})
check('total 是总轮次', stats.total === 10, String(stats.total))
check('compactable 是可压缩轮次', stats.compactable === 7, String(stats.compactable))
check('keep 是保留轮次', stats.keep === 3, String(stats.keep))
const statsSmall = manualCompactionStats({
  history: buildHistory(2),
  compaction: undefined,
  allowRefused: false,
  keepRounds: 3,
})
check('轮次不足时 compactable 为 0', statsSmall.compactable === 0)
check('轮次不足时 keep 不超过总数', statsSmall.keep === 2, String(statsSmall.keep))

console.log('\n四、摘要输入可复用')
const prompt = buildSummaryPrompt(plan.covered, undefined)
check('摘要输入包含被压缩的轮次', prompt.includes('第 1 轮') && prompt.includes('第 7 轮'))
check('摘要输入不含保留的轮次', !prompt.includes('问题 7'))
const promptWithPrev = buildSummaryPrompt(plan.covered, '既有摘要内容')
check('传旧摘要时会带上', promptWithPrev.includes('既有摘要内容'))
check('formatCompactionContext 仍可用', formatCompactionContext('摘要').includes('摘要'))
check('getContextWindow 仍可用', getContextWindow('deepseek-flash') === 128000)

console.log('\n五、store 暴露主动压缩入口')
check('导出 compactSession', /export const compactSession/.test(store))
check('导出 clearSessionCompaction', /export const clearSessionCompaction/.test(store))
check('生成中拒绝压缩', /if \(getStreamController\(sessionId\)\)[\s\S]{0,120}throw/.test(store))
check('导入中拒绝压缩', /if \(get\(\)\.importingHistory\)[\s\S]{0,120}throw/.test(store))
check('无可压缩时抛 nothing to compact', /nothing to compact/.test(store))
check('压缩时设置 compacting 状态', /compacting: \{ \.\.\.state\.compacting, \[sessionId\]: true \}/.test(store))
check('压缩后落盘', /compaction: \{[\s\S]{0,300}persist\(sessionId\)/.test(store))
check('清除摘要真的删字段', /delete next\.compaction/.test(store))

console.log('\n六、界面')
check('ContextUsage 支持 actions 开关', /actions = false/.test(usage))
check('设置页传 actions', /<ContextUsage actions \/>/.test(dialog))
check('按钮调用 compactSession', /compactSession\(targetId, 3\)/.test(usage))
check('按钮调用 clearSessionCompaction', /clearSessionCompaction\(targetId\)/.test(usage))
check('压缩中禁用按钮', /disabled=\{!canCompact \|\| working\}/.test(usage))
check('压缩中沿用自动压缩的 compacting 状态', /state\.compacting\[targetId\]/.test(usage))
check('有摘要时才显示清除按钮', /hasSummary \? \(/.test(usage))

console.log('\n七、文案（中英键集合一致）')
const zhKeys = [...zh.matchAll(/^  (\w+):/gm)].map((m) => m[1])
const enKeys = [...en.matchAll(/^  (\w+):/gm)].map((m) => m[1])
check('中英键集合一致', [...zhKeys].sort().join(',') === [...enKeys].sort().join(','))
for (const key of [
  'contextCompactManualDone',
  'contextCompactNow',
  'contextCompactWorking',
  'contextCompactNothing',
  'contextCompactKeepHint',
  'contextCompactClear',
  'contextCompactCleared',
  'contextCompactFailed',
  'contextCompactBusyReply',
  'contextCompactAlreadyRunning',
]) {
  check(`${key} 中英都有`, zhKeys.includes(key) && enKeys.includes(key))
}

console.log(failed === 0 ? '\n全部通过\n' : `\n${failed} 项失败\n`)
process.exit(failed === 0 ? 0 : 1)
