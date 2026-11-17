import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { setupTheme } from './app/theme.js'
import { completeSignIn, installCallbackHandler } from './services/account.js'
import { ensureKatex } from './services/markdown/katex.js'
import './app/theme.css'
import './app/global.css'

ensureKatex()
setupTheme()
// 注册 DeepSeek 账号登录回调（Android 深链 / Web 重定向）
installCallbackHandler()

/**
 * Web 授权回调在 /oauth/callback?code=...：
 * - 子路径下 SPA 的静态资源按相对路径解析会 404（/oauth/static/js/…），
 *   所以不能等 React 挂载——直接在根模块里换 token，然后整页跳回 /。
 * - Android 走深链回调，不经过这里。
 */
const here = new URL(window.location.href)
if (here.pathname.endsWith('/oauth/callback') && here.searchParams.has('code')) {
  void completeSignIn(here.href)
    .then(() => {
      window.location.replace('/')
    })
    .catch(() => {
      // 换 token 失败也要离开回调路径，否则刷新会重复消费已失效的 code；
      // 具体原因带到首页 query 里（首页可读取 oauth_error 显示提示）
      window.location.replace('/?oauth_error=1')
    })
} else {
  createRoot(document.getElementById('root') as HTMLElement).render(<App />)
}
