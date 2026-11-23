// 行为断言（非源码字符串检查）：直接加载真实的 buildMessageVersions 验证收敛性。
// 这是 Bug B（重复消息 id → 渲染期 setState 不收敛 → React #301 白屏）的回归测试。
// 运行：node --experimental-strip-types scripts/check-message-versions.mjs
import { buildMessageVersions } from '../src/services/chat/branches.ts'

let failures = 0
const check = (name, ok, detail = '') => {
  if (ok) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name} ${detail}`)
  }
}

/** 构造最小合法 Session：buildMessageVersions 只读 id / parentId / rootMessageId / messages */
const session = (messages, rootMessageId = undefined) => ({ messages, rootMessageId })

console.log('Bug B 回归：重复 id 会话必须收敛（否则渲染期 setState 永不停止 → 白屏）')
{
  // 同一 parent 下两个同 id 消息 + 一条正常消息
  const dup = session([
    { id: 'a', parentId: null },
    { id: 'a', parentId: null },
    { id: 'b', parentId: null },
  ])
  const first = buildMessageVersions(dup, new Map())
  const second = buildMessageVersions(dup, first)
  check('重复 id：连续两次调用返回同一个 Map 对象（收敛）', first === second)
  check('重复 id：Map 只含去重后的 id', [...first.keys()].join(',') === 'a,b', [...first.keys()].join(','))
  check('重复 id：组内 ids 不重复', first.get('a').ids.join(',') === 'a', first.get('a').ids.join(','))
}

console.log('\n干净会话仍正确复用与更新')
{
  const clean = session([{ id: 'x', parentId: null }, { id: 'y', parentId: 'x' }])
  const c1 = buildMessageVersions(clean, new Map())
  const c2 = buildMessageVersions(clean, c1)
  check('干净会话：第二次调用复用同一 Map', c1 === c2)
  // rootMessageId 未定义时按 message.id 分组：每条消息自成一组
  check('干净会话：ids/ index 正确', c1.get('y').ids.join(',') === 'y' && c1.get('y').index === 0)

  const changed = session([...clean.messages, { id: 'z', parentId: 'y' }])
  const c3 = buildMessageVersions(changed, c2)
  check('内容变化：返回新的 Map', c3 !== c2)
  check('内容变化：新消息有版本记录', c3.has('z'))
}

console.log('\n有分支（rootMessageId）的会话同样收敛')
{
  const branched = session(
    [
      { id: 'r', parentId: null },
      { id: 'c1', parentId: 'r' },
      { id: 'c1', parentId: 'r' }, // 重复的子消息 id
      { id: 'c2', parentId: 'r' },
    ],
    'r'
  )
  const b1 = buildMessageVersions(branched, new Map())
  const b2 = buildMessageVersions(branched, b1)
  check('分支会话：重复 id 也收敛', b1 === b2)
  // 有 rootMessageId 时按 parentId 分组：parent=r 下 c1 与 c2 是兄弟版本
  check('分支会话：版本对象按 parent 分组', b1.get('c1').ids.join(',') === 'c1,c2', b1.get('c1').ids.join(','))
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
