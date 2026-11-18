/**
 * 导出功能检查（v2.7.7）。
 *
 * 背景：「导出按钮不生效」的根因是 Android WebView 里 <a download> + blob: URL
 * 不会触发下载。修法是加原生桥接 saveExportedFile 落盘；同时补单会话导出。
 *
 * 纯读源码，随时可跑：node scripts/check-export.mjs
 */
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

let failed = 0
const check = (label, ok, detail = '') => {
  if (ok) {
    console.log(`  ok   ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const saveFile = read('src/services/saveFile.ts')
const backup = read('src/services/chat/backup.ts')
const settings = read('src/components/settings/SettingsDialog.tsx')
const java = read('android/app/src/main/java/com/dschat/app/MainActivity.java')

console.log('\n一、保存通道（Web + Android）')
check('saveBlob 封装统一保存', /export const saveBlob/.test(saveFile))
check(
  'Android 走原生桥接落盘，不用 blob URL',
  /bridge\?\.saveExportedFile/.test(saveFile) && /blobToBase64/.test(saveFile)
)
check(
  '浏览器仍走 <a download>',
  /link\.download/.test(saveFile) && /createObjectURL/.test(saveFile)
)

console.log('\n二、原生桥接')
check('Java 有 saveExportedFile', /public String saveExportedFile/.test(java))
check('用 MediaStore 写公共下载目录（Android 10+）', /MediaStore\.Downloads/.test(java))
check('文件名做了安全清理', /replaceAll/.test(java))

console.log('\n三、导出能力')
check('导出全部仍在', /export const exportHistory/.test(backup))
check('新增单会话导出', /export const exportSession/.test(backup))
check(
  '两种导出用同一格式（可延续会话）',
  /exportArchive\(/.test(backup) && (backup.match(/exportArchive\(/g) ?? []).length >= 2
)
check('单会话文件名带标题', /sessionFileName/.test(backup))
check('设置页挂了导出当前对话', /ExportCurrentSession/.test(settings))
check('设置页导出按钮用 saveBlob', /saveBlob\(name, blob\)/.test(settings))
check(
  '设置页不再直接 createObjectURL 下载',
  !/const url = URL\.createObjectURL\(blob\)/.test(settings)
)

console.log(failed === 0 ? '\n全部通过\n' : `\n${failed} 项失败\n`)
process.exit(failed === 0 ? 0 : 1)
