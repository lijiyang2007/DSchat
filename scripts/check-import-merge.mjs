/**
 * 导入合并检查（v2.8.7）。
 *
 * 需求：导入的内容排在会话列表最前面，但**不删除**其他会话。
 * 2.3.0~2.8.6 的导入是「覆盖」语义（replaceHistory 会 clear 正式存储）。
 *
 * 做法：
 * 1. commitStaging 不再 clear 正式存储，只把暂存并进去（同 ID 才覆盖）；
 * 2. 导入的会话打 importedAt，listTime() 取 max(updatedAt, importedAt) 参与排序/分组，
 *    原始 updatedAt 不动——用户继续聊之后自然回到真实时间线；
 * 3. 合并后重新读全部摘要一起排序，否则列表只剩新导入的那批。
 *
 * 运行：node scripts/build-checks.mjs && node scripts/check-import-merge.mjs
 */
import { readFileSync } from 'node:fs'
import { sortSessions } from '../.tmp-check/sessionSort.mjs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

let failed = 0
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok   ${label}`)
  else {
    failed += 1
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const types = read('src/services/chat/types.ts')
const db = read('src/services/chat/db.ts')
const store = read('src/services/chat/store.ts')
const backup = read('src/services/chat/backup.ts')
const importArchive = read('src/services/chat/history/importArchive.ts')
const sortState = read('src/components/sider/sessionSortState.ts')
const groups = read('src/services/chat/sessionGroups.ts')
const zh = read('src/i18n/zh.ts')
const en = read('src/i18n/en.ts')
const dialog = read('src/components/settings/SettingsDialog.tsx')

console.log('\n一、数据模型：importedAt 与 listTime')
check('Session 有 importedAt', /importedAt\?: number/.test(types))
check('SessionSummary 有 importedAt', /SessionSummary = Pick<[\s\S]{0,400}importedAt\?: number/.test(types))
check('有 listTime 工具函数', /export const listTime/.test(types))
check('listTime 取 updatedAt 与 importedAt 的较大值', /Math\.max\(session\.updatedAt, session\.importedAt \?\? 0\)/.test(types))
check('toSessionSummary 保留 importedAt', /importedAt \? \{ importedAt: session\.importedAt \}/.test(types))
check('sameSummary 比较 importedAt', /\(a\.importedAt \?\? 0\) === \(b\.importedAt \?\? 0\)/.test(store))

console.log('\n二、导入不再覆盖（核心需求）')
check('commitStaging 支持 merge / replace 两种模式', /mode: 'merge' \| 'replace' = 'merge'/.test(db))
check(
  'clear 只在 replace 分支里（导入走 merge 不会清库）',
  /if \(mode === 'replace'\) \{[\s\S]{0,300}await target\.clear\(\)/.test(db)
)
check('commitStaging 注释说明是合并', /并进\*\*正式存储/.test(db))
check('importHistory 走 merge 模式', /replaceHistory\(\(\) => importArchive\(file, onProgress, rootPrefix\), 'merge'\)/.test(backup))
check('clearHistory 仍走 replace 模式', /replaceHistory\(async \(\) => \{\}, 'replace'\)/.test(backup))
check('store 把 mode 传给 commitStaging', /db\.commitStaging\(mode\)/.test(store))
check('replaceHistory 支持 merge/replace 两种模式', /mode: 'merge' \| 'replace'/.test(store))
check(
  'merge 分支重新读全部摘要一起排序',
  /mode === 'merge'[\s\S]{0,700}db\.loadSessionSummaries\(\)[\s\S]{0,300}sortSessions\(merged\)/.test(store)
)
// merge 分支的代码段：从 `if (mode === 'merge')` 到它自己的 return 语句为止
const mergeBlock = store.slice(
  store.indexOf("if (mode === 'merge')"),
  store.indexOf('return summaries.length', store.indexOf("if (mode === 'merge')"))
)
check('merge 分支不调用 clearAllDrafts（保留原有草稿）', mergeBlock.length > 0 && !/clearAllDrafts\(\)/.test(mergeBlock))
check(
  'merge 分支保留当前打开的会话',
  /mode === 'merge'[\s\S]{0,1200}ensureSessionLoaded\(activeId\)/.test(store)
)

console.log('\n三、导入的会话排最前')
check('导入时打 importedAt 标记', /local\.session\.importedAt = importStartedAt/.test(importArchive))
check('同一次导入共用一个时间戳', /const importStartedAt = Date\.now\(\)/.test(importArchive))
check('侧边栏排序用 listTime', /listTime\(b\) - listTime\(a\)/.test(sortState))
check('store 内部排序用 listTime', /return listTime\(b\) - listTime\(a\)/.test(store))
check('日期分组用 listTime', /const time = listTime\(session\)/.test(groups))
check('分组标签按 listTime 的时间算', /monthKey\(time\)/.test(groups))

console.log('\n四、界面文案不再说覆盖')
check('zh 确认弹窗说明保留原有对话', /现有的对话全部保留、不会被删除/.test(zh))
check('zh 设置项说明追加到最前', /会追加到最前面，原有对话和附件都保留/.test(zh))
check('en 确认弹窗说明保留', /Your existing chats are all kept/.test(en))
check('en 设置项说明追加', /existing chats and attachments are kept/.test(en))
check('成功提示说明原有对话保留', /已导入 \{count\} 个对话，原有对话保留/.test(zh))
check('成功提示走 historyImportedKept', /key: 'historyImportedKept'/.test(dialog))
check('确认按钮不再是危险样式', !/variant="dangerOutlined"[\s\S]{0,120}historyImport\.confirm/.test(dialog))

console.log('\n五、排序行为（用真实 sortSessions 跑）')
const now = Date.now()
const old = (id, updatedAt) => ({ id, title: id, createdAt: updatedAt, updatedAt })
const imported = (id, updatedAt, importedAt) => ({ id, title: id, createdAt: updatedAt, updatedAt, importedAt })

// 场景：3 条旧会话 + 1 条刚导入的（原始时间是 3 个月前）
const sessions = [
  old('recent', now - 1000),
  imported('imported-old', now - 90 * 86400000, now),
  old('older', now - 10 * 86400000),
]
const sorted = sortSessions(sessions, 'updatedAt').map((s) => s.id)
check('导入的会话排第一', sorted[0] === 'imported-old', sorted.join(','))
check('原有会话全部保留', sorted.length === 3)
check('其余仍按时间倒序', sorted[1] === 'recent' && sorted[2] === 'older', sorted.join(','))

// 用户在导入的会话里继续聊：updatedAt 超过 importedAt 后回到正常时间线
const chatted = sessions.map((s) =>
  s.id === 'imported-old' ? { ...s, updatedAt: now + 5000 } : s
)
const sorted2 = sortSessions(chatted, 'updatedAt').map((s) => s.id)
check('继续聊之后仍在最前（updatedAt 更新）', sorted2[0] === 'imported-old', sorted2.join(','))

// 置顶仍然优先于导入
const pinned = sessions.map((s) => (s.id === 'older' ? { ...s, pinned: true } : s))
const sorted3 = sortSessions(pinned, 'updatedAt').map((s) => s.id)
check('置顶优先于导入排序', sorted3[0] === 'older', sorted3.join(','))

// 按标题排序时不受 importedAt 影响
const sorted4 = sortSessions(sessions, 'title').map((s) => s.id)
check('按标题排序仍按标题', sorted4.join(',') === [...sorted4].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')).join(','), sorted4.join(','))

// 没有 importedAt 的会话行为不变（向后兼容）
const legacy = [old('a', now - 5000), old('b', now - 1000)]
check('旧数据（无 importedAt）排序不变', sortSessions(legacy, 'updatedAt')[0].id === 'b')

console.log(failed === 0 ? '\n全部通过\n' : `\n${failed} 项失败\n`)
process.exit(failed === 0 ? 0 : 1)
