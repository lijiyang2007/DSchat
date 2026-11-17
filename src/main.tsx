import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { setupTheme } from './app/theme.js'
import { installCallbackHandler } from './services/account.js'
import { ensureKatex } from './services/markdown/katex.js'
import './app/theme.css'
import './app/global.css'

ensureKatex()
setupTheme()
// 注册 DeepSeek 账号登录回调（Android 深链 / Web 重定向）
installCallbackHandler()

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
