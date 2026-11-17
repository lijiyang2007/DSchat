import { create } from 'zustand'
import { showToast } from '../components/base/toastState.js'
import { fetchWithDevProxy } from './api/origin.js'

export const GITHUB_REPO = 'lijiyang2007/DSchat'
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO}`
export const GITHUB_RELEASES_URL = `${GITHUB_REPO_URL}/releases`
/** 拉最近若干条 release，自己按版本号挑最大的（/latest 按创建时间排，顺序不可靠） */
const RELEASES_LIST_API = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=30`

/**
 * GitHub 加速镜像。国内网络直连 api.github.com 常被阻断，
 * 这里按顺序尝试：直连 → 各镜像，任何一个通了就能检查更新 / 下载安装包。
 */
/**
 * jsDelivr 的包版本清单。国内可直连，不依赖 GitHub 也不依赖镜像，
 * 是「查更新」最可靠的一条路；拿不到 release 正文，但版本号够用。
 */
const JSDELIVR_API = `https://data.jsdelivr.com/v1/packages/gh/${GITHUB_REPO}`
/**
 * raw.githubusercontent.com 上的 package.json 兜底探针。
 * jsDelivr 偶发抽风时走镜像代理读取（2026-11 实测 ghfast.top 约 1 秒返回）。
 */
