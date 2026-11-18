/**
 * 文件保存（导出用）。
 *
 * 浏览器：<a download> + blob URL 可用。
 * Android WebView：<a download> 对 blob: URL **不生效**——这是「导出按钮点了没反应」
 * 的根因（2.7.x 一直如此）。所以 APK 里改走原生桥接 saveExportedFile()，
 * 由 Java 侧写进公共「下载」目录（Android 10+ 用 MediaStore，免权限）。
 */

type ExportBridge = {
  saveExportedFile?: (fileName: string, base64Data: string) => string
}

const getBridge = (): ExportBridge | null => {
  if (typeof window === 'undefined') {
    return null
  }
  return (
    (window as { __DEEPCHAT_ANDROID_BRIDGE__?: ExportBridge }).__DEEPCHAT_ANDROID_BRIDGE__ ?? null
  )
}

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      // data:application/zip;base64,xxxx → 只取 base64 段
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(blob)
  })

export type SaveResult = {
  ok: boolean
  /** Android 上是落盘路径；浏览器上是文件名 */
  location: string
}

/**
 * 保存一个 Blob 到本地。
 * @param name 建议文件名（含扩展名）
 * @param blob 内容
 */
export const saveBlob = async (name: string, blob: Blob): Promise<SaveResult> => {
  const bridge = getBridge()
  if (bridge?.saveExportedFile) {
    const base64 = await blobToBase64(blob)
    const path = bridge.saveExportedFile(name, base64)
    return { ok: Boolean(path), location: path || '' }
  }
  // 浏览器：走标准下载
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  // 立刻 revoke 会让部分浏览器拿不到内容，留一段时间
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  return { ok: true, location: name }
}
