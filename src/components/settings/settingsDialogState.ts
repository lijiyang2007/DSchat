import { create } from 'zustand'
import { useSettings } from '../../services/settings.js'

/** 设置弹窗的分组：通用设置 / 模型与策略 / 长期记忆 / 数据管理 */
export type SettingsSection =
  | 'general'
  | 'appearance'
  | 'language'
  | 'voice'
  | 'about'
  | 'model'
  | 'memory'
  | 'data'

/**
 * 设置页导航状态。
 * page 为 null 表示停留在设置主页（入口列表），否则是正在查看的子页。
 * 把它放在 store 里，安卓返回键和 Esc 才能按「子页 → 列表 → 关闭」逐级返回。
 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
  /** true 表示调用方指定了要打开的分区，直接进子页；false 表示先看入口列表 */
  targeted: false,
  /** 当前查看的子页；null 为设置主页 */
  page: null as SettingsSection | null,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section, targeted: true, page: section })

/** 从侧边栏等入口打开设置：先显示入口列表 */
export const openSettingsHome = () =>
  useSettingsDialog.setState({ open: true, targeted: false, page: null })

/** 进入某个子页 */
export const openSettingsSection = (section: SettingsSection) =>
  useSettingsDialog.setState({ page: section })

/** 从子页返回设置主页 */
export const closeSettingsSection = () => useSettingsDialog.setState({ page: null })

export const closeSettings = () =>
  useSettingsDialog.setState({ open: false, targeted: false, page: null })

/**
 * 设置页的返回处理：在子页时回到列表并返回 true；
 * 已在列表页时返回 false，交给调用方决定是否关闭设置。
 */
export const handleSettingsBack = (): boolean => {
  const { open, page } = useSettingsDialog.getState()
  if (!open) {
    return false
  }
  if (page !== null) {
    closeSettingsSection()
    return true
  }
  return false
}

/** 没有 API Key 时打开设置并选中 API Key 所在的「模型与接口」；本地部署模式免密钥直接放行 */
export const ensureApiKey = () => {
  const { apiKey, chatProtocol } = useSettings.getState()
  if (apiKey || chatProtocol === 'local') {
    return true
  }
  openSettings('model')
  return false
}
