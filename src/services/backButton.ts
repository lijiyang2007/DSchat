import { useEffect } from 'react'
import { useImageViewer, closeImageViewer } from '../components/messages/ImageViewer.js'
import { closeSearchPanel, useSearchPanel } from '../components/search/searchPanelState.js'
import {
  closeSettings,
  handleSettingsBack,
  useSettingsDialog,
} from '../components/settings/settingsDialogState.js'
import { closeMobileSider, useMobileSider } from '../components/sider/mobileSiderState.js'
import { useChatStore, newChat } from './chat/store.js'

/**
 * 安卓返回键的分层处理。
 *
 * 原生侧在 onBackPressed 里调用 window.__DSCHAT_HANDLE_BACK__()：
 * 返回 true 表示前端已经消费掉（关了某个浮层），返回 false 则交给系统（退到后台）。
 *
 * 顺序按「越靠上层越先关」：
 * 图片查看 → 设置/搜索等弹层 → 移动端抽屉 → 正在生成(停止生成) → 退出当前会话回到欢迎页。
 */
type BackHandler = () => boolean

const handlers: BackHandler[] = []

/** 供其他组件注册自定义返回行为（例如确认框） */
export const registerBackHandler = (handler: BackHandler) => {
  handlers.push(handler)
  return () => {
    const index = handlers.indexOf(handler)
    if (index >= 0) {
      handlers.splice(index, 1)
    }
  }
}

const handleBack = (): boolean => {
  // 后注册的先处理
  for (let i = handlers.length - 1; i >= 0; i -= 1) {
    if (handlers[i]()) {
      return true
    }
  }
  if (useImageViewer.getState().open) {
    closeImageViewer()
    return true
  }
  if (useSettingsDialog.getState().open) {
    // 在子页时先退回设置主页；已经在主页才关闭整个设置
    if (handleSettingsBack()) {
      return true
    }
    closeSettings()
    return true
  }
  if (useSearchPanel.getState().entry) {
    closeSearchPanel()
    return true
  }
  if (useMobileSider.getState().open) {
    closeMobileSider()
    return true
  }
  // 正在生成：先停下，避免误退出把回答打断后什么都不剩
  const state = useChatStore.getState()
  const activeId = state.activeId
  if (activeId !== null && state.streaming[activeId]) {
    state.streaming[activeId].abort()
    return true
  }
  // 停在某个会话里：返回会话列表（欢迎页）
  if (activeId !== null) {
    newChat()
    return true
  }
  return false
}

/** 在应用根部挂载一次即可 */
export const useAndroidBackButton = () => {
  useEffect(() => {
    const w = window as unknown as { __DSCHAT_HANDLE_BACK__?: () => boolean }
    w.__DSCHAT_HANDLE_BACK__ = handleBack
    return () => {
      delete w.__DSCHAT_HANDLE_BACK__
    }
  }, [])
}
