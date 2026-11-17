import { create } from 'zustand'
import { useSettings } from '../../services/settings.js'
import { accountToken } from '../../services/account.js'
import { showToast } from '../base/toastState.js'

/** 设置弹窗的分组：通用设置 / 模型与策略 / 长期记忆 / 数据管理 */
export type SettingsSection =
  | 'general'
  | 'appearance'
  | 'chat'
  | 'language'
  | 'voice'
  | 'about'
  | 'feedback'
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
  /**
   * 供应商编辑子页：正在编辑的供应商 id（null=不在编辑页）。
   * 独立子页而不是模型页内嵌块：编辑页内容长，内嵌会把请求参数挤到很远的下面；
   * 做成子页后返回键/Esc/返回按钮都按「编辑页 → 模型页 → …」逐级退。
   */
  editingProviderId: null as string | null,
}))

/** 进入某个供应商的编辑子页 */
export const openProviderEditor = (id: string) =>
  useSettingsDialog.setState({ editingProviderId: id })

/** 关闭供应商编辑子页（保存或取消后调用） */
export const closeProviderEditor = () =>
  useSettingsDialog.setState({ editingProviderId: null })

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section, targeted: true, page: section })

/** 从侧边栏等入口打开设置：先显示入口列表 */
export const openSettingsHome = () =>
  useSettingsDialog.setState({ open: true, targeted: false, page: null })

/** 进入某个子页 */
export const openSettingsSection = (section: SettingsSection) =>
  useSettingsDialog.setState({ page: section, editingProviderId: null })

/** 从子页返回设置主页 */
export const closeSettingsSection = () => useSettingsDialog.setState({ page: null })

export const closeSettings = () =>
  useSettingsDialog.setState({ open: false, targeted: false, page: null, editingProviderId: null })

/**
 * 设置页的返回处理：在子页时回到列表并返回 true；
 * 已在列表页时返回 false，交给调用方决定是否关闭设置。
 */
export const handleSettingsBack = (): boolean => {
  const { open, page, editingProviderId } = useSettingsDialog.getState()
  if (!open) {
    return false
  }
  // 编辑子页在最上层：先退回模型页
  if (page !== null && editingProviderId !== null) {
    closeProviderEditor()
    return true
  }
  if (page !== null) {
    closeSettingsSection()
    return true
  }
  return false
}

/**
 * 发送前的凭据检查：
 * - 已登录 DeepSeek 账号（x-dsh-auth-token）→ 放行，走账号额度
 * - 填了 API Key → 放行
 * - 本地部署模式 → 免密钥放行
 * - 什么都没有 → 打开设置并给出明确提示，不再静默跳页
 */
export const ensureApiKey = (): boolean => {
  const { apiKey, chatProtocol } = useSettings.getState()
  if (apiKey || chatProtocol === 'local') {
    return true
  }
  // 账号登录态存在即视为有凭据：聊天请求会自动带 x-dsh-auth-token
  if (accountToken()) {
    return true
  }
  openSettings('model')
  showToast({ type: 'error', key: 'credentialsMissingToast' })
  return false
}
