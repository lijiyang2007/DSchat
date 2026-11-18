/**
 * 版本号规则（v2.7.7 起，用户 2026-11-18 定）。
 *
 * 两个通道，只看版本号有几段：
 * - **正式版**（稳定版）：两段，如 `2.8`、`3.1`。用户筛选后才会推给他，
 *   代表长期可用的一版。
 * - **测试版**：三段，如 `2.7.7`、`2.8.3`、`2.9.1`。日常推送的版本。
 *
 * 比较规则（「任何降级都拦」）：
 * - 版本号先按数字逐段比大小，**缺的段按 0 补齐**
 *   → `2.8` 等价于 `2.8.0`，所以 `2.8` < `2.8.3` < `2.9` < `2.9.1`。
 * - 目标版本 <= 当前版本时一律不装（不允许降级，也不允许重装同版本）。
 * - 逢九进一的进位规则由发版人手动执行（2.7.9 → 2.8.1），这里只做判定。
 *
 * 注意：`versionCode` 由 build.gradle 单独维护（主×1000 + 次×100 + 补丁），
 * 正式版没有第三位，补丁位记 0（2.8 → 2800）。
 */

export type VersionChannel = 'release' | 'test'

export type ParsedVersion = {
  /** 原始版本号（已去 v 前缀） */
  raw: string
  /** 数字段；正式版 2 段，测试版 3 段 */
  parts: number[]
  /** 主.次 */
  major: number
  minor: number
  /** 第三位；正式版为 0 */
  patch: number
  channel: VersionChannel
}

/** 去掉 v 前缀与空白 */
export const normalizeVersion = (raw: string): string => raw.trim().replace(/^v/i, '')

/**
 * 解析版本号。
 * 只接受 2 段或 3 段的纯数字写法；其他形式（带 -beta 之类）按数字段尽力解析，
 * 段数不是 2 或 3 时按测试版处理（更保守：宁可当测试版也不误当正式版）。
 */
export const parseVersion = (raw: string): ParsedVersion | null => {
  const clean = normalizeVersion(raw)
  if (!clean) {
    return null
  }
  const core = clean.split('-')[0] ?? ''
  const segments = core.split('.')
  if (segments.length < 2 || segments.length > 3) {
    return null
  }
  const parts: number[] = []
  for (const segment of segments) {
    if (!/^\d+$/.test(segment.trim())) {
      return null
    }
    parts.push(Number.parseInt(segment, 10))
  }
  const major = parts[0] ?? 0
  const minor = parts[1] ?? 0
  const patch = parts[2] ?? 0
  return {
    raw: clean,
    parts,
    major,
    minor,
    patch,
    // 两段 = 正式版；三段 = 测试版
    channel: parts.length === 2 ? 'release' : 'test',
  }
}

/** 通道显示名 */
export const channelLabel = (channel: VersionChannel, zh: boolean): string =>
  channel === 'release' ? (zh ? '正式版' : 'Release') : zh ? '测试版' : 'Beta'

/**
 * 比较两个版本号（缺段补 0）：a > b 返回 1，a < b 返回 -1，相等 0。
 * 解析失败时退回字符串比较，保证不抛错。
 */
export const compareVersionNumbers = (a: string, b: string): number => {
  const va = parseVersion(a)
  const vb = parseVersion(b)
  if (!va || !vb) {
    return normalizeVersion(a).localeCompare(normalizeVersion(b))
  }
  const len = Math.max(va.parts.length, vb.parts.length)
  for (let i = 0; i < len; i += 1) {
    const left = va.parts[i] ?? 0
    const right = vb.parts[i] ?? 0
    if (left > right) {
      return 1
    }
    if (left < right) {
      return -1
    }
  }
  return 0
}

export type InstallVerdict =
  /** 可以安装：目标版本高于当前 */
  | { kind: 'upgrade'; from: ParsedVersion; to: ParsedVersion }
  /** 同版本：不重复安装 */
  | { kind: 'same'; version: ParsedVersion }
  /** 降级：一律拦截 */
  | { kind: 'downgrade'; from: ParsedVersion; to: ParsedVersion }
  /** 版本号解析不了 */
  | { kind: 'invalid'; raw: string }

/**
 * 判断能否从 current 安装 target。
 * 规则：只有严格更高才允许；相同或更低都拦（用户明确要求「任何降级都拦」）。
 */
export const evaluateInstall = (currentRaw: string, targetRaw: string): InstallVerdict => {
  const current = parseVersion(currentRaw)
  const target = parseVersion(targetRaw)
  if (!target) {
    return { kind: 'invalid', raw: targetRaw }
  }
  if (!current) {
    // 当前版本号异常时不做拦截，避免把用户锁死在坏状态里
    return { kind: 'upgrade', from: { ...target, raw: targetRaw }, to: target }
  }
  const order = compareVersionNumbers(target.raw, current.raw)
  if (order > 0) {
    return { kind: 'upgrade', from: current, to: target }
  }
  if (order === 0) {
    return { kind: 'same', version: target }
  }
  return { kind: 'downgrade', from: current, to: target }
}

/** 是否允许安装（只有 upgrade 允许） */
export const canInstall = (currentRaw: string, targetRaw: string): boolean =>
  evaluateInstall(currentRaw, targetRaw).kind === 'upgrade'

/**
 * 从候选版本里挑出「比当前更高、且最高的」那个。
 * 用于更新检查：过滤掉降级候选，避免把旧版本当成更新推给用户。
 */
export const pickNewestAbove = <T extends { version: string }>(
  currentRaw: string,
  candidates: readonly T[]
): T | null => {
  let best: T | null = null
  for (const candidate of candidates) {
    if (!canInstall(currentRaw, candidate.version)) {
      continue
    }
    if (!best || compareVersionNumbers(candidate.version, best.version) > 0) {
      best = candidate
    }
  }
  return best
}

/**
 * versionCode 规则：主×1000 + 次×100 + 补丁（正式版补丁位记 0）。
 * 2.8 → 2800，2.8.3 → 2803。
 */
export const versionCodeOf = (raw: string): number | null => {
  const parsed = parseVersion(raw)
  if (!parsed) {
    return null
  }
  return parsed.major * 1000 + parsed.minor * 100 + parsed.patch
}
