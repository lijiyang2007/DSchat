import { create } from 'zustand'
import { useSettings } from '../../services/settings.js'

/** 设置弹窗的分组：通用设置 / 模型与策略 / 长期记忆 / 数据管理 */
export type SettingsSection = 'general' | 'model' | 'memory' | 'data'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
  /** true 表示调用方指定了要打开的分区，直接进子页；false 表示先看入口列表 */
  targeted: false,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section, targeted: true })

/** 从侧边栏等入口打开设置：先显示入口列表 */
export const openSettingsHome = () =>
  useSettingsDialog.setState({ open: true, targeted: false })

export const closeSettings = () => useSettingsDialog.setState({ open: false, targeted: false })

/** 没有 API Key 时打开设置并选中 API Key 所在的「模型与接口」；本地部署模式免密钥直接放行 */
export const ensureApiKey = () => {
  const { apiKey, chatProtocol } = useSettings.getState()
  if (apiKey || chatProtocol === 'local') {
    return true
  }
  openSettings('model')
  return false
}
