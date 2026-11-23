import { create } from 'zustand'
import { showToast } from '../components/base/toastState.js'
import { translate } from '../i18n/index.js'
import { fetchWithDevProxy } from './api/origin.js'
import {
  compareVersionNumbers,
  evaluateInstall,
  normalizeVersion,
  pickNewestAbove,
} from './versioning.js'

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

export { normalizeVersion }

/**
 * 版本比较统一走 versioning.ts：两段=正式版、三段=测试版，
 * 缺段补 0，任何降级都不允许。
 */
export const compareVersions = (a: string, b: string): number => compareVersionNumbers(a, b)

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
  /** 当前已安装版本的公告（v2.7.7）：装完新版后用户仍要能查「这版更新了什么」 */
  installedRelease: ReleaseInfo | null
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
  installedRelease: null,
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
 * 兜底来源（jsDelivr / raw package.json）只给版本号，APK 地址是按约定拼出来的，
 * 并不保证真实存在。最典型的坑：package.json 已经改到 v2.9.4 但还没发版，
 * 前端就拼出 `DSchat-v2.9.4.apk` 的死链，用户点「立即更新」必然下载失败。
 *
 * 这里拿 tag 去 Releases API 精确核验：该版本必须有一条非草稿 release、
 * 且带一个 .apk 资产，才认为可更新。核验不了（网络问题）时保守返回 false——
 * 宁可不弹更新，也不推一个装不上的包。
 *
 * @returns 该版本是否有真实存在的 APK 资产
 */
const verifyApkExists = async (release: ReleaseInfo): Promise<boolean> => {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetchWithDevProxy(
      `${GITHUB_REPO_URL}/releases/tag/${encodeURIComponent(release.tagName)}`,
      { headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal }
    )
    if (!response.ok) {
      return false
    }
    const payload: unknown = await response.json()
    if (typeof payload !== 'object' || payload === null) {
      return false
    }
    const obj = payload as Record<string, unknown>
    if (obj.draft === true) {
      return false
    }
    const assets = Array.isArray(obj.assets) ? obj.assets : []
    return assets.some(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>).name === 'string' &&
        ((item as Record<string, unknown>).name as string).toLowerCase().endsWith('.apk')
    )
  } catch {
    return false
  } finally {
    window.clearTimeout(timeout)
  }
}

/** 兜底来源拼出的最小 ReleaseInfo：正文空且没有 apkSize，需要核验 APK 是否真实存在 */
const isMinimalRelease = (release: ReleaseInfo): boolean =>
  !release.body.trim() && release.apkSize === null

/**
 * 从 release 列表里挑版本号最大的那条。
 * 跳过草稿和预发布；版本号比较走 versioning（两段=正式版、三段=测试版）。
 */
const pickHighestRelease = (raw: unknown): ReleaseInfo | null => {
  if (!Array.isArray(raw)) {
    return null
  }
  const candidates: ReleaseInfo[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) {
      continue
    }
    const obj = item as Record<string, unknown>
    if (obj.draft === true || obj.prerelease === true) {
      continue
    }
    const parsed = parseGitHubRelease(obj)
    if (parsed) {
      candidates.push(parsed)
    }
  }
  // 只留「比当前高」的候选：旧版本绝不能当成更新推给用户
  return pickNewestAbove(getCurrentAppVersion().versionName, candidates)
}

/**
 * 把 release 的公告正文补上（2.7.8）。
 *
 * 根因：checkForUpdates 是三路竞速，jsDelivr / raw 探针只带版本号、body 为空，
 * 它们常常比 GitHub 直连先返回，赢了竞速 → 弹窗里「更新内容」一片空白，
 * 用户根本看不到这次更新改了什么。这里在展示前，若正文缺失就再拉一次
 * Releases 列表按版本号精确取正文补上。
 */
const fillReleaseBody = async (release: ReleaseInfo): Promise<ReleaseInfo> => {
  if (release.body.trim()) {
    return release
  }
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetchWithDevProxy(RELEASES_LIST_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    })
    if (!response.ok) {
      return release
    }
    const payload: unknown = await response.json()
    if (!Array.isArray(payload)) {
      return release
    }
    for (const item of payload) {
      if (typeof item !== 'object' || item === null) {
        continue
      }
      const obj = item as Record<string, unknown>
      if (obj.draft === true) {
        continue
      }
      const parsed = parseGitHubRelease(obj)
      if (parsed && compareVersionNumbers(parsed.version, release.version) === 0 && parsed.body.trim()) {
        return { ...release, body: parsed.body, htmlUrl: parsed.htmlUrl || release.htmlUrl }
      }
    }
  } catch {
    // 补全失败就用原 release（至少版本号与下载地址是对的）
  } finally {
    window.clearTimeout(timeout)
  }
  return release
}

