/**
 * DeepSeek 官方账号登录（与 DSH / DSHA / DSH Go 同一套机制）。
 *
 * 流程（OAuth 2.0 授权码 + PKCE）：
 *   1. 本地生成 code_verifier / code_challenge(S256) 和随机 state
 *   2. POST https://platform.deepseek.com/auth-api/v0/dsh/auth_init
 *      → 拿到 authorize_url、authorize_id、expires_in
 *   3. 在系统浏览器打开 authorize_url，用户登录并授权
 *   4. 平台重定向到 <redirect_uri>?code=...&state=...
 *   5. POST .../dsh/auth_exchange（带 code + code_verifier + 设备信息）
 *      → 拿到账号 token
 *   6. 后续请求带 x-dsh-auth-token: <token> 即可用账号额度
 *
 * 关键点：token 不是 API Key，必须用 x-dsh-auth-token 这个头，
 * 官方 API 认它（用错的 token 会返回 "invalid dsh token"）。
 */

import { create } from 'zustand'
import { fetchWithDevProxy } from './api/origin.js'

const PLATFORM_ORIGIN = 'https://platform.deepseek.com'
const AUTH_BASE = `${PLATFORM_ORIGIN}/auth-api/v0/dsh`

/** 登录态存储键 */
const TOKEN_KEY = 'chat-demo:deepseek-account-token'
const DEVICE_KEY = 'chat-demo:deepseek-account-device'
const USER_KEY = 'chat-demo:deepseek-account-user'

export type AccountUser = {
  id: string
  name: string
  email?: string
}

export type AccountState = {
  /** 账号 token；null 表示未登录 */
  token: string | null
  user: AccountUser | null
  /** 正在等待浏览器授权 */
  pending: boolean
  /** 最近一次失败原因 */
  error: string | null
}

type InitResponse = {
  authorize_url: string
  authorize_id: string
  expires_in: number
}

type ExchangeResponse = {
  token: string
  authorized_url: string
  user?: { id?: string; name?: string; email?: string }
}

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存里生效
  }
}

/** base64url 编码 */
const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

/** 生成 PKCE 的 verifier 与 S256 challenge */
const createPkce = async (): Promise<{ verifier: string; challenge: string }> => {
  const random = crypto.getRandomValues(new Uint8Array(32))
  const verifier = base64url(random)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64url(new Uint8Array(digest)) }
}

/** 设备 id：首次登录时生成，之后固定（平台用于识别设备） */
const deviceId = (): string => {
  const saved = read(DEVICE_KEY)
  if (saved) {
    return saved
  }
  const id = crypto.randomUUID()
  write(DEVICE_KEY, id)
  return id
}

/** 一次进行中的登录尝试 */
type Attempt = {
  verifier: string
  state: string
  authorizeId: string
  redirectUri: string
  expiresAt: number
}

let attempt: Attempt | null = null

/**
 * 回调地址必须是 loopback HTTP（http://127.0.0.1:端口/oauth/callback）。
 * 平台对 redirect_uri 做严格校验：自定义 scheme 会被判 PAYLOAD_SCHEMA_MISMATCH（50005）。
 *
 * - Android：用内置本地代理的端口，回调由 ProxyBridge 拦下再转给前端
 * - Web/开发：用当前页面的 origin（本身也是 127.0.0.1）
 */
export const callbackUrl = (): string => {
  if (typeof window === 'undefined') {
    return 'http://127.0.0.1/oauth/callback'
  }
  const bridge = (window as {
    __DEEPCHAT_ANDROID_BRIDGE__?: { getProxyOrigin?: () => string }
  }).__DEEPCHAT_ANDROID_BRIDGE__
  const proxyOrigin = bridge?.getProxyOrigin?.()
  if (proxyOrigin && /^http:\/\/127\.0\.0\.1:\d+$/i.test(proxyOrigin)) {
    // Android：本地代理已经在监听 127.0.0.1:端口
    return `${proxyOrigin}/oauth/callback`
  }
  const { origin } = window.location
  // file:// 打开时没有可用 origin，退回固定 loopback
  if (!/^https?:\/\//i.test(origin)) {
    return 'http://127.0.0.1:3080/oauth/callback'
  }
  return `${origin}/oauth/callback`
}

