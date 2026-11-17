// v2.6.0 新增逻辑检查：随机欢迎语 + 会话目录排序
// 运行：node scripts/build-checks.mjs && node scripts/check-welcome-sort.mjs
import { WELCOME_GREETING_KEYS, pickWelcomeGreeting } from '../.tmp-check/welcome.mjs'
import { sortSessions } from '../.tmp-check/sessionSort.mjs'

let failures = 0
const check = (name, condition, detail = '') => {
  if (condition) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name} ${detail}`)
  }
}

console.log('随机欢迎语')
check('候选不少于 6 条', WELCOME_GREETING_KEYS.length >= 6, String(WELCOME_GREETING_KEYS.length))
check(
  '候选不重复',
  new Set(WELCOME_GREETING_KEYS).size === WELCOME_GREETING_KEYS.length
)
check('random=0 命中第一条', pickWelcomeGreeting(() => 0) === WELCOME_GREETING_KEYS[0])
check(
  'random≈1 命中最后一条',
  pickWelcomeGreeting(() => 0.999999) === WELCOME_GREETING_KEYS.at(-1)
)
check('random=1 不越界', WELCOME_GREETING_KEYS.includes(pickWelcomeGreeting(() => 1)))
check('random 返回 NaN 时兜底第一条', pickWelcomeGreeting(() => Number.NaN) === WELCOME_GREETING_KEYS[0])

// 统计分布：足够多次抽样应覆盖全部候选
const seen = new Set()
for (let i = 0; i < 2000; i += 1) {
  seen.add(pickWelcomeGreeting())
}
check('多次抽样覆盖全部候选', seen.size === WELCOME_GREETING_KEYS.length, String(seen.size))

console.log('\n会话目录排序')
const mk = (id, title, updatedAt, createdAt, pinned = false) => ({
  id,
  title,
  updatedAt,
  createdAt,
  ...(pinned ? { pinned: true } : {}),
})

const sessions = [
  mk('a', '丙对话', 300, 100),
  mk('b', '甲对话', 100, 300),
  mk('c', '乙对话', 200, 200),
  mk('p', '置顶对话', 50, 50, true),
]

const byUpdated = sortSessions(sessions, 'updatedAt').map((s) => s.id)
check('按更新：置顶最前', byUpdated[0] === 'p', byUpdated.join(','))
check('按更新：其余按 updatedAt 降序', byUpdated.slice(1).join(',') === 'a,c,b', byUpdated.join(','))

const byCreated = sortSessions(sessions, 'createdAt').map((s) => s.id)
check('按创建：其余按 createdAt 降序', byCreated.slice(1).join(',') === 'b,c,a', byCreated.join(','))

const byTitle = sortSessions(sessions, 'title').map((s) => s.id)
// 拼音序：丙(bing) < 甲(jia) < 乙(yi)
check('按标题：拼音升序', byTitle.slice(1).join(',') === 'a,b,c', byTitle.join(','))

check('空列表安全', sortSessions([], 'updatedAt').length === 0)
check(
  '不修改原数组',
  (() => {
    const input = [mk('x', 'b', 1, 1), mk('y', 'a', 2, 2)]
    const copy = input.map((s) => s.id).join(',')
    sortSessions(input, 'title')
    return input.map((s) => s.id).join(',') === copy
  })()
)
check(
  '全部置顶时保持组内排序',
  sortSessions([mk('1', 'a', 10, 10, true), mk('2', 'b', 20, 20, true)], 'updatedAt')
    .map((s) => s.id)
    .join(',') === '2,1'
)

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