/**
 * 应用一次检查结果（统一三路来源的落库逻辑）。
 * @returns 是否成功拿到 release 信息
 */
const applyReleaseResult = async (release: ReleaseInfo, manual: boolean): Promise<boolean> => {
  const current = getCurrentAppVersion()
  // 只有严格更高才算更新：同版本或降级一律不提示（版本规则见 versioning.ts）
  const verdict = evaluateInstall(current.versionName, release.version)
  const hasUpdate = verdict.kind === 'upgrade'
  const skipped = readSkippedVersion()
  // 先落库（版本号立即可用），正文稍后补全——避免用户干等
  useUpdater.setState({
    checking: true,
    latest: release,
    hasUpdate,
    lastCheckedAt: Date.now(),
    error: null,
    modalOpen: false,
  })
  const withBody = await fillReleaseBody(release)
  useUpdater.setState({
    checking: false,
    latest: withBody,
    hasUpdate,
    modalOpen: hasUpdate && (manual || skipped !== withBody.version),
  })
  if (manual && !hasUpdate) {
    showToast({ key: 'updateUpToDateToast', params: { version: current.versionName } })
  }
  return true
}

/**
 * 找出「当前已安装版本」自己的 Release（v2.7.7）。
 *
 * 为什么需要：更新公告以前只在「有新版本」时能看，用户装完新版就再也查不到
 * 「这一版到底改了什么」——这正是「每次更新的简介没有落实」的根因。
 * 这里单独拿一次 release 列表，按版本号精确匹配当前安装的版本。
 */
const fetchInstalledRelease = async (): Promise<ReleaseInfo | null> => {
  const current = getCurrentAppVersion()
  const target = normalizeVersion(current.versionName)
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetchWithDevProxy(RELEASES_LIST_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    })
    if (!response.ok) {
      return null
    }
    const payload: unknown = await response.json()
    if (!Array.isArray(payload)) {
      return null
    }
    for (const item of payload) {
      if (typeof item !== 'object' || item === null) {
        continue
      }
      const obj = item as Record<string, unknown>
      if (obj.draft === true) {
        continue
      }
      const parsed = parseGitHubRelease(obj)
      if (parsed && compareVersionNumbers(parsed.version, target) === 0) {
        return parsed
      }
    }
    return null
  } catch {
    return null
  } finally {
    window.clearTimeout(timeout)
  }
}

/**
 * 打开「本版更新公告」：拿当前安装版本自己的 Release 正文。
 * 与检查更新解耦——没有新版本时也能看这一版改了什么。
 */
export const loadInstalledRelease = async (): Promise<void> => {
  if (useUpdater.getState().installedRelease) {
    useUpdater.setState({ modalOpen: true })
    return
  }
  useUpdater.setState({ checking: true, error: null })
  const release = await fetchInstalledRelease()
  if (release) {
    useUpdater.setState({
      checking: false,
      installedRelease: release,
      // 没有新版本时，把「本版公告」当作 latest 展示（Modal 读 latest）
      latest: useUpdater.getState().latest ?? release,
      modalOpen: true,
      error: null,
    })
    return
  }
  useUpdater.setState({
    checking: false,
    error: '无法获取当前版本的更新公告',
  })
  showToast({ key: 'updateNotesUnavailable' })
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
    // 兜底来源只有版本号、APK 地址是按约定拼的。核验该版本的 Release 里确实带 APK，
    // 否则说明 package.json 领先于发版（如已改 2.9.4 但还没发布），绝不能推死链给用户。
    if (isMinimalRelease(release) && !(await verifyApkExists(release))) {
      const message = `版本 v${release.version} 还没有发布安装包，暂不提示更新`
      useUpdater.setState({ checking: false, error: message })
      if (manual) {
        showToast({ type: 'error', key: 'updateCheckFailedToast', params: { message } })
      }
      return
    }
    await applyReleaseResult(release, manual)
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
  // 安装前的最后一道闸：任何降级 / 同版本都拦下，不给下载也不给装
  const verdict = evaluateInstall(current.versionName, latest.version)
  if (verdict.kind !== 'upgrade') {
    const reason =
      verdict.kind === 'downgrade'
        ? translate('updateBlockedDowngrade', {
            current: verdict.from.raw,
            target: verdict.to.raw,
          })
        : verdict.kind === 'same'
          ? translate('updateBlockedSame', { version: latest.version })
          : translate('updateBlockedInvalid', { version: latest.version })
    showToast(reason)
    return
  }
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
