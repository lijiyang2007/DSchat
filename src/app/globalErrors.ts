/**
 * 全局错误捕获（白屏预防最后一环）。
 *
 * ErrorBoundary 只能接住 React 渲染期的异常；模块顶层代码、事件回调、
 * 未处理的 Promise rejection 都不在它的覆盖范围，这些错误一旦发生也可能
 * 让页面卡死/白屏且毫无线索。这里把它们统一记进 localStorage，
 * 用户下次反馈时可以直接附上，不必再靠猜。
 *
 * 必须在 main.tsx 最顶部、任何业务 import 的副作用之前调用 installGlobalErrorCapture()，
 * 才能尽量早地挂上钩子。
 */

import { CRASH_LOG_KEY } from './ErrorBoundary.js'

type CrashEntry = {
  message: string
  source?: string
  stack?: string
  componentStack?: string
  at: number
  origin: 'react' | 'error' | 'unhandledrejection'
}

const writeCrash = (entry: CrashEntry) => {
  try {
    localStorage.setItem(CRASH_LOG_KEY, JSON.stringify(entry))
  } catch {
    // 静默失败：错误上报本身绝不能成为新的崩溃源
  }
}

let installed = false

export const installGlobalErrorCapture = () => {
  if (installed || typeof window === 'undefined') {
    return
  }
  installed = true

  window.addEventListener('error', (event) => {
    // 资源加载失败（img/script）也会触发 error，但没有 message，跳过以免噪音
    if (!event.message) {
      return
    }
    writeCrash({
      origin: 'error',
      message: event.message,
      source: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined,
      stack: event.error?.stack,
      at: Date.now(),
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : 'Unhandled promise rejection'
    writeCrash({
      origin: 'unhandledrejection',
      message,
      stack: reason instanceof Error ? reason.stack : undefined,
      at: Date.now(),
    })
  })
}
