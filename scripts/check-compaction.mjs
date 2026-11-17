// Ad-hoc harness for the compaction planner (no test runner in the repo).
// Run with: node scripts/check-compaction.mjs
import {
  buildSummaryPrompt,
  estimateHistoryTokens,
  getContextWindow,
  planCompaction,
} from '../.tmp-check/compaction.mjs'

const mkUser = (id, content) => ({
  id,
  role: 'user',
  content,
  files: [],
  createdAt: 1,
})

const mkReply = (id, text) => ({
  id,
  role: 'assistant',
  createdAt: 2,
  model: 'deepseek-flash',
  prefix: false,
  status: 'done',
  stopReason: 'end_turn',
  blocks: [{ type: 'text', text }],
})

const buildHistory = (rounds, charsPerRound) => {
  const messages = []
  for (let i = 1; i <= rounds; i += 1) {
    messages.push(mkUser(`u${i}`, 'q'.repeat(charsPerRound)))
    messages.push(mkReply(`a${i}`, 'a'.repeat(charsPerRound)))
  }
  return messages
}

let failures = 0
const check = (name, condition, detail = '') => {
  if (condition) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name} ${detail}`)
  }
}

console.log('getContextWindow')
check('已知模型', getContextWindow('deepseek-flash') === 128000)
check('大小写/空白', getContextWindow('  DeepSeek-Chat ') === 128000)
check('带日期后缀按前缀匹配', getContextWindow('gpt-4o-2024-08-06') === 128000)
check('未知模型用保守默认', getContextWindow('some-local-model') === 64000)

console.log('\nplanCompaction')
// 短对话不触发
{
  const history = buildHistory(3, 200)
  check('短对话不压缩', planCompaction({ history, compaction: undefined, model: 'deepseek-flash', allowRefused: false }) === null)
}
// 长对话触发，并保留最近若干轮
{
  // 40 轮 × 每轮 8000 字符 ≈ 40*2*8000/2.2 ≈ 290k token，远超 80% 阈值
  const history = buildHistory(40, 8000)
  const plan = planCompaction({ history, compaction: undefined, model: 'deepseek-flash', allowRefused: false })
  check('长对话触发压缩', plan !== null)
  if (plan) {
    check('保留至少 2 轮原文', plan.kept.length >= 2, `kept=${plan.kept.length}`)
    check('覆盖轮次 + 保留轮次 = 总轮次', plan.covered.length + plan.kept.length === 40, `covered=${plan.covered.length} kept=${plan.kept.length}`)
    check('边界指向被覆盖的最后一轮回答', plan.throughMessageId === plan.covered.at(-1)[1].id)
    check('压缩后估算回落到目标线以下', estimateHistoryTokens(plan.kept.flat(), { summary: 'x'.repeat(2000) }) < 128000 * 0.5)
    const prompt = buildSummaryPrompt(plan.covered, undefined)
    check('摘要输入包含轮次内容', prompt.includes('第 1 轮') && prompt.length > 100)
  }
}
// 增量压缩：已经压过的不重复进 covered
{
  const history = buildHistory(40, 8000)
  const first = planCompaction({ history, compaction: undefined, model: 'deepseek-flash', allowRefused: false })
  const second = planCompaction({
    history,
    compaction: { summary: 's', throughMessageId: first.throughMessageId, tokens: 1, compactedAt: 1, count: 1 },
    model: 'deepseek-flash',
    allowRefused: false,
  })
  check('压缩后同一历史不再重复压缩', second === null)
}
// 压缩后继续追加轮次，会再次触发且只覆盖新增部分
{
  const base = buildHistory(40, 8000)
  const first = planCompaction({ history: base, compaction: undefined, model: 'deepseek-flash', allowRefused: false })
  const more = [
    ...base,
    ...buildHistory(20, 8000).map((m, i) => ({ ...m, id: `${m.id}-x${i}` })),
  ]
  // 修正 id，保证唯一且顺序正确
  const seen = new Set()
  for (const m of more) {
    while (seen.has(m.id)) m.id = `${m.id}_`
    seen.add(m.id)
  }
  const second = planCompaction({
    history: more,
    compaction: { summary: 's', throughMessageId: first.throughMessageId, tokens: 1, compactedAt: 1, count: 1 },
    model: 'deepseek-flash',
    allowRefused: false,
  })
  check('追加足够内容后再次触发压缩', second !== null)
  if (second) {
    const firstIds = new Set(first.covered.map(([, r]) => r.id))
    check('二次压缩不重复覆盖已压缩轮次', !second.covered.some(([, r]) => firstIds.has(r.id)))
  }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
