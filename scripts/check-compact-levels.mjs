/**
 * 压缩档位滑块检查（v2.8.9）。
 *
 * 需求：滑块四档 20/40/60/80%，标注「极省 / 经济(推荐) / 较长记忆(推荐) / 超长记忆」，
 * 并向用户说明记忆能力 vs 省钱模式的优缺点。
 *
 * 运行：node scripts/build-checks.mjs && node scripts/check-compact-levels.mjs
 */
import { readFileSync } from 'node:fs'
import {
  COMPACT_LEVELS,
  DEFAULT_COMPACT_LEVEL,
  compactLevelMeta,
  isCompactLevel,
  planCompaction,
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

const compaction = read('src/services/chat/compaction.ts')
const settings = read('src/services/settings.ts')
const dialog = read('src/components/settings/SettingsDialog.tsx')
const usage = read('src/components/settings/ContextUsage.tsx')
const store = read('src/services/chat/store.ts')
const zh = read('src/i18n/zh.ts')
const en = read('src/i18n/en.ts')

console.log('\n一、四档定义')
check('有 COMPACT_LEVELS', Array.isArray(COMPACT_LEVELS))
check('正好四档', COMPACT_LEVELS.length === 4, String(COMPACT_LEVELS.length))
check(
  '档位顺序：极省 → 经济 → 较长记忆 → 超长记忆',
  COMPACT_LEVELS.map((l) => l.level).join(',') === 'frugal,economy,balanced,marathon',
  COMPACT_LEVELS.map((l) => l.level).join(',')
)
check(
  '触发比例是 20/40/60/80%',
  COMPACT_LEVELS.map((l) => l.ratio).join(',') === '0.2,0.4,0.6,0.8',
  COMPACT_LEVELS.map((l) => l.ratio).join(',')
)
check(
  '档位越高保留轮数越多',
  COMPACT_LEVELS.every((l, i) => i === 0 || l.keepRounds >= COMPACT_LEVELS[i - 1].keepRounds),
  COMPACT_LEVELS.map((l) => l.keepRounds).join(',')
)
check('默认档是经济档', DEFAULT_COMPACT_LEVEL === 'economy')
check('isCompactLevel 认四个合法值', ['frugal', 'economy', 'balanced', 'marathon'].every(isCompactLevel))
check('isCompactLevel 拒绝非法值', !isCompactLevel('turbo') && !isCompactLevel(null) && !isCompactLevel(undefined))
check('compactLevelMeta 未知值退回默认档', compactLevelMeta('turbo').level === 'economy')

console.log('\n二、触发点真的跟着档位走（用真实 planCompaction 跑）')
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
// 每轮约 400 字符 ≈ 182 token；做 40 轮 ≈ 14500 token
const buildHistory = (rounds, chars = 400) => {
  const out = []
  for (let i = 0; i < rounds; i += 1) {
    out.push(user(`u${i}`, `问题 ${i} ` + 'x'.repeat(chars)))
    out.push(reply(`a${i}`, `回答 ${i} ` + 'y'.repeat(chars)))
  }
  return out
}
const history = buildHistory(40)
// 窗口设 20000：40 轮 ≈ 14500 token = 72%，落在 20%/40%/60% 之上、80% 之下
const planAt = (level, win = 20000) => {
  const meta = compactLevelMeta(level)
  return planCompaction({
    history,
    compaction: undefined,
    model: 'test-model',
    allowRefused: false,
    contextWindow: win,
    triggerRatio: meta.ratio,
    keepRounds: meta.keepRounds,
  })
}
check('极省档（20%）在 72% 用量时触发', planAt('frugal') !== null)
check('经济档（40%）也触发', planAt('economy') !== null)
check('较长记忆档（60%）也触发', planAt('balanced') !== null)
check('超长记忆档（80%）此时不触发', planAt('marathon') === null)

// 用量较低时（约 25%），只有极省档触发。
// 6 轮 × 每轮 2 条 × 800 字符 ≈ 4363 token，窗口 20000 → 约 22%
const small = buildHistory(6, 800)
const planSmallAt = (level) => {
  const meta = compactLevelMeta(level)
  return planCompaction({
    history: small,
    compaction: undefined,
    model: 'test-model',
    allowRefused: false,
    contextWindow: 20000,
    triggerRatio: meta.ratio,
    keepRounds: meta.keepRounds,
  })
}
check('约 22% 用量时极省档能触发', planSmallAt('frugal') !== null)
check('约 22% 用量时经济档不触发', planSmallAt('economy') === null)
check('低用量时超长记忆档不触发', planSmallAt('marathon') === null)

console.log('\n三、压缩后保留轮数跟着档位走')
const coveredCount = (level) => {
  const plan = planAt(level)
  return plan ? plan.kept.length : 0
}
check(
  '档位越高保留越多（极省 ≤ 经济 ≤ 较长记忆）',
  coveredCount('frugal') <= coveredCount('economy') &&
    coveredCount('economy') <= coveredCount('balanced'),
  `${coveredCount('frugal')}/${coveredCount('economy')}/${coveredCount('balanced')}`
)
check('极省档至少保留 2 轮', coveredCount('frugal') >= 2, String(coveredCount('frugal')))

console.log('\n四、设置层')
check('Settings 有 compactLevel 字段', /compactLevel: CompactLevel/.test(settings))
check('有持久化键', /compactLevel: 'chat-demo:compact-level'/.test(settings))
check('启动时读取并校验', /isCompactLevel\(saved\) \? saved : DEFAULT_COMPACT_LEVEL/.test(settings))
check('有 setCompactLevel', /export const setCompactLevel/.test(settings))
check('setCompactLevel 写入前校验', /isCompactLevel\(compactLevel\) \? compactLevel : DEFAULT_COMPACT_LEVEL/.test(settings))
check('恢复默认值时一并重置档位', /setCompactLevel\(DEFAULT_COMPACT_LEVEL\)/.test(settings))
check('store 把档位传给 planCompaction', /compactLevelMeta\(settings\.compactLevel\)/.test(store))
check('store 传 triggerRatio', /triggerRatio: levelMeta\.ratio/.test(store))
check('store 传 keepRounds', /keepRounds: levelMeta\.keepRounds/.test(store))

console.log('\n五、界面')
check('有滑块 input[type=range]', /type="range"/.test(dialog))
check('滑块范围是四档', /max=\{COMPACT_LEVELS\.length - 1\}/.test(dialog))
check('滑块改档位', /setCompactLevel\(COMPACT_LEVELS\[Number\(event\.target\.value\)\]/.test(dialog))
check('四档都有可点按钮', /COMPACT_LEVELS\.map\(\(item, index\) =>/.test(dialog))
check('显示每档百分比', /Math\.round\(item\.ratio \* 100\)/.test(dialog))
check('显示优点', /COMPACT_LEVEL_PRO\[levelMeta\.level\]/.test(dialog))
check('显示缺点', /COMPACT_LEVEL_CON\[levelMeta\.level\]/.test(dialog))
check('显示当前档位说明', /settingsCompactLevelFootnote/.test(dialog))
check('关掉自动压缩时滑块禁用', /disabled=\{!autoCompact\}/.test(dialog))
check('进度条阈值刻度跟档位走', /left: `\$\{Math\.round\(levelMeta\.ratio \* 100\)\}%`/.test(usage))
check('用量颜色也跟档位走', /detail\.ratio >= levelMeta\.ratio/.test(usage))
check('主动压缩保留轮数跟档位', /keepRounds: levelMeta\.keepRounds/.test(usage))

console.log('\n六、文案：四档名称与优缺点齐全')
const zhKeys = [...zh.matchAll(/^  (\w+):/gm)].map((m) => m[1])
const enKeys = [...en.matchAll(/^  (\w+):/gm)].map((m) => m[1])
check('中英键集合一致', [...zhKeys].sort().join(',') === [...enKeys].sort().join(','))
check('中文无重复键', new Set(zhKeys).size === zhKeys.length)
check('英文无重复键', new Set(enKeys).size === enKeys.length)
for (const key of [
  'settingsCompactLevelTitle',
  'settingsCompactLevelFrugal',
  'settingsCompactLevelEconomy',
  'settingsCompactLevelBalanced',
  'settingsCompactLevelMarathon',
  'settingsCompactLevelFrugalHeadline',
  'settingsCompactLevelEconomyHeadline',
  'settingsCompactLevelBalancedHeadline',
  'settingsCompactLevelMarathonHeadline',
  'settingsCompactLevelFrugalPro',
  'settingsCompactLevelFrugalCon',
  'settingsCompactLevelEconomyPro',
  'settingsCompactLevelEconomyCon',
  'settingsCompactLevelBalancedPro',
  'settingsCompactLevelBalancedCon',
  'settingsCompactLevelMarathonPro',
  'settingsCompactLevelMarathonCon',
  'settingsCompactLevelFootnote',
  'settingsCompactLevelThreshold',
]) {
  check(`${key} 中英都有`, zhKeys.includes(key) && enKeys.includes(key))
}
check('中文档位名符合要求', /settingsCompactLevelFrugal: '极省'/.test(zh) &&
  /settingsCompactLevelEconomy: '经济'/.test(zh) &&
  /settingsCompactLevelBalanced: '较长记忆'/.test(zh) &&
  /settingsCompactLevelMarathon: '超长记忆'/.test(zh))
check('中文说明提到省钱', /最省钱/.test(zh))
check('中文说明提到记忆', /只记得最近 2 轮原文/.test(zh))
check('中文脚注说明本地不删', /本地记录始终完整，不会删除任何消息/.test(zh))

console.log(failed === 0 ? '\n全部通过\n' : `\n${failed} 项失败\n`)
process.exit(failed === 0 ? 0 : 1)
