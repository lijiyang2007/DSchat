// 真实网络验证：直连 + 各镜像能否取到最新 release，以及 APK 能否下载
// 运行：node scripts/check-update-live.mjs
const API = 'https://api.github.com/repos/lijiyang2007/DSchat/releases/latest'
const MIRRORS = ['https://gh-proxy.com/', 'https://ghfast.top/', 'https://ghproxy.net/']

const tryFetch = async (url, init = {}, timeoutMs = 15000) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

let failures = 0
const check = (name, ok, detail = '') => {
  if (ok) {
    console.log(`  ok   ${name}${detail ? `  ${detail}` : ''}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name}${detail ? `  ${detail}` : ''}`)
  }
}

console.log('release 元数据')
let release = null
let apkUrl = null
for (const url of [API, ...MIRRORS.map((m) => m + API)]) {
  try {
    const response = await tryFetch(url)
    if (!response.ok) {
      console.log(`  skip HTTP ${response.status}  ${url}`)
      continue
    }
    const json = await response.json()
    if (json?.tag_name) {
      release = json
      console.log(`  ok   取到 ${json.tag_name}  ← ${url}`)
      break
    }
  } catch (error) {
    console.log(`  skip ${error.name}  ${url}`)
  }
}
check('至少一个地址可用', release !== null)

if (release) {
  const apk = (release.assets ?? []).find((a) => a.name.toLowerCase().endsWith('.apk'))
  check('release 带 APK 资源', Boolean(apk), apk?.name ?? '')
  apkUrl = apk?.browser_download_url ?? null

  console.log('\nAPK 下载（只读前 64KB）')
  if (apkUrl) {
    for (const url of [apkUrl, ...MIRRORS.map((m) => m + apkUrl)]) {
      try {
        const response = await tryFetch(url, { headers: { Range: 'bytes=0-65535' } }, 25000)
        if (response.status !== 200 && response.status !== 206) {
          console.log(`  skip HTTP ${response.status}  ${url}`)
          continue
        }
        const buffer = new Uint8Array(await response.arrayBuffer())
        // APK 是 zip，开头应为 PK\x03\x04
        const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b
        console.log(`  ok   ${buffer.length}B zip=${isZip}  ← ${url.slice(0, 46)}`)
        check('镜像返回的是真实 APK', isZip)
        break
      } catch (error) {
        console.log(`  skip ${error.name}  ${url.slice(0, 46)}`)
      }
    }
  }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
