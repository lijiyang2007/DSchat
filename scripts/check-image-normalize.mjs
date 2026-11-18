// 图片归一化（官方 Vision 限制适配）的逻辑检查
// 运行：node scripts/build-checks.mjs && node scripts/check-image-normalize.mjs
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  sniffImageMime,
  readImageDimensions,
  imageNeedsNormalize,
  clearNormalizedImageCache,
} from '../.tmp-check/imageNormalize.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const store = readFileSync(path.join(root, 'src/services/chat/store.ts'), 'utf8')
const attachments = readFileSync(path.join(root, 'src/services/attachments.ts'), 'utf8')
const errors = readFileSync(path.join(root, 'src/services/api/errors.ts'), 'utf8')

let failures = 0
const check = (name, condition, detail = '') => {
  if (condition) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name} ${detail}`)
  }
}

/** 手工构造只有头部的 PNG 字节数组（IHDR 宽高在 16..24） */
const pngHeader = (width, height) => {
  const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x48, 0x44, 0x52]
  const view = new DataView(new ArrayBuffer(8))
  view.setUint32(0, width)
  view.setUint32(4, height)
  bytes.push(...new Uint8Array(view.buffer))
  return new Uint8Array(bytes)
}

/** 手工构造 JPEG SOF0 段（宽高在 SOF 内） */
const jpegHeader = (width, height) => {
  const bytes = [0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]
  bytes.push((height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 0x03, 0x00)
  return new Uint8Array(bytes)
}

/** GIF 逻辑屏幕描述符 */
const gifHeader = (width, height) => {
  const bytes = [...new TextEncoder().encode('GIF89a')]
  const view = new DataView(new ArrayBuffer(4))
  view.setUint16(0, width, true)
  view.setUint16(2, height, true)
  bytes.push(...new Uint8Array(view.buffer))
  return new Uint8Array(bytes)
}

/** WebP VP8X 容器（宽高各 24bit，减 1 存储） */
const webpVp8xHeader = (width, height) => {
  const bytes = [...new TextEncoder().encode('RIFF____WEBPVP8X')]
  bytes.push(10, 0, 0, 0, 0, 0, 0, 0) // flags + reserved
  bytes.push((width - 1) & 0xff, ((width - 1) >> 8) & 0xff, ((width - 1) >> 16) & 0xff)
  bytes.push((height - 1) & 0xff, ((height - 1) >> 8) & 0xff, ((height - 1) >> 16) & 0xff)
  return new Uint8Array(bytes)
}

console.log('一、头部格式嗅探')
check('PNG', sniffImageMime(pngHeader(1, 1)) === 'image/png')
check('JPEG', sniffImageMime(jpegHeader(1, 1)) === 'image/jpeg')
check('GIF', sniffImageMime(gifHeader(1, 1)) === 'image/gif')
check('WebP VP8X', sniffImageMime(webpVp8xHeader(1, 1)) === 'image/webp')
check('BMP', sniffImageMime(new Uint8Array([0x42, 0x4d, 0, 0])) === 'image/bmp')
check('未知头为空', sniffImageMime(new Uint8Array(64)) === '')

console.log('\n二、头部尺寸解析')
const dim = (bytes) => readImageDimensions(bytes)
check('PNG 2048×2048', JSON.stringify(dim(pngHeader(2048, 2048))) === '{"width":2048,"height":2048}')
check('PNG 12000×100（超长边）', dim(pngHeader(12000, 100))?.width === 12000)
check('JPEG 6000×6000（超总像素）', dim(jpegHeader(6000, 6000))?.width === 6000)
check('GIF 800×600', dim(gifHeader(800, 600))?.height === 600)
check('WebP VP8X 900×1600', dim(webpVp8xHeader(900, 1600))?.height === 1600)

console.log('\n三、准入判定（需要归一化的情形）')
clearNormalizedImageCache()
check('小 PNG 直传', imageNeedsNormalize(pngHeader(1000, 1000), 5000) === false)
check('大 PNG 在预算内直传（2048²）', imageNeedsNormalize(pngHeader(2048, 2048), 1024) === false)
check('超总像素触发（6000×6000）', imageNeedsNormalize(pngHeader(6000, 6000), 5000) === true)
check('超长边触发（12000×100）', imageNeedsNormalize(pngHeader(12000, 100), 5000) === true)
check('BMP 格式官方不收，触发', imageNeedsNormalize(new Uint8Array([0x42, 0x4d, 0, 0, 0, 0]), 5000) === true)
check('未知头触发（解码兜底）', imageNeedsNormalize(new Uint8Array(64), 5000) === true)
check(
  'JPEG 2000×2000 约 400 万像素在预算内',
  imageNeedsNormalize(jpegHeader(2000, 2000), 5000) === false
)
check(
  'JPEG 3999×3999 约 1600 万像素超预算',
  imageNeedsNormalize(jpegHeader(3999, 3999), 5000) === true
)

console.log('\n四、发送路径接入')
check('上传路径先归一化', /normalizeImageIfNeeded\(blob, blob\.type, id\)/.test(attachments))
check('内联路径先归一化', /normalizeImageIfNeeded\(blob, file\.mimeType, file\.id\)/.test(store))
check('归一化缓存按附件 id', /normalizeImageIfNeeded\([^)]*file\.id\)/.test(store))
check('errors 有 isImageRejectedError', /export const isImageRejectedError/.test(errors))
check('识别 too large to process', /The image is too large to process/i.test(errors))
check('识别 unsupported image', /You have uploaded an \(unsupported\|invalid\) \(file\|image\)/i.test(errors))
check('store 判定图片被拒后重传', /isImageRejectedError\(error\)/.test(store))
check('被拒图片强制归一化', /localIds\.forEach\(markImageRejected\)/.test(store))
check('markImageRejected 清缓存并强制', /export const markImageRejected/.test(store) || /export const markImageRejected/.test(readFileSync(path.join(root, 'src/services/imageNormalize.ts'), 'utf8')))

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