const RAW_PACKAGE_JSON = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/package.json`

/**
 * 镜像按用途分组：
 * - API_MIRRORS 只用于代理 raw.githubusercontent.com 的版本探针（实测能透传）。
 *   注意不能再拿它们代理 api.github.com：2026-11 实测 gh-proxy.net 对 API 返回
 *   200 + 广告跳转页（垃圾数据会赢下竞速），ghfast.top 返回 403，gh-proxy.com 已下线。
 * - DOWNLOAD_MIRRORS 只用于 release 资产（APK）下载，实测能透传 assets。
 * 两组列表都按实测可用性维护，顺序即优先级。
 */
export const API_MIRRORS = [
  'https://ghfast.top/',
  'https://ghproxy.net/',
]

/** 下载 APK 用的镜像（实测能透传 release 资源） */
export const DOWNLOAD_MIRRORS = [
  'https://ghfast.top/',
  'https://ghproxy.net/',
]

/** 兼容旧名字：浏览器兜底下载用下载类镜像 */
export const UPDATE_MIRRORS = DOWNLOAD_MIRRORS

/** 把 GitHub 地址展开成候选列表；镜像优先，直连放最后兜底 */
export const withMirrors = (
  url: string,
  mirrors: readonly string[] = DOWNLOAD_MIRRORS
): string[] => [...mirrors.map((prefix) => `${prefix}${url}`), url]

/**
 * 并发尝试候选地址，取第一个成功的。
 *
 * 以前是串行 `for` 循环：每个镜像不通要空等满 5 秒才换下一个，
 * 三个镜像 + jsDelivr 兜底最坏能拖到 20 秒以上，所以「有时快有时慢」——
 * 取决于排在前面的镜像当时通不通。改成并发竞速后，
 * 耗时只取决于最快的那一个，结果稳定。
 */
const fetchFastest = async <T>(
  urls: string[],
  run: (url: string) => Promise<T>
): Promise<{ value: T; url: string }> => {
  if (urls.length === 0) {
    throw new Error('No update endpoints')
  }
  return new Promise((resolve, reject) => {
    let pending = urls.length
    let settled = false
    for (const url of urls) {
      void run(url).then(
        (value) => {
          if (!settled) {
            settled = true
            resolve({ value, url })
          }
        },
        () => {
          pending -= 1
          if (pending === 0 && !settled) {
            reject(new Error('All update endpoints failed'))
          }
        }
      )
    }
  })
}

const SKIPPED_VERSION_KEY = 'chat-demo:skipped-update-version'

export type ReleaseInfo = {
  version: string
  tagName: string
  title: string
  body: string
  publishedAt: string
  htmlUrl: string
  apkUrl: string | null
  apkName: string | null
  apkSize: number | null
}

export type AppVersionInfo = {
  isAndroid: boolean
  versionName: string
  versionCode: number | null
}

export type DownloadStatus = 'idle' | 'downloading' | 'installing' | 'permission_required' | 'error'

export type DownloadState = {
  status: DownloadStatus
  progress: number
  downloaded: number
  total: number
  error: string
  hasDownloadedFile: boolean
}

type AndroidUpdaterBridge = {
  getAppInfo?: () => string
  downloadAndInstallApk?: (apkUrl: string, fileName: string, mirrorsJson?: string) => void
  getUpdateDownloadState?: () => string
  retryInstallDownloadedApk?: () => void
  cancelUpdateDownload?: () => void
  /** 已经下好就直接装，不再重下 */
  installDownloadedApk?: () => boolean
  /** 丢掉已下载的包 */
  discardDownloadedApk?: () => void
}

const getAndroidBridge = (): AndroidUpdaterBridge | null => {
  if (typeof window === 'undefined') {
    return null
  }
  return (
    (window as { __DEEPCHAT_ANDROID_BRIDGE__?: AndroidUpdaterBridge })
      .__DEEPCHAT_ANDROID_BRIDGE__ ?? null
  )
}

export const getCurrentAppVersion = (): AppVersionInfo => {
  const bridge = getAndroidBridge()
  if (bridge?.getAppInfo) {
    try {
      const parsed = JSON.parse(bridge.getAppInfo()) as {
        isAndroid?: boolean
        versionName?: string
        versionCode?: number
      }
      if (parsed && typeof parsed.versionName === 'string' && parsed.versionName.trim()) {
        return {
          isAndroid: Boolean(parsed.isAndroid),
          versionName: parsed.versionName.trim(),
          versionCode: typeof parsed.versionCode === 'number' ? parsed.versionCode : null,
        }
      }
    } catch {
      // 解析原生版本信息失败时退回构建期版本
    }
  }
  return {
    isAndroid: false,
    versionName: __APP_VERSION__,
    versionCode: null,
  }
}

export const normalizeVersion = (raw: string): string => raw.trim().replace(/^v/i, '')

const parseVersionTuple = (raw: string): [number[], string] => {
  const clean = normalizeVersion(raw)
  const [core, pre = ''] = clean.split('-', 2)
  const nums = core.split('.').map((part) => {
    const n = Number.parseInt(part, 10)
    return Number.isFinite(n) && n >= 0 ? n : 0
  })
  while (nums.length < 3) {
    nums.push(0)
  }
  return [nums, pre]
}

/** 比较版本号：a > b 返回 1，a < b 返回 -1，相等返回 0 */
export const compareVersions = (a: string, b: string): number => {
  const [na, pa] = parseVersionTuple(a)
  const [nb, pb] = parseVersionTuple(b)
  const len = Math.max(na.length, nb.length)
  for (let i = 0; i < len; i++) {
    const va = na[i] ?? 0
    const vb = nb[i] ?? 0
    if (va > vb) {
      return 1
    }
    if (va < vb) {
      return -1
    }
  }
  if (!pa && pb) {
    return 1
  }
  if (pa && !pb) {
    return -1
  }
  return pa.localeCompare(pb)
}

const readSkippedVersion = (): string => {
  try {
    return localStorage.getItem(SKIPPED_VERSION_KEY) ?? ''
  } catch {
    return ''
  }
}

const writeSkippedVersion = (version: string) => {
  try {
    if (version) {
      localStorage.setItem(SKIPPED_VERSION_KEY, version)
    } else {
      localStorage.removeItem(SKIPPED_VERSION_KEY)
    }
  } catch {
    // 忽略本地存储失败
  }
}

type UpdaterStore = {
  checking: boolean
  modalOpen: boolean
  latest: ReleaseInfo | null
  hasUpdate: boolean
  lastCheckedAt: number | null
  error: string | null
  download: DownloadState
}

const EMPTY_DOWNLOAD: DownloadState = {
  status: 'idle',
  progress: 0,
  downloaded: 0,
  total: 0,
  error: '',
  hasDownloadedFile: false,
}

export const useUpdater = create<UpdaterStore>(() => ({
  checking: false,
  modalOpen: false,
  latest: null,
  hasUpdate: false,
  lastCheckedAt: null,
  error: null,
  download: EMPTY_DOWNLOAD,
}))

let pollTimer = 0

const stopPollingDownload = () => {
  if (pollTimer) {
    window.clearInterval(pollTimer)
    pollTimer = 0
  }
}

const syncAndroidDownloadState = () => {
  const bridge = getAndroidBridge()
  if (!bridge?.getUpdateDownloadState) {
    stopPollingDownload()
    return
  }
  try {
    const parsed = JSON.parse(bridge.getUpdateDownloadState()) as Partial<DownloadState>
    const status = parsed.status ?? 'idle'
    useUpdater.setState({
      download: {
        status,
        progress: typeof parsed.progress === 'number' ? parsed.progress : 0,
        downloaded: typeof parsed.downloaded === 'number' ? parsed.downloaded : 0,
        total: typeof parsed.total === 'number' ? parsed.total : 0,
        error: typeof parsed.error === 'string' ? parsed.error : '',
        hasDownloadedFile: Boolean(parsed.hasDownloadedFile),
      },
    })
    if (status !== 'downloading') {
      stopPollingDownload()
    }
  } catch {
    stopPollingDownload()
  }
}

const parseGitHubRelease = (raw: unknown): ReleaseInfo | null => {
  if (typeof raw !== 'object' || raw === null) {
    return null
  }
  const obj = raw as Record<string, unknown>
  const tagName = typeof obj.tag_name === 'string' ? obj.tag_name.trim() : ''
  const version = normalizeVersion(tagName)
  if (!version) {
    return null
  }
  const assets = Array.isArray(obj.assets) ? obj.assets : []
  const apkAsset = assets.find(
    (item): item is Record<string, unknown> =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as Record<string, unknown>).name === 'string' &&
      ((item as Record<string, unknown>).name as string).toLowerCase().endsWith('.apk')
  )
  return {
    version,
    tagName,
    title: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : `v${version}`,
    body: typeof obj.body === 'string' ? obj.body.trim() : '',
    publishedAt: typeof obj.published_at === 'string' ? obj.published_at : '',
    htmlUrl:
      typeof obj.html_url === 'string' && obj.html_url.trim()
        ? obj.html_url.trim()
        : GITHUB_RELEASES_URL,
    apkUrl:
      apkAsset && typeof apkAsset.browser_download_url === 'string'
        ? apkAsset.browser_download_url
        : null,
    apkName: apkAsset && typeof apkAsset.name === 'string' ? apkAsset.name : null,
    apkSize: apkAsset && typeof apkAsset.size === 'number' ? apkAsset.size : null,
  }
}

/**
 * 从 jsDelivr 的版本清单里取最高版本，构造一份最小可用的 ReleaseInfo。
 * release 正文和 APK 直链拿不到，下载地址按 GitHub 约定拼出来（走下载镜像）。
 */
const fetchFromJsdelivr = async (signal: AbortSignal): Promise<ReleaseInfo | null> => {
  const response = await fetchWithDevProxy(JSDELIVR_API, { signal })
  if (!response.ok) {
    return null
  }
  const payload = (await response.json()) as { versions?: { version?: string }[] }
  const versions = (payload.versions ?? [])
    .map((item) => item.version)
    .filter((v): v is string => typeof v === 'string' && /^\d+\.\d+\.\d+/.test(v))
  if (versions.length === 0) {
    return null
  }
  const highest = versions.reduce((a, b) => (compareVersions(a, b) > 0 ? a : b))
  return minimalReleaseInfo(highest)
}

/**
 * 镜像代理 raw.githubusercontent.com 上的 package.json 读版本号。
 * 2026-11 实测：api.github.com 被各镜像挡死（广告页/403），但 raw 能透传，
 * ghfast.top 约 1 秒返回。严格校验 JSON 与 name 字段，拒绝广告跳转页。
 */
const fetchFromRawMirror = async (url: string, signal: AbortSignal): Promise<ReleaseInfo | null> => {
  const response = await fetchWithDevProxy(url, { signal })
  if (!response.ok) {
    return null
  }
  const payload = (await response.json()) as { name?: string; version?: string }
  // name 校验是关键：镜像抽风时返回的是 HTML/跳转页，JSON.parse 直接失败；
  // 就算碰巧解析成功，name 不对也说明这不是本仓库的 package.json
  if (payload.name !== 'dschat' || typeof payload.version !== 'string') {
    return null
  }
  const version = payload.version.trim()
  return /^\d+\.\d+\.\d+/.test(version) ? minimalReleaseInfo(version) : null
}

/** 用版本号构造一份最小可用的 ReleaseInfo（下载地址按 GitHub 约定拼，走下载镜像） */
const minimalReleaseInfo = (version: string): ReleaseInfo => {
  const tag = `v${version}`
  return {
    version,
    tagName: tag,
    title: `v${version}`,
    body: '',
    publishedAt: '',
    htmlUrl: `${GITHUB_REPO_URL}/releases/tag/${tag}`,
    apkUrl: `${GITHUB_REPO_URL}/releases/download/${tag}/DSchat-${tag}.apk`,
    apkName: `DSchat-${tag}.apk`,
    apkSize: null,
  }
}

/**
 * 从 release 列表里挑版本号最大的那条。
 * 跳过草稿和预发布；版本号比较用 compareVersions，不看发布时间。
 */
const pickHighestRelease = (raw: unknown): ReleaseInfo | null => {
  if (!Array.isArray(raw)) {
    return null
  }
  let best: ReleaseInfo | null = null
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) {
      continue
    }
    const obj = item as Record<string, unknown>
    if (obj.draft === true || obj.prerelease === true) {
      continue
    }
    const parsed = parseGitHubRelease(obj)
    if (!parsed) {
      continue
    }
    if (!best || compareVersions(parsed.version, best.version) > 0) {
      best = parsed
    }
  }
  return best
}

/**
 * 应用一次检查结果（统一三路来源的落库逻辑）。
 * @returns 是否成功拿到 release 信息
 */
const applyReleaseResult = (release: ReleaseInfo, manual: boolean): boolean => {
  const current = getCurrentAppVersion()
  const hasUpdate = compareVersions(release.version, current.versionName) > 0
  const skipped = readSkippedVersion()
  useUpdater.setState({
    checking: false,
    latest: release,
    hasUpdate,
    lastCheckedAt: Date.now(),
    error: null,
    modalOpen: hasUpdate && (manual || skipped !== release.version),
  })
  if (manual && !hasUpdate) {
    showToast({ key: 'updateUpToDateToast', params: { version: current.versionName } })
  }
  return true
}

/** 从 GitHub Releases 检查最新版本并获取更新公告 */
export const checkForUpdates = async ({ manual = false } = {}): Promise<void> => {
  if (useUpdater.getState().checking) {
    return
  }
  useUpdater.setState({ checking: true, error: null })

  /**
   * 三路并发竞速，谁先给出**合法结果**谁赢：
   * 1) api.github.com 直连（有完整更新公告，能直连时优先）
   * 2) jsDelivr 版本清单（国内可直连，最稳）
   * 3) 镜像代理 raw package.json（前两条都挂时的兜底）
   *
   * 关键：竞速只收「解析成功且校验通过」的结果。2026-11 实测 gh-proxy.net
   * 对 GitHub API 返回 200 + 广告跳转页——如果按「HTTP 200 就赢」判定，
   * 垃圾页会赢下竞速并污染镜像记忆，这正是旧版「检查更新失效」的根源。
   */
  const current = getCurrentAppVersion()
  const release = await fetchFastest<ReleaseInfo>(
    ['github-direct', 'jsdelivr', ...API_MIRRORS.map((m) => `raw:${m}`)],
    async (route) => {
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), 8000)
      try {
        if (route === 'github-direct') {
          // 直连 GitHub API：404 视为「仓库还没有 release」，直接给空结果
          const attempt = await fetchWithDevProxy(RELEASES_LIST_API, {
            headers: { Accept: 'application/vnd.github+json' },
            signal: controller.signal,
          })
          if (attempt.status === 404) {
            return minimalReleaseInfo(current.versionName)
          }
          if (!attempt.ok) {
            throw new Error(`HTTP ${attempt.status}`)
          }
          const release = pickHighestRelease(await attempt.json())
          if (!release) {
            throw new Error('Invalid release payload')
          }
          return release
        }
        if (route === 'jsdelivr') {
          const release = await fetchFromJsdelivr(controller.signal)
          if (!release) {
            throw new Error('jsDelivr payload invalid')
          }
          return release
        }
        // raw:<mirror> —— 镜像代理 package.json
        const release = await fetchFromRawMirror(
          `${route.slice(4)}${RAW_PACKAGE_JSON}`,
          controller.signal
        )
        if (!release) {
          throw new Error('raw probe payload invalid')
        }
        return release
      } finally {
        window.clearTimeout(timeout)
      }
    }
  )
    .then(({ value }) => value)
    .catch(() => null)
  if (release) {
    applyReleaseResult(release, manual)
    return
  }

  const message = '所有更新通道都不可用（GitHub 直连、jsDelivr、镜像探针均失败）'
  useUpdater.setState({ checking: false, error: message })
  if (manual) {
    showToast({ type: 'error', key: 'updateCheckFailedToast', params: { message } })
  }
}

export const openUpdateModal = () => {
  if (useUpdater.getState().latest) {
    useUpdater.setState({ modalOpen: true })
  }
}

export const dismissUpdateModal = () => {
  stopPollingDownload()
  useUpdater.setState({ modalOpen: false })
}

export const skipReleaseVersion = (version: string) => {
  writeSkippedVersion(version)
  dismissUpdateModal()
  showToast({ key: 'updateSkippedToast', params: { version } })
}

export const clearSkippedReleaseVersion = () => writeSkippedVersion('')

export const openReleaseInBrowser = (url?: string | null) => {
  const target = url || useUpdater.getState().latest?.htmlUrl || GITHUB_RELEASES_URL
  // 直连打不开时，浏览器里也换到镜像地址
  const candidate = /^https:\/\/github\.com\//i.test(target)
    ? `${UPDATE_MIRRORS[0]}${target}`
    : target
  window.open(candidate, '_blank', 'noopener,noreferrer')
}

export const startUpdateInstall = () => {
  const { latest } = useUpdater.getState()
  if (!latest) {
    return
  }
  const current = getCurrentAppVersion()
  const bridge = getAndroidBridge()
  if (current.isAndroid && latest.apkUrl && bridge?.downloadAndInstallApk) {
    writeSkippedVersion('')
    const wantedName = latest.apkName ?? `DSchat-v${latest.version}.apk`
    // 退出应用再进来时，包可能已经下好在缓存里：直接装，别重复下载
    if (bridge.installDownloadedApk) {
      try {
        const state = bridge.getUpdateDownloadState
          ? (JSON.parse(bridge.getUpdateDownloadState()) as { hasDownloadedFile?: boolean; apkName?: string })
          : null
        if (state?.hasDownloadedFile && (!state.apkName || state.apkName === wantedName)) {
          if (bridge.installDownloadedApk()) {
            syncAndroidDownloadState()
            return
          }
        }
      } catch {
        // 读状态失败就正常走下载
      }
    }
    bridge.downloadAndInstallApk(latest.apkUrl, wantedName, JSON.stringify(withMirrors(latest.apkUrl)))
    syncAndroidDownloadState()
    stopPollingDownload()
    pollTimer = window.setInterval(syncAndroidDownloadState, 250)
    return
  }
  openReleaseInBrowser(latest.apkUrl ?? latest.htmlUrl)
}

/**
 * 取消正在进行的下载。
 * 之前下载中没有取消入口、弹窗也关不掉，一旦镜像卡住整个页面就动不了；
 * 这里先让原生层中止下载，再把状态复位。
 */
export const cancelUpdateDownload = () => {
  stopPollingDownload()
  const bridge = getAndroidBridge()
  try {
    ;(bridge as { cancelUpdateDownload?: () => void })?.cancelUpdateDownload?.()
  } catch {
    // 原生层没有这个方法时忽略，下面照样复位状态
  }
  useUpdater.setState({ download: EMPTY_DOWNLOAD, modalOpen: false })
}

export const retryPendingAndroidInstall = () => {
  const bridge = getAndroidBridge()
  if (bridge?.retryInstallDownloadedApk) {
    bridge.retryInstallDownloadedApk()
    window.setTimeout(syncAndroidDownloadState, 300)
  }
}

/**
 * 已经下好就直接装。退出应用再进来时缓存里的包还在，
 * 走这里就不用重新下一遍。
 * @returns 是否已触发安装
 */
export const installDownloadedApk = (): boolean => {
  const bridge = getAndroidBridge()
  if (!bridge?.installDownloadedApk) {
    return false
  }
  try {
    const ok = bridge.installDownloadedApk()
    if (ok) {
      window.setTimeout(syncAndroidDownloadState, 300)
    }
    return Boolean(ok)
  } catch {
    return false
  }
}

/** 丢掉已下载的安装包（包损坏或想重下时用），并复位状态 */
export const discardDownloadedApk = () => {
  stopPollingDownload()
  const bridge = getAndroidBridge()
  try {
    bridge?.discardDownloadedApk?.()
  } catch {
    // 原生层没有这个方法时只复位前端状态
  }
  useUpdater.setState({ download: EMPTY_DOWNLOAD })
  window.setTimeout(syncAndroidDownloadState, 200)
}
