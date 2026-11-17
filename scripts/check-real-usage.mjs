// 上下文用量是否来自服务端真实数据
// 运行：node scripts/build-checks.mjs && node scripts/check-real-usage.mjs
import { actualContextTokens, contextUsageDetail, contextUsageRatio } from '../.tmp-check/compaction.mjs'

let failures = 0
const check = (name, ok, detail = '') => {
  if (ok) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name} ${detail}`)
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

const usage = (input, cached, output) => ({
  input_tokens: input,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: cached,
  output_tokens: output,
})

console.log('读取服务端真实 token')
check('没有 usage 时返回 null', actualContextTokens([mkUser('u1', 'hi')]) === null)
check('没有助手消息时返回 null', actualContextTokens([]) === null)

const withUsage = [mkUser('u1', '你好'), mkReply('a1', '回答', usage(9345, 3000, 678))]
check('累加输入+缓存+输出', actualContextTokens(withUsage) === 9345 + 3000 + 678, String(actualContextTokens(withUsage)))

const multi = [
  mkUser('u1', 'q1'),
  mkReply('a1', 'a1', usage(100, 0, 50)),
  mkUser('u2', 'q2'),
  mkReply('a2', 'a2', usage(900, 100, 80)),
]
check('取最近一轮而非累加历史', actualContextTokens(multi) === 900 + 100 + 80, String(actualContextTokens(multi)))

const zeroUsage = [mkUser('u1', 'q'), mkReply('a1', 'a', usage(0, 0, 0))]
check('全 0 的 usage 视为无记录', actualContextTokens(zeroUsage) === null)

console.log('\ncontextUsageDetail 优先真实值')
const detail = contextUsageDetail(withUsage, undefined, 'deepseek-flash', 0, 100000)
check('标记为非估算', detail.estimated === false)
check('token 数来自服务端', detail.tokens === 13023, String(detail.tokens))
check('比例按真实值算', Math.abs(detail.ratio - 13023 / 100000) < 1e-9, String(detail.ratio))

const estimated = contextUsageDetail(
  [mkUser('u1', 'x'.repeat(1000)), mkReply('a1', 'y'.repeat(1000))],
  undefined,
  'deepseek-flash',
  0,
  100000
)
check('无 usage 时标记为估算', estimated.estimated === true)
check('估算值为正', estimated.tokens > 0, String(estimated.tokens))

console.log('\n与旧估算路径的一致性')
const ratioOld = contextUsageRatio(withUsage, undefined, 'deepseek-flash', 0, 100000)
check('contextUsageRatio 仍可用（向后兼容）', ratioOld > 0 && ratioOld <= 1, String(ratioOld))
check('两个函数返回的都是合法比例', ratioOld >= 0 && ratioOld <= 1 && detail.ratio >= 0 && detail.ratio <= 1)

console.log('\n窗口大小影响')
check('窗口减半比例翻倍', contextUsageDetail(withUsage, undefined, 'deepseek-flash', 0, 50000).ratio > detail.ratio)
const smallWindow = contextUsageDetail(withUsage, undefined, 'deepseek-flash', 0, 4000)
check('小窗口比例仍在 0..1', smallWindow.ratio >= 0 && smallWindow.ratio <= 1, String(smallWindow.ratio))
check(
  '窗口越小比例越高',
  smallWindow.ratio > detail.ratio,
  `${smallWindow.ratio} vs ${detail.ratio}`
)

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