const post = async <T>(path: string, body: unknown): Promise<T> => {
  // 平台接口没开 CORS，必须走本地代理（Android 的 ProxyBridge / Web 的 /__api_proxy__）
  const response = await fetchWithDevProxy(`${AUTH_BASE}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...clientHeaders() },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  const payload = (await response.json()) as {
    code?: number
    msg?: string
    data?: { biz_code?: number; biz_msg?: string; biz_data?: T }
  }
  if (payload.code !== 0 || payload.data?.biz_code !== 0 || !payload.data?.biz_data) {
    const code = payload.code ?? '?'
    const biz = payload.data?.biz_code ?? '?'
    const msg = payload.data?.biz_msg || payload.msg || ''
    throw new Error(`平台返回错误（code ${code} / biz ${biz}）${msg ? `：${msg}` : ''}`)
  }
  return payload.data.biz_data
}

/** 客户端标识：版本、语言、时区偏移（与官方客户端一致） */
const clientMeta = () => ({
  version: __APP_VERSION__,
  locale: navigator.language.startsWith('zh') ? 'zh_CN' : 'en_US',
  timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
})

/**
 * 平台要求每个账号接口都带这五个客户端标识头，缺了会返回业务码 50005。
 * 这几个头是官方桌面版 platformClientHeaders() 的等价实现。
 */
const clientHeaders = (): Record<string, string> => {
  const meta = clientMeta()
  return {
    'x-client-bundle-id': '',
    'x-client-platform': 'web',
    'x-client-version': meta.version,
    'x-client-locale': meta.locale,
    'x-client-timezone-offset': String(meta.timezoneOffsetSeconds),
  }
}

/** 开始登录：拿到授权地址并打开浏览器 */
export const startSignIn = async (): Promise<string> => {
  const { verifier, challenge } = await createPkce()
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)))
  const redirectUri = callbackUrl()
  const init = await post<InitResponse>('auth_init', {
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    redirect_uri: redirectUri,
    locale: clientMeta().locale,
    login_source: 'web',
  })
  attempt = {
    verifier,
    state,
    authorizeId: init.authorize_id,
    redirectUri,
    expiresAt: Date.now() + init.expires_in * 1000,
  }
  return init.authorize_url
}

/**
 * 处理授权回调：校验 state 后用 code 换 token。
 * @param url 回调完整地址（含 code / state 参数）
 */
export const completeSignIn = async (url: string): Promise<AccountUser> => {
  if (!attempt) {
    throw new Error('登录会话已失效，请重新发起登录')
  }
  if (Date.now() > attempt.expiresAt) {
    attempt = null
    throw new Error('登录已超时，请重新发起')
  }
  const parsed = new URL(url)
  const code = parsed.searchParams.get('code')
  const state = parsed.searchParams.get('state')
  if (!code) {
    throw new Error('回调缺少 code')
  }
  if (state !== attempt.state) {
    throw new Error('state 校验失败，已中止登录')
  }
  const result = await post<ExchangeResponse>('auth_exchange', {
    code,
    code_verifier: attempt.verifier,
    redirect_uri: attempt.redirectUri,
    device_id: deviceId(),
    device_model: `${navigator.platform || 'Android'} ${(() => { const parts = navigator.userAgent.split(' '); return parts[parts.length - 1] ?? '' })()}`.trim(),
    os_version: navigator.userAgent,
  })
  const user: AccountUser = {
    id: result.user?.id ?? '',
    name: result.user?.name ?? '',
    email: result.user?.email,
  }
  write(TOKEN_KEY, result.token)
  write(USER_KEY, JSON.stringify(user))
  attempt = null
  useAccount.setState({ token: result.token, user, pending: false, error: null })
  return user
}

/** 取消进行中的登录 */
export const cancelSignIn = () => {
  attempt = null
  useAccount.setState({ pending: false })
}

/** 退出登录：清掉本地 token */
export const signOut = () => {
  write(TOKEN_KEY, null)
  write(USER_KEY, null)
  attempt = null
  useAccount.setState({ token: null, user: null, pending: false, error: null })
}

/** 读回已保存的登录态 */
export const loadAccount = (): AccountState => {
  const token = read(TOKEN_KEY)
  let user: AccountUser | null = null
  try {
    const raw = read(USER_KEY)
    user = raw ? (JSON.parse(raw) as AccountUser) : null
  } catch {
    user = null
  }
  return { token, user, pending: false, error: null }
}

/** 当前账号 token，未登录时为 null */
export const accountToken = (): string | null => useAccount.getState().token

/** 登录态 store；组件订阅它展示登录 / 未登录 */
export const useAccount = create<AccountState>(() => loadAccount())

/**
 * 注册 OAuth 回调入口。
 * - Android：MainActivity 拦截 dschat://oauth/callback 后调用 window.__DSCHAT_OAUTH_CALLBACK__
 * - Web：登录页重定向回 /oauth/callback 时，启动时读一次 URL
 */
export const installCallbackHandler = () => {
  if (typeof window === 'undefined') {
    return
  }
  const w = window as {
    __DSCHAT_OAUTH_CALLBACK__?: (url: string) => void
  }
  w.__DSCHAT_OAUTH_CALLBACK__ = (url: string) => {
    useAccount.setState({ pending: true, error: null })
    void completeSignIn(url)
      .then(() => useAccount.setState({ pending: false, error: null }))
      .catch((error: unknown) =>
        useAccount.setState({
          pending: false,
          error: error instanceof Error ? error.message : String(error),
        })
      )
  }

  // Web：从授权页跳回来时 URL 上带 code / state
  const current = new URL(window.location.href)
  if (current.pathname.endsWith('/oauth/callback') && current.searchParams.has('code')) {
    w.__DSCHAT_OAUTH_CALLBACK__(current.href)
    // 清掉地址栏参数，避免刷新重复换 token
    window.history.replaceState(null, '', current.pathname)
  }
}
