// 模型能力配置（思考程度 / 上下文窗口 / 图片识别）的逻辑检查
// 运行：node scripts/build-checks.mjs && node scripts/check-capability.mjs
import { allowsVision } from '../.tmp-check/vision.mjs'
import { getContextWindow, planCompaction } from '../.tmp-check/compaction.mjs'

let failures = 0
const check = (name, condition, detail = '') => {
  if (condition) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name} ${detail}`)
  }
}

console.log('allowsVision')
check('显式 yes 生效', allowsVision('yes', 'some-model', 'openai') === true)
check('显式 no 生效', allowsVision('no', 'gpt-4o', 'openai') === false)
check('auto + gpt-4o 识别为多模态', allowsVision('auto', 'gpt-4o-mini', 'openai') === true)
check('auto + qwen-vl 识别', allowsVision('auto', 'qwen-vl-max', 'openai') === true)
check('auto + claude 识别', allowsVision('auto', 'claude-3-5-sonnet', 'openai') === true)
check(
  'auto + deepseek-chat 原生协议 → 不能看图',
  allowsVision('auto', 'deepseek-chat', 'deepseek') === false
)
check(
  'auto + deepseek-chat 走第三方 → 按可看处理',
  allowsVision('auto', 'deepseek-chat', 'openai') === true
)
check('空模型名保守处理', allowsVision('auto', '', 'openai') === false)
check('显式 no 优先于模型名', allowsVision('no', 'gpt-4o', 'openai') === false)

console.log('\ngetContextWindow')
check('内置表：deepseek', getContextWindow('deepseek-flash') === 128000)
check('用户覆盖优先', getContextWindow('deepseek-flash', 32000) === 32000)
check('覆盖值过小时忽略', getContextWindow('deepseek-flash', 100) === 128000)
check('覆盖值为 0 时忽略', getContextWindow('deepseek-flash', 0) === 128000)
check('未知模型保守默认', getContextWindow('unknown-model') === 64000)

console.log('\n压缩阈值随窗口变化')
const mkUser = (id, content) => ({ id, role: 'user', content, files: [], createdAt: 1 })
const mkReply = (id, text) => ({
  id,
  role: 'assistant',
  createdAt: 2,
  model: 'm',
  prefix: false,
  status: 'done',
  stopReason: 'end_turn',
  blocks: [{ type: 'text', text }],
})
const buildHistory = (rounds, chars) => {
  const m = []
  for (let i = 1; i <= rounds; i += 1) {
    m.push(mkUser(`u${i}`, 'q'.repeat(chars)))
    m.push(mkReply(`a${i}`, 'a'.repeat(chars)))
  }
  return m
}

// 每轮约 2000 字符 → 约 1800 token/轮
const history = buildHistory(10, 2000)
const small = planCompaction({
  history,
  compaction: undefined,
  model: 'unknown',
  allowRefused: false,
  contextWindow: 8000,
})
const big = planCompaction({
  history,
  compaction: undefined,
  model: 'unknown',
  allowRefused: false,
  contextWindow: 128000,
})
check('小窗口（8K）触发压缩', small !== null)
check('大窗口（128K）不触发', big === null)
if (small) {
  check('压缩后保留最近几轮', small.kept.length >= 2, String(small.kept.length))
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
