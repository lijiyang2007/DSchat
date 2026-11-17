// DeepSeek 账号登录链路检查：PKCE、端点、鉴权头、Android 深链
// 运行：node scripts/check-account.mjs
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const account = read('src/services/account.ts')
const client = read('src/services/api/client.ts')
const main = read('src/main.tsx')
const manifest = read('android/app/src/main/AndroidManifest.xml')
const java = read('android/app/src/main/java/com/dschat/app/MainActivity.java')
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

console.log('OAuth 端点（与 DSH 桌面版一致）')
check('平台 origin', account.includes("https://platform.deepseek.com"))
check('auth_init 路径', account.includes('/auth-api/v0/dsh'))
check('调用 auth_init', account.includes("post<InitResponse>('auth_init'"))
check('调用 auth_exchange', account.includes("post<ExchangeResponse>('auth_exchange'"))
check('读取 authorize_url', account.includes('init.authorize_url'))
check('读取 token', account.includes('result.token'))

console.log('\nPKCE 与安全')
check('生成 verifier', account.includes('createPkce'))
check('S256 challenge', account.includes("crypto.subtle.digest('SHA-256'"))
check('声明 code_challenge_method', account.includes("code_challenge_method: 'S256'"))
check('随机 state', account.includes('state = base64url'))
check('校验 state', account.includes('state !== attempt.state'))
check('校验过期', account.includes('Date.now() > attempt.expiresAt'))
check('回调缺 code 时报错', account.includes("回调缺少 code"))

console.log('\n鉴权头（关键：账号 token 用 x-dsh-auth-token）')
check('客户端读账号 token', client.includes('accountToken()'))
check('发送 x-dsh-auth-token', client.includes("'x-dsh-auth-token': token"))
check('未登录回退 API Key', client.includes("'x-api-key': apiKey"))
check('两者互斥（不会同时发）', /\? \{ 'x-dsh-auth-token': token \} : \{ 'x-api-key': apiKey \}/.test(client))

console.log('\n50005 修复：回调地址与客户端标识头')
check('回调必须是 loopback HTTP', /127\\.0\\.0\\.1/.test(account))
check('拒绝自定义 scheme', !account.includes("'dschat://oauth/callback'") || account.includes('loopback'))
check('Android 用本地代理端口', account.includes('getProxyOrigin'))
check('file:// 有兜底地址', account.includes('http://127.0.0.1:3080/oauth/callback'))
check('发送 x-client-version', account.includes("'x-client-version'"))
check('发送 x-client-platform', account.includes("'x-client-platform': 'web'"))
check('发送 x-client-locale', account.includes("'x-client-locale'"))
check('发送 x-client-timezone-offset', account.includes("'x-client-timezone-offset'"))
check('发送 x-client-bundle-id', account.includes("'x-client-bundle-id'"))
check('post 带客户端头', /headers: \{ 'content-type': 'application\/json', \.\.\.clientHeaders\(\) \}/.test(account))
check('错误信息含业务码', account.includes('biz_code'))

console.log('\nAndroid 深链回调')
check('Manifest 注册 scheme', manifest.includes('android:scheme="dschat"'))
check('Manifest host=oauth', manifest.includes('android:host="oauth"'))
check('Manifest pathPrefix', manifest.includes('android:pathPrefix="/callback"'))
check('Manifest 声明 BROWSABLE', manifest.includes('android.intent.category.BROWSABLE'))
check('MainActivity 处理 intent', java.includes('handleOAuthIntent'))
check('代理接住 /oauth/callback', java.includes('/oauth/callback'))
check('回调把 query 转给前端', java.includes('__DSCHAT_OAUTH_CALLBACK__'))
check('MainActivity 处理 onNewIntent', java.includes('protected void onNewIntent'))
check('注入 JS 回调', java.includes('__DSCHAT_OAUTH_CALLBACK__'))
check('JS 字符串转义', java.includes('private static String jsString'))

console.log('\n前端回调与启动')
check('注册全局回调', account.includes('__DSCHAT_OAUTH_CALLBACK__'))
check('启动时安装', main.includes('installCallbackHandler()'))
check('Web 读 URL 参数', account.includes("searchParams.has('code')"))
check('清理地址栏参数', account.includes('history.replaceState'))

console.log('\n登录态存储与退出')
check('token 持久化', account.includes("TOKEN_KEY = 'chat-demo:deepseek-account-token'"))
check('设备 id 固定', account.includes('DEVICE_KEY'))
check('退出清 token', account.includes('write(TOKEN_KEY, null)'))
check('store 存在', account.includes('export const useAccount'))
check('对外暴露 token', account.includes('export const accountToken'))

console.log('\ni18n 双语')
const zhKeys = [...zh.matchAll(/^  (\w+):/gm)].map((m) => m[1])
const enKeys = [...en.matchAll(/^  (\w+):/gm)].map((m) => m[1])
check('中文无重复', new Set(zhKeys).size === zhKeys.length)
check('英文无重复', new Set(enKeys).size === enKeys.length)
check('键集合一致', [...zhKeys].sort().join() === [...enKeys].sort().join())
const need = ['accountSignIn', 'accountSignedIn', 'accountSignOut', 'accountSigningIn', 'accountSignInFailed', 'accountTokenInUse']
const missing = need.filter((k) => !zhKeys.includes(k))
check('账号相关键齐全', missing.length === 0, missing.join(','))

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
