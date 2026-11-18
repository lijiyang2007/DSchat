// 更新链路检查：镜像分组、jsDelivr 兜底、只推最新版、取消下载
// 运行：node scripts/check-update-mirror.mjs
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const updater = readFileSync(path.join(root, 'src/services/updater.ts'), 'utf8')
const android = readFileSync(
  path.join(root, 'android/app/src/main/java/com/dschat/app/MainActivity.java'),
  'utf8'
)
const modal = readFileSync(path.join(root, 'src/components/settings/UpdateModal.tsx'), 'utf8')

let failures = 0
const check = (name, ok, detail = '') => {
  if (ok) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name} ${detail}`)
  }
}

console.log('镜像按用途分组（查 API 与下 APK 不是同一批）')
check('声明 API_MIRRORS', updater.includes('API_MIRRORS'))
check('声明 DOWNLOAD_MIRRORS', updater.includes('DOWNLOAD_MIRRORS'))
check('两组独立声明', /API_MIRRORS = \[[\s\S]*?\][\s\S]*?DOWNLOAD_MIRRORS = \[/.test(updater))
check('withMirrors 可指定镜像组', updater.includes('mirrors: readonly string[] = DOWNLOAD_MIRRORS'))
check('版本探针走 raw 镜像代理', updater.includes('raw:${m}') && updater.includes('RAW_PACKAGE_JSON'))
check('镜像优先、直连兜底', /\.\.\.mirrors\.map[\s\S]{0,40}url\]/.test(updater))

console.log('\njsDelivr 兜底（国内可直连，不依赖 GitHub）')
check('声明 JSDELIVR_API', updater.includes('JSDELIVR_API'))
check('data.jsdelivr.com 域名', updater.includes('data.jsdelivr.com'))
check('存在 fetchFromJsdelivr', updater.includes('fetchFromJsdelivr'))
check('按版本号取最高', updater.includes('compareVersions(a, b) > 0 ? a : b'))
check('兜底拼出 APK 地址', updater.includes('releases/download/'))
check('raw 探针严格校验 name', /payload\.name !== 'dschat'/.test(updater))
check('竞速三路来源（直连/jsDelivr/raw）', /'github-direct', 'jsdelivr', \.\.\.API_MIRRORS/.test(updater))
check('竞速只收合法结果', /fetchFastest<ReleaseInfo>/.test(updater))

console.log('\n只推最新一版')
check('存在 pickHighestRelease', updater.includes('pickHighestRelease'))
check('跳过草稿与预发布', updater.includes('obj.draft === true') && updater.includes('obj.prerelease === true'))
check('按版本号比较（pickNewestAbove，含降级过滤）', /pickNewestAbove/.test(updater))

console.log('\n取消下载（不再卡死页面）')
check('导出 cancelUpdateDownload', updater.includes('export const cancelUpdateDownload'))
check('取消时停止轮询', /cancelUpdateDownload[\s\S]{0,200}stopPollingDownload/.test(updater))
check('取消时复位状态', /cancelUpdateDownload[\s\S]{0,300}EMPTY_DOWNLOAD/.test(updater))
check('调用原生取消', updater.includes('cancelUpdateDownload?.()'))
check('Java 侧有取消方法', android.includes('public void cancelUpdateDownload()'))
check('Java 侧有取消标记', android.includes('updateCancelled'))
check('下载循环检查取消', /if \(updateCancelled\)/.test(android))
check('取消后状态回 idle', android.includes('updateStatus = "idle"'))

console.log('\n弹窗始终可关闭')
check('closable 不再依赖下载状态', /closable\s*\n?\s*className/.test(modal) || !modal.includes('closable={!downloading}'))
check('关闭按钮不再禁用', !/variant="outlined" size="m" disabled=\{downloading\} onClick=\{dismissUpdateModal\}/.test(modal))
check('下载中提供取消按钮', modal.includes('updateActionCancelDownload'))
check('取消按钮调 cancelUpdateDownload', modal.includes('onClick={cancelUpdateDownload}'))

console.log('\n原生下载镜像')
check('Java 侧接受 mirrorsJson', android.includes('String mirrorsJson'))
check('Java 侧解析镜像数组', android.includes('new JSONArray(mirrorsJson)'))
check('Java 侧逐个候选重试', android.includes('for (String candidate : candidates)'))

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
