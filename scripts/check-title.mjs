// 标题生成与置顶排序的纯逻辑检查
// 运行：node scripts/build-compaction-check.mjs 之后再跑本脚本
import { buildLocalTitle, resolveSessionTitle, firstUserMessage } from '../.tmp-check/title.mjs'
import { sortWithPinned, searchSessions } from '../.tmp-check/sessionSearch.mjs'

let failures = 0
const check = (name, condition, detail = '') => {
  if (condition) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name} ${detail}`)
  }
}

const user = (content, files = []) => ({
  id: 'u',
  role: 'user',
  content,
  files,
  createdAt: 1,
})

console.log('buildLocalTitle')
check('普通问句', buildLocalTitle(user('帮我写一个快速排序')) === '帮我写一个快速排序')
check(
  '取第一句',
  buildLocalTitle(user('什么是闭包？顺便解释一下作用域')) === '什么是闭包',
  buildLocalTitle(user('什么是闭包？顺便解释一下作用域'))
)
check(
  '超长截断',
  buildLocalTitle(user('a'.repeat(50))).length <= 31,
  String(buildLocalTitle(user('a'.repeat(50))).length)
)
check(
  '换行压成一行',
  buildLocalTitle(user('第一行\n第二行')) === '第一行 第二行',
  buildLocalTitle(user('第一行\n第二行'))
)
check('附件占位被剔除', buildLocalTitle(user('[图片] 看看这个')) === '看看这个', buildLocalTitle(user('[图片] 看看这个')))
check(
  '纯附件用文件名',
  buildLocalTitle(user('', [{ name: 'report.pdf' }])) === 'report.pdf'
)
check('空提问返回空串', buildLocalTitle(user('')) === '')

console.log('\nresolveSessionTitle')
const msgs = [user('你好呀，今天聊点什么')]
check('已有标题不覆盖', resolveSessionTitle(msgs, '服务端标题') === '服务端标题')
check('空标题用首条提问', resolveSessionTitle(msgs, '') === '你好呀，今天聊点什么')
check('无消息时保持空', resolveSessionTitle([], '') === '')
check('firstUserMessage 找到提问', firstUserMessage(msgs)?.content === '你好呀，今天聊点什么')

console.log('\nsortWithPinned')
const list = [
  { id: 'a', pinned: false },
  { id: 'b', pinned: true },
  { id: 'c', pinned: false },
]
check('置顶排到最前', sortWithPinned(list).map((x) => x.id).join(',') === 'b,a,c')
check('没有置顶时原序返回', sortWithPinned([{ id: 'x' }, { id: 'y' }])[0].id === 'x')

console.log('\nsearchSessions')
const sessions = [
  { id: '1', title: '快速排序实现', createdAt: 1, updatedAt: 2 },
  { id: '2', title: '别的对话', createdAt: 1, updatedAt: 1 },
]
const contentOf = async (id) => (id === '2' ? '这里提到了快速排序的复杂度' : null)
const hits = await searchSessions(sessions, '快速排序', contentOf)
check('标题命中优先', hits[0]?.session.id === '1')
check('正文也能命中', hits.some((h) => h.session.id === '2'))
check('正文命中带片段', hits.find((h) => h.session.id === '2')?.snippet.includes('快速排序'))
check('空关键词无结果', (await searchSessions(sessions, '   ', contentOf)).length === 0)
check('无匹配返回空', (await searchSessions(sessions, 'zzzz', contentOf)).length === 0)

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
