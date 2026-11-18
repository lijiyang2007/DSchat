/**
 * 导入不丢对话 + 压缩弹窗/卡顿优化检查（v2.9.1）。
 *
 * 用户报的两个问题：
 * 1. 「导入不保留以前对话」——v2.8.7 号称改成了追加，但 `commitStaging` 的 merge 分支
 *    对同 ID 会话直接 `put`：**导入自己的备份包时，包里那份旧版本会把本机正在用的会话整条换掉**。
 *    实测（APK 内的真实 JS）：本机 3 条，导入一个含同 ID 的包后，本机那条变成了包里的旧内容。
 * 2. 「压缩之后短期很卡」——三处固定开销：
 *    a. 流式输出期间窗口化被关掉（`!streaming`），长会话生成时几千条消息全挂回 DOM；
 *    b. 上下文用量面板每次渲染都重算整段历史 token（压缩中状态会触发反复重渲染）；
 *    c. `getVisibleMessages` / `estimateMessageHeight` / 单条消息 token 估算都没有缓存。
 *    另外用户要求压缩时必须弹「压缩中请不要关闭」的弹窗，并说明卡顿是正常现象。
 *
 * 运行：node scripts/check-import-preserve.mjs
 */
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

let failed = 0
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok   ${label}`)
  else {
    failed += 1
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const db = read('src/services/chat/db.ts')
const store = read('src/services/chat/store.ts')
const branches = read('src/services/chat/branches.ts')
const compaction = read('src/services/chat/compaction.ts')
const windowing = read('src/components/messages/useMessageWindowing.ts')
const messageList = read('src/components/messages/MessageList.tsx')
const usagePanel = read('src/components/settings/ContextUsage.tsx')
const promptTsx = read('src/components/messages/CompactionPrompt.tsx')
const promptCss = read('src/components/messages/CompactionPrompt.module.css')
const promptDts = read('src/components/messages/CompactionPrompt.module.css.d.ts')
const promptState = read('src/components/messages/compactionPromptState.ts')
const app = read('src/app/App.tsx')
const zh = read('src/i18n/zh.ts')
const en = read('src/i18n/en.ts')

console.log('\n一、导入不再覆盖本机会话（核心）')
check(
  'merge 分支先读全量已有记录建索引',
  /mode === 'merge'[\s\S]{0,400}target\.getAll\(\)/.test(db)
)
check(
  'ID 冲突且内容不同 → 给导入的这份换新 ID，绝不覆盖本机',
  /if \(knownIds\.has\(id\)\)[\s\S]{0,160}reId\(incoming\)/.test(db)
)
check(
  '换 ID 时记下包里的原始 ID（sourceId），便于排查来源',
  /id: createId\(\), sourceId: session\.id/.test(db)
)
check(
  '附件原件也走同 ID 保护（不覆盖本机已有的图）',
  /else if \(knownIds\.has\(id\)\)/.test(db)
)
check(
  '重复导入同一个包按内容指纹去重，不产生重复副本',
  /knownFp\.has\(fingerprint\(incoming\)\)[\s\S]{0,120}continue/.test(db)
)
check('clear 仍然只在 replace 分支里', /if \(mode === 'replace'\) \{[\s\S]{0,200}await target\.clear\(\)/.test(db))
check('清空历史的语义没被破坏', /replaceHistory\(async \(\) => \{\}, 'replace'\)/.test(read('src/services/chat/backup.ts')))
check('merge 仍是导入的默认模式', /mode: 'merge' \| 'replace' = 'merge'/.test(db))

console.log('\n二、压缩时弹「请不要关闭」弹窗（自动 + 手动）')
check('有独立的压缩提示组件', /export const CompactionPrompt/.test(promptTsx))
check('弹窗挂在应用根部（自动压缩时用户可能不在设置页）', /<CompactionPrompt \/>/.test(app))
check('自动压缩会打开弹窗', /beginCompactionPrompt\('auto'\)/.test(store))
check('手动压缩也会打开弹窗', /beginCompactionPrompt\('manual'\)/.test(store))
check('两条路径都在 finally 里关闭弹窗', (store.match(/endCompactionPrompt\(\)/g) ?? []).length === 2)
check('计数式开关，避免并发压缩时互相关掉', /active: state\.active \+ 1/.test(promptState) && /Math\.max\(0, state\.active - 1\)/.test(promptState))
check('弹窗不提供关闭（压缩中途关掉会让人以为没生效）', /onClose=\{\(\) => \{\}\}/.test(promptTsx))
check('弹窗锁住页面滚动', /document\.body\.style\.overflow = 'hidden'/.test(promptTsx))
check('css 与类型声明齐全', /\.modal \{/.test(promptCss) && /readonly modal/.test(promptDts))
check('尊重「减少动画」偏好', /prefers-reduced-motion/.test(promptCss))

console.log('\n三、弹窗文案：不要关 + 卡顿正常 + 本地记录不丢')
check('zh 说明压缩中不要关闭', /压缩中，请不要关闭 App 或退出当前对话/.test(zh))
check('zh 说明卡顿属于正常现象', /压缩时和压缩结束后的一小段时间里界面可能有点卡，属于正常现象/.test(zh))
check('zh 说明本地记录不会删', /本机聊天记录一条都不会删/.test(zh))
check('en 说明不要关闭', /please do not close the app or leave this chat/.test(en))
check('en 说明卡顿正常', /The UI may feel sluggish during and right after compaction/.test(en))
check('en 说明本地记录不删', /Your local history is never deleted/.test(en))
check('中英文案键齐全且同名', ['compactionPromptTitleAuto', 'compactionPromptTitleManual', 'compactionPromptKeepOpen', 'compactionPromptLagHint', 'compactionPromptSafeHint'].every((key) => zh.includes(`${key}:`) && en.includes(`${key}:`)))

console.log('\n四、压缩后卡顿优化')
check(
  '流式输出期间也窗口化（长对话生成不再整列挂 DOM）',
  /const windowed = messages\.length > WINDOWING_THRESHOLD\s*$/m.test(messageList) &&
    !/WINDOWING_THRESHOLD && !streaming/.test(messageList)
)
check('生成中把末尾消息钉在窗口里', /pinTail: streaming/.test(messageList))
check('pinTail 让 end 覆盖到列表末尾', /if \(pinTail\) \{[\s\S]{0,200}end = count/.test(windowing))
check('可见分支按会话对象缓存', /const visibleCache = new WeakMap<Session, Message\[\]>\(\)/.test(branches))
check('缓存命中直接返回', /const cached = visibleCache\.get\(session\)[\s\S]{0,80}return cached/.test(branches))
check('消息高度估算按消息对象缓存', /const heightCache = new WeakMap<Message, number>\(\)/.test(windowing))
check('单条消息 token 估算按消息对象缓存', /const tokenCache = new WeakMap<Message, number>\(\)/.test(compaction))
check('estimateHistoryTokens 走缓存版', /messageTokensCached\(user\) \+ messageTokensCached\(reply\)/.test(compaction))
check('压缩计划的配对 token 也走缓存版', /messageTokensCached\(user\) \+ messageTokensCached\(reply\)/.test(compaction))
check('用量面板的 token 计算改成 useMemo', /const usage = useMemo\(/.test(usagePanel))
check('可压缩轮次统计也改成 useMemo', /const stats = useMemo\(/.test(usagePanel))

console.log(failed === 0 ? '\n全部通过\n' : `\n${failed} 项失败\n`)
process.exit(failed === 0 ? 0 : 1)
