/**
 * 版本双轨制检查（v2.7.7 起，用户 2026-11-18 定）。
 *
 * 规则：
 * - 两段版本号 = 正式版（稳定版），如 2.8
 * - 三段版本号 = 测试版，如 2.7.7 / 2.8.3 / 2.9.1
 * - 任何降级都拦：2.9.1 不能装 2.8，也不能装 2.8.3；只允许装严格更高的
 * - 补 0 比较：2.8 == 2.8.0，2.8 < 2.8.3 < 2.9 < 2.9.1
 * - 逢九进一（2.7.9→2.8.1）由发版人手动执行，这里只做判定
 *
 * 运行：node scripts/build-checks.mjs && node scripts/check-versioning.mjs
 *       （versioning.ts 是纯逻辑，需先打包成 .tmp-check/versioning.mjs）
 */
import { readFileSync } from 'node:fs'

let failed = 0
const check = (label, ok, detail = '') => {
  if (ok) {
    console.log(`  ok   ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

// 优先用打包产物做真实行为断言；没有则退化为源码结构检查
let V = null
try {
  V = await import('../.tmp-check/versioning.mjs')
} catch {
  // 没打包就只做源码检查
}

if (V) {
  console.log('\n一、版本解析与通道')
  check('2.8 解析为正式版', V.parseVersion('2.8')?.channel === 'release')
  check('v2.8 去 v 前缀', V.parseVersion('v2.8')?.channel === 'release')
  check('2.8.3 解析为测试版', V.parseVersion('2.8.3')?.channel === 'test')
  check('2.9.1 解析为测试版', V.parseVersion('2.9.1')?.channel === 'test')
  check('非法版本号返回 null', V.parseVersion('abc') === null)

  console.log('\n二、比较（补 0）')
  check('2.8 < 2.8.3', V.compareVersionNumbers('2.8', '2.8.3') < 0)
  check('2.8.3 < 2.9', V.compareVersionNumbers('2.8.3', '2.9') < 0)
  check('2.9 < 2.9.1', V.compareVersionNumbers('2.9', '2.9.1') < 0)
  check('2.8 == 2.8.0', V.compareVersionNumbers('2.8', '2.8.0') === 0)

  console.log('\n三、降级拦截（任何降级都拦）')
  check('2.9.1 → 2.8 是降级（拦）', V.canInstall('2.9.1', '2.8') === false)
  check('2.9.1 → 2.8.3 是降级（拦）', V.canInstall('2.9.1', '2.8.3') === false)
  check('2.9.1 → 2.9.1 是同版（拦）', V.canInstall('2.9.1', '2.9.1') === false)
  check('2.8.3 → 2.9.1 是升级（放行）', V.canInstall('2.8.3', '2.9.1') === true)
  check('2.8 → 2.8.3 是升级（放行）', V.canInstall('2.8', '2.8.3') === true)
  check('降级判定 kind=downgrade', V.evaluateInstall('2.9.1', '2.8').kind === 'downgrade')

  console.log('\n四、versionCode')
  check('2.8 → 2800', V.versionCodeOf('2.8') === 2800)
  check('2.8.3 → 2803', V.versionCodeOf('2.8.3') === 2803)
  check('2.7.7 → 2707', V.versionCodeOf('2.7.7') === 2707)

  console.log('\n五、候选过滤')
  const cands = [
    { version: '2.7.5' },
    { version: '2.8' },
    { version: '2.8.3' },
    { version: '2.9.1' },
  ]
  const picked = V.pickNewestAbove('2.8', cands)
  check('从候选里只挑比当前高的最大值', picked?.version === '2.9.1')
  check('全是被降级的候选返回 null', V.pickNewestAbove('2.9.1', cands) === null)
} else {
  console.log('\n（未找到打包产物，改做源码结构检查）')
  const src = readFileSync(new URL('../src/services/versioning.ts', import.meta.url), 'utf8')
  const updater = readFileSync(new URL('../src/services/updater.ts', import.meta.url), 'utf8')
  check('versioning 存在 parseVersion/evaluateInstall', /parseVersion/.test(src) && /evaluateInstall/.test(src))
  check('updater 接入 evaluateInstall 拦截', /evaluateInstall/.test(updater))
  check('updateInstall 前有降级拦截', /evaluateInstall\(current\.versionName, latest\.version\)/.test(updater))
  check('版本比较统一走 versioning', /compareVersionNumbers/.test(updater))
}

console.log(failed === 0 ? '\n全部通过\n' : `\n${failed} 项失败\n`)
process.exit(failed === 0 ? 0 : 1)
