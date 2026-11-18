/**
 * 图片发送前的归一化：把官方图片接口收不了或尺寸超限的图片转成能收的形态。
 *
 * 官方 Vision 的硬限制（api-docs.deepseek.com/guides/vision）：
 * - 格式仅 JPEG / PNG / GIF / WebP，格式由文件实际内容判断
 * - 单边最长 8192 像素；请求含 15 张及以上图片时降为 4096
 * - 超限报 "The image is too large to process"，格式不符报 "unsupported image"
 *
 * 模型侧进模型前反正会缩到约 1300×1300，缩图不损有效清晰度；
 * 归一化与官方桌面端同策略：解码后按总像素预算等比缩小，WebP 编码。
 */

/** 归一化后的单图总像素预算；与官方桌面端 normalizedImageMaxPixels 一致 */
const MAX_PIXELS = 2048 * 2048
/** 长边上限：按 8192 档（15 张图以内）；缩放比例与总像素预算叠加生效 */
const MAX_DIMENSION = 8192
/** 归一化产物编码字节目标，超过时降低质量重编码 */
const TARGET_BYTES = 4 * 1024 * 1024
const WEBP_QUALITY_STEPS = [0.85, 0.75, 0.6]
/** 头部探测只需要前几十字节 */
const HEADER_BYTES = 64

/** 浏览器能解码、官方也直接收的格式；其余（bmp/tiff/avif/svg…）一律转码 */
const NATIVE_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

export type NormalizedImage = {
  /** 归一化后的字节与 MIME；changed 为 false 时与原件相同 */
  blob: Blob
  mimeType: string
  /** 触发了转码或缩放 */
  changed: boolean
}

/** 按文件头判断实际格式（选择器与导入都常给错 MIME 或无 MIME） */
export const sniffImageMime = (bytes: Uint8Array): string => {
  const startsWith = (...prefix: number[]) => prefix.every((byte, index) => bytes[index] === byte)
  const header = new TextDecoder('ascii').decode(bytes.subarray(0, HEADER_BYTES))
  if (startsWith(0xff, 0xd8, 0xff)) {
    return 'image/jpeg'
  }
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    // APNG 与 PNG 同头，官方按 PNG 收，无需区分
    return 'image/png'
  }
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) {
    return 'image/gif'
  }
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') {
    return 'image/webp'
  }
  if (startsWith(0x42, 0x4d)) {
    return 'image/bmp'
  }
  if (startsWith(0x49, 0x49, 0x2a, 0x00) || startsWith(0x4d, 0x4d, 0x00, 0x2a)) {
    return 'image/tiff'
  }
  if (header.slice(4, 8) === 'ftyp' && ['avif', 'avis'].includes(header.slice(8, 12))) {
    return 'image/avif'
  }
  return ''
}

/** 从文件头读 PNG / GIF / WebP / JPEG 的宽高；读不出返回 null */
export const readImageDimensions = (
  bytes: Uint8Array
): { width: number; height: number } | null => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (start: number, length: number) => {
    let text = ''
    for (let i = 0; i < length; i += 1) {
      text += String.fromCharCode(bytes[start + i])
    }
    return text
  }
  // PNG：IHDR 固定在第 16..24 字节
  if (
    bytes[0] === 0x89 &&
    ascii(1, 3) === 'PNG' &&
    ascii(12, 4) === 'IHDR' &&
    bytes.byteLength >= 24
  ) {
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  // GIF：逻辑屏幕描述符
  if (ascii(0, 3) === 'GIF' && bytes.byteLength >= 10) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
  }
  // WebP：VP8 / VP8L / VP8X 三种容器的尺寸字段
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP' && bytes.byteLength >= 30) {
    const chunk = ascii(12, 4)
    if (chunk === 'VP8 ') {
      // 帧头从 20 起：3 字节帧标签 + 起始码 0x9d 0x01 0x2a，再是 14bit 宽高
      if (bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
        return {
          width: view.getUint16(26, true) & 0x3fff,
          height: view.getUint16(28, true) & 0x3fff,
        }
      }
    } else if (chunk === 'VP8L') {
      // 21 起的 4 字节小端整数：首字节 0x2f 签名，随后 14bit 宽-1 与 14bit 高-1
      const bits = view.getUint32(21, true)
      if ((bits & 0xff) === 0x2f) {
        return {
          width: ((bits >>> 8) & 0x3fff) + 1,
          height: ((bits >>> 22) & 0x3fff) + 1,
        }
      }
    } else if (chunk === 'VP8X') {
      // 24 起的 24bit 宽-1 与高-1
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16))
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16))
      return { width, height }
    }
    return null
  }
  // JPEG：跳过段找 SOF0/1/2（Baseline 与 Progressive）
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.byteLength > 9) {
    let offset = 2
    while (offset + 9 < bytes.byteLength) {
      if (bytes[offset] !== 0xff) {
        offset += 1
        continue
      }
      const marker = bytes[offset + 1]
      // 填充字节与独立标记（TEM、RSTn）不占段长
      if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2
        continue
      }
      const length = view.getUint16(offset + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) }
      }
      offset += 2 + length
    }
  }
  return null
}

