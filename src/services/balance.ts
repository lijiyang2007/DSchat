/**
 * DeepSeek 官方账号余额查询。
 *
 * 接口：GET https://api.deepseek.com/user/balance
 * 认证：x-dsh-auth-token: <账号 token>（实测认这个头；Bearer 不认账号 token）
 * 响应：{ is_available, balance_infos: [{ currency, total_balance, granted_balance, topped_up_balance }] }
 *
 * 该接口没有 CORS 头，浏览器直连会被拦，统一走本地代理（与聊天请求同路径）。
 */

import { create } from 'zustand'
import { accountToken } from './account.js'
import { fetchWithDevProxy } from './api/origin.js'

const BALANCE_URL = 'https://api.deepseek.com/user/balance'

export type BalanceInfo = {
  currency: string
  totalBalance: number
  grantedBalance: number
  toppedUpBalance: number
}

export type BalanceState = {
  loading: boolean
  available: boolean | null
  info: BalanceInfo | null
  error: string | null
  /** 上次成功查询时间；用于展示「刚刷新」 */
  fetchedAt: number | null
}

export const useBalance = create<BalanceState>(() => ({
  loading: false,
  available: null,
  info: null,
  error: null,
  fetchedAt: null,
}))

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return null
}

type BalancePayload = {
  is_available?: boolean
  balance_infos?: {
    currency?: string
    total_balance?: string | number
    granted_balance?: string | number
    topped_up_balance?: string | number
  }[]
}

/** 拉取账号余额；未登录或请求失败都会落 error，由调用方决定展示方式 */
export const refreshBalance = async (): Promise<void> => {
  const token = accountToken()
  if (!token) {
    useBalance.setState({ loading: false, available: null, info: null, error: null, fetchedAt: null })
    return
  }
  useBalance.setState({ loading: true, error: null })
  try {
    const response = await fetchWithDevProxy(BALANCE_URL, {
      headers: { 'x-dsh-auth-token': token },
    })
    if (response.status === 401) {
      // token 失效：清空展示，错误交给账号入口的登录态处理
      useBalance.setState({ loading: false, available: null, info: null, error: 'token_expired', fetchedAt: null })
      return
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const payload = (await response.json()) as BalancePayload
    const first = payload.balance_infos?.[0]
    const total = toNumber(first?.total_balance)
    if (!first || total === null) {
      throw new Error('invalid balance payload')
    }
    useBalance.setState({
      loading: false,
      available: payload.is_available !== false,
      info: {
        currency: first.currency ?? 'CNY',
        totalBalance: total,
        grantedBalance: toNumber(first.granted_balance) ?? 0,
        toppedUpBalance: toNumber(first.topped_up_balance) ?? 0,
      },
      error: null,
      fetchedAt: Date.now(),
    })
  } catch (error) {
    useBalance.setState({
      loading: false,
      error: error instanceof Error ? error.message : String(error),
      fetchedAt: null,
    })
  }
}

/** 余额文案：¥5.31；无数据时返回 null */
export const formatBalance = (state: BalanceState): string | null => {
  if (!state.info) {
    return null
  }
  const { currency, totalBalance } = state.info
  const symbol = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : `${currency} `
  return `${symbol}${totalBalance.toFixed(2)}`
}
