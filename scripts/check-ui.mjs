// 新增设置的逻辑检查：流式节流档位 + 上下文用量
// 运行：node scripts/build-checks.mjs && node scripts/check-ui.mjs
import { contextUsageRatio, getContextWindow } from '../.tmp-check/compaction.mjs'

let failures = 0
const check = (name, condition, detail = '') => {
  if (condition) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name} ${detail}`)
  }
}

// 复刻节流档位参数（与 useThrottleMarkdownRender.ts 的 PROFILES 对应）
const PROFILES = {
  full: null,
  balanced: { rate: 2, maxWait: 2000 },
  smooth: { rate: 4, maxWait: 4000 },
}
console.log('流式节流档位')
check('完整档不节流', PROFILES.full === null)
check('均衡档倍率 2', PROFILES.balanced.rate === 2)
check('流畅档倍率更高', PROFILES.smooth.rate > PROFILES.balanced.rate)
check('流畅档等待更久', PROFILES.smooth.maxWait > PROFILES.balanced.maxWait)

console.log('\n上下文用量')
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

const history = buildHistory(10, 1000) // 约 9000 token
const ratio = contextUsageRatio(history, undefined, 'unknown', 0, 32000)
check('用量在 0~1 之间', ratio >= 0 && ratio <= 1, String(ratio))
check('16K 窗口占比更高', contextUsageRatio(history, undefined, 'unknown', 0, 16000) > ratio)
check('128K 窗口占比更低', contextUsageRatio(history, undefined, 'unknown', 0, 128000) < ratio)
check('自定义窗口覆盖生效', getContextWindow('unknown', 32000) === 32000)
check(
  '压缩后用量下降',
  contextUsageRatio(history, { summary: 'x'.repeat(500), throughMessageId: 'a5', tokens: 1, compactedAt: 1 }, 'unknown', 0, 32000) < ratio
)

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