/** 官方接口收不了或超预算：格式冷门、总像素超 2048² 或长边超 8192 */
export const imageNeedsNormalize = (bytes: Uint8Array, size: number): boolean => {
  const mime = sniffImageMime(bytes)
  if (!NATIVE_MIME.has(mime)) {
    // 官方收不了的格式（bmp/tiff/avif/svg…）或头部无法识别的图片
    return true
  }
  const dims = readImageDimensions(bytes)
  if (!dims) {
    // 原生格式但头部解析不出尺寸：超编码字节预算时交给解码兜底缩一遍，其余直传
    return size > TARGET_BYTES
  }
  return dims.width * dims.height > MAX_PIXELS || Math.max(dims.width, dims.height) > MAX_DIMENSION
}

const decode = async (blob: Blob): Promise<ImageBitmap | null> => {
  try {
    return await createImageBitmap(blob)
  } catch {
    return null
  }
}

const encode = async (canvas: HTMLCanvasElement, quality: number): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas toBlob failed'))),
      'image/webp',
      quality
    )
  })

/**
 * 把图片归一化到官方接口收定的范围内：Canvas 等比缩小后按质量阶梯编码 WebP。
 * 解码失败或画布不可用时返回 null，调用方退回原件直传（保持旧行为）。
 * 动图会退化为首帧静态图：官方模型侧本就不消费动图动画。
 */
export const normalizeImage = async (blob: Blob): Promise<NormalizedImage | null> => {
  const bitmap = await decode(blob)
  if (!bitmap) {
    return null
  }
  try {
    const scale = Math.min(
      1,
      Math.sqrt(MAX_PIXELS / (bitmap.width * bitmap.height)),
      MAX_DIMENSION / Math.max(bitmap.width, bitmap.height)
    )
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      return null
    }
    context.drawImage(bitmap, 0, 0, width, height)
    let encoded = await encode(canvas, WEBP_QUALITY_STEPS[0])
    for (const quality of WEBP_QUALITY_STEPS.slice(1)) {
      if (encoded.size <= TARGET_BYTES) {
        break
      }
      encoded = await encode(canvas, quality)
    }
    return { blob: encoded, mimeType: 'image/webp', changed: true }
  } finally {
    bitmap.close()
  }
}

/**
 * 归一化结果缓存：同一附件（按调用方给的 key）在历史轮次里反复进入请求，
 * 转码产物按 key 复用，只在上传或首次内联时算一次。
 */
const normalizedCache = new Map<string, NormalizedImage>()
const NORMALIZED_CACHE_LIMIT = 32

const cacheNormalized = (key: string, value: NormalizedImage) => {
  if (normalizedCache.size >= NORMALIZED_CACHE_LIMIT) {
    const oldest = normalizedCache.keys().next().value
    if (oldest !== undefined) {
      normalizedCache.delete(oldest)
    }
  }
  normalizedCache.set(key, value)
}

/** 服务端拒绝过的图片（超限 / 格式不支持）：下次发送强制归一化，不再按头部判定直传 */
const rejectedIds = new Set<string>()

/** 服务端以 400 拒掉图片内容时登记附件 id；有本地 id 的图片附件才登记 */
export const markImageRejected = (id: string) => {
  rejectedIds.add(id)
  normalizedCache.delete(id)
}

/**
 * 按需归一化：只有超出官方限制的图片才会被转码；其余原样返回，不动原字节。
 * 上传与内联两条发送路径共用，保证大图、冷门格式、超大尺寸都能发出去。
 * cacheKey 传入附件的本地 id；解码失败时退回原件直传，不阻塞发送。
 * 被 markImageRejected 登记过的附件跳过头部判定，直接解码重编码。
 */
export const normalizeImageIfNeeded = async (
  blob: Blob,
  mimeType: string,
  cacheKey?: string
): Promise<NormalizedImage> => {
  if (cacheKey) {
    const cached = normalizedCache.get(cacheKey)
    if (cached) {
      return cached
    }
  }
  const force = cacheKey !== undefined && rejectedIds.has(cacheKey)
  const bytes = new Uint8Array(await blob.slice(0, HEADER_BYTES).arrayBuffer())
  // 头部认不出的且声明的类型也不是图片：不是发给图片接口的内容，原样返回
  if (!force && sniffImageMime(bytes) === '' && !mimeType.startsWith('image/')) {
    return { blob, mimeType, changed: false }
  }
  if (!force) {
    const full = new Uint8Array(await blob.arrayBuffer())
    if (!imageNeedsNormalize(full, blob.size)) {
      const result = { blob, mimeType, changed: false }
      if (cacheKey) {
        cacheNormalized(cacheKey, result)
      }
      return result
    }
  }
  const normalized = (await normalizeImage(blob)) ?? { blob, mimeType, changed: false }
  if (normalized.changed) {
    if (cacheKey) {
      cacheNormalized(cacheKey, normalized)
    }
    rejectedIds.delete(cacheKey ?? '')
  }
  return normalized
}

/** 测试钩子：清空归一化缓存与拒图标记 */
export const clearNormalizedImageCache = () => {
  normalizedCache.clear()
  rejectedIds.clear()
}
