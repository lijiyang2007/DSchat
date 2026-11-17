// 更新镜像逻辑检查：直连 + 镜像候选、版本比较、更新包地址兜底
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

let failures = 0
const check = (name, condition, detail = '') => {
  if (condition) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name} ${detail}`)
  }
}

console.log('更新地址镜像')
check('声明了镜像列表', updater.includes('UPDATE_MIRRORS'))
check('镜像至少 2 个', (updater.match(/https:\/\/gh[^\s'"]+/g) ?? []).length >= 2)
check('withMirrors 先直连', /withMirrors[\s\S]{0,160}url,\s*\n\s*\.\.\.UPDATE_MIRRORS/.test(updater))
check('检查更新走候选列表', updater.includes('withMirrors(LATEST_RELEASE_API)'))
check('每次尝试单独限时', updater.includes('8000'))
check('下载安装包附带镜像', updater.includes('JSON.stringify(withMirrors(latest.apkUrl).slice(1))'))
check('浏览器兜底改走镜像', updater.includes('${UPDATE_MIRRORS[0]}${target}'))
check('桥接签名接受镜像参数', updater.includes('mirrorsJson?: string'))

console.log('\n原生下载镜像')
check('Java 侧接受 mirrorsJson', android.includes('String mirrorsJson'))
check('Java 侧解析镜像数组', android.includes('new JSONArray(mirrorsJson)'))
check('Java 侧逐个候选重试', android.includes('for (String candidate : candidates)'))
check('失败后清理临时文件', android.includes('tempFile.delete()'))
check('全部失败才报错', android.includes('updateError = lastError.isEmpty()'))

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
