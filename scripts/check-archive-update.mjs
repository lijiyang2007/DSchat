// 归档 / 上下文入口 / 更新防重复下载 的功能检查
// 运行：node scripts/check-archive-update.mjs
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const types = read('src/services/chat/types.ts')
const store = read('src/services/chat/store.ts')
const db = read('src/services/chat/db.ts')
const sider = read('src/components/sider/Sider.tsx')
const item = read('src/components/sider/SessionItem.tsx')
const panel = read('src/components/sider/ArchivePanel.tsx')
const usage = read('src/components/settings/ContextUsage.tsx')
const updater = read('src/services/updater.ts')
const updateModal = read('src/components/settings/UpdateModal.tsx')
const mainActivity = read('android/app/src/main/java/com/dschat/app/MainActivity.java')
const zh = read('src/i18n/zh.ts')
const en = read('src/i18n/en.ts')

let failures = 0
const check = (name, ok, detail = '') => {
  if (ok) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name} ${detail}`)
  }
}

console.log('一、归档：数据层')
check('Session 有 archived 字段', /archived\?: boolean/.test(types))
check('Session 有 archivedAt 字段', /archivedAt\?: number/.test(types))
check('SessionSummary 也带归档字段', /SessionSummary = Pick<[\s\S]{0,260}archived\?: boolean/.test(types))
check('toSessionSummary 保留归档标记', /archived \? \{ archived: true \}/.test(types))
check('db 支持写归档元数据', /updateSessionMeta[\s\S]{0,200}archived\?: boolean/.test(db))
check('sameSummary 比较归档状态', /sameSummary[\s\S]{0,320}Boolean\(a\.archived\) === Boolean\(b\.archived\)/.test(store))
check('有 setSessionArchived', /export const setSessionArchived/.test(store))
check('归档时取消置顶', /archived \? \{ pinned: false \}/.test(store))
check('恢复时清掉 archivedAt', /archivedAt = archived \? Date\.now\(\) : 0/.test(store))
check('归档当前会话时退回欢迎页', /archived && state\.activeId === id \? \{ activeId: null \}/.test(store))

console.log('\n二、归档：界面')
check('侧边栏过滤掉归档会话', /allSessions\.filter\(\(session\) => !session\.archived\)/.test(sider))
check('侧边栏统计归档数量', /session\.archived \? count \+ 1 : count/.test(sider))
check('有归档入口按钮', sider.includes('archiveEntry') && sider.includes("t('archiveEntryLabel')"))
check('入口显示数量', sider.includes('archivedCount'))
check('有归档面板组件', panel.includes('export const ArchivePanel'))
check('面板列出归档会话', /filter\(\(session\) => session\.archived\)/.test(panel))
check('面板按归档时间倒序', /b\.archivedAt[\s\S]{0,40}- \(a\.archivedAt/.test(panel))
check('面板可移回历史', panel.includes('onUnarchive={() => setSessionArchived(session.id, false)}'))
check('空归档有提示', panel.includes('archivePanelEmpty'))

console.log('\n三、会话菜单：顺序与归档')
const menuBlock = item.slice(item.indexOf('options={['), item.indexOf(']}\n        >'))
const usageIdx = menuBlock.indexOf("key: 'usage'")
const pinIdx = menuBlock.indexOf("key: 'pin'")
const renameIdx = menuBlock.indexOf("key: 'rename'")
const archiveIdx = menuBlock.indexOf("key: 'archive'")
const deleteIdx = menuBlock.indexOf("key: 'delete'")
check('有上下文用量项', usageIdx > -1)
check('上下文用量排第一', usageIdx < pinIdx && pinIdx > -1, `usage=${usageIdx} pin=${pinIdx}`)
check('顺序：用量→置顶→重命名→归档→删除', usageIdx < pinIdx && pinIdx < renameIdx && renameIdx < archiveIdx && archiveIdx < deleteIdx)
check('归档页显示「移回对话历史」', item.includes('onUnarchive') && item.includes('sessionItemMenuUnarchiveOption'))
check('归档项调 setSessionArchived(true)', /setSessionArchived\(session\.id, true\)/.test(item))

console.log('\n四、上下文用量弹窗')
check('抽成独立组件', usage.includes('export const ContextUsage'))
check('支持指定会话 id', /sessionId\?/.test(usage) && /targetId = sessionId \?\? activeId/.test(usage))
check('用服务端真实 usage', usage.includes('contextUsageDetail'))
check('弹窗从菜单打开', /setUsageOpen\(true\)/.test(item) && item.includes('ContextUsage sessionId={session.id}'))
check(
  '设置页复用同一组件',
  // v2.8.8 起设置页传 actions 以显示「立即压缩 / 清除摘要」按钮
  /<ContextUsage(\s+actions)?\s*\/>/.test(read('src/components/settings/SettingsDialog.tsx'))
)
check('样式独立成文件', read('src/components/settings/ContextUsage.module.css').includes('.fill_high'))

console.log('\n五、更新：不再重复下载')
check('原生会认回已下好的包', mainActivity.includes('restoreDownloadedApkIfNeeded'))
check('已存在直接装不重下', /finalFile\.exists\(\) && finalFile\.length\(\) > 1024 \* 1024/.test(mainActivity))
check('有 installDownloadedApk 桥接', mainActivity.includes('public boolean installDownloadedApk()'))
check('有 discardDownloadedApk 桥接', mainActivity.includes('public void discardDownloadedApk()'))
check('状态回报包名', mainActivity.includes('\\"apkName\\"'))
check('前端有 installDownloadedApk', /export const installDownloadedApk/.test(updater))
check('前端有 discardDownloadedApk', /export const discardDownloadedApk/.test(updater))
check('安装前先判断已下载', /installDownloadedApk[\s\S]{0,300}hasDownloadedFile/.test(updater))
check('弹窗显示已下载提示', updateModal.includes('updateDownloadedReady'))
check('弹窗提供直接安装', updateModal.includes("t('updateActionInstallDownloaded')"))

console.log('\n六、更新：快慢稳定（三路竞速 + 合法结果校验）')
check('不再串行 for 循环', !updater.includes('fetchFirstAvailable'))
check('改为并发竞速', /export const fetchFastest|const fetchFastest/.test(updater))
check('同时发起所有候选', /for \(const url of urls\)[\s\S]{0,200}void run\(url\)/.test(updater))
check('竞速三路来源（直连/jsDelivr/raw）', /'github-direct', 'jsdelivr', \.\.\.API_MIRRORS/.test(updater))
check('竞速只收合法结果', /fetchFastest<ReleaseInfo>/.test(updater))
check('raw 探针严格校验 name', /payload\.name !== 'dschat'/.test(updater))

console.log('\n七、更新：断点续传与镜像顺序')
check('原生支持 Range 续传', mainActivity.includes('setRequestProperty("Range"'))
check('续传时以追加方式写', mainActivity.includes('new FileOutputStream(tempFile, resumed)'))
check('镜像优先于直连', /candidates\.add\(apkUrl\)[\s\S]{0,80}$/.test(mainActivity.split('List<String> candidates')[1]?.slice(0, 900) ?? '') || mainActivity.indexOf('candidates.add(mirror)') < mainActivity.indexOf('candidates.add(apkUrl)'))
check('连接超时缩短', mainActivity.includes('setConnectTimeout(6000)'))
check('取消时保留 .part', /保留 \.part/.test(mainActivity))

console.log('\n八、i18n 双语齐备')
const zhKeys = [...zh.matchAll(/^  (\w+):/gm)].map((m) => m[1])
const enKeys = [...en.matchAll(/^  (\w+):/gm)].map((m) => m[1])
check('中文无重复键', new Set(zhKeys).size === zhKeys.length)
check('英文无重复键', new Set(enKeys).size === enKeys.length)
check('中英键集合一致', [...zhKeys].sort().join(',') === [...enKeys].sort().join(','), `${zhKeys.length} vs ${enKeys.length}`)
const need = [
  'sessionItemMenuContextUsage',
  'sessionItemMenuArchiveOption',
  'sessionItemMenuUnarchiveOption',
  'archiveEntryLabel',
  'archivePanelTitle',
  'archivePanelHint',
  'archivePanelEmpty',
  'updateActionInstallDownloaded',
  'updateActionRedownload',
  'updateDownloadedReady',
]
const missing = need.filter((k) => !zhKeys.includes(k))
check('新增键齐全', missing.length === 0, missing.join(','))

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
