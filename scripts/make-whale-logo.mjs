// 从白底蓝鲸原图生成透明底 logo（public/logo.png）。
// 用于新对话欢迎语上方的鲸鱼图标，颜色与应用图标一致。
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = PNG.sync.read(readFileSync(path.join(root, 'assets', 'icon-source.png')))

const isWhale = (r, g, b) => b > 120 && b - r > 30 && b - g > 20

const bounds = (() => {
  const { width, height, data } = source
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) << 2
      if (isWhale(data[i], data[i + 1], data[i + 2])) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return { minX, minY, width: maxX - minX + 1, height: maxY - minY + 1 }
})()

const SIZE = 256
const PAD = 10
const scale = (SIZE - PAD * 2) / Math.max(bounds.width, bounds.height)
const drawW = bounds.width * scale
const drawH = bounds.height * scale
const originX = (SIZE - drawW) / 2
const originY = (SIZE - drawH) / 2

const sample = (px, py) => {
  const { width, height, data } = source
  const cx = Math.max(0, Math.min(width - 1, px))
  const cy = Math.max(0, Math.min(height - 1, py))
  const x0 = Math.floor(cx)
  const y0 = Math.floor(cy)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const tx = cx - x0
  const ty = cy - y0
  const out = [0, 0, 0]
  const i00 = (y0 * width + x0) << 2
  const i10 = (y0 * width + x1) << 2
  const i01 = (y1 * width + x0) << 2
  const i11 = (y1 * width + x1) << 2
  for (let c = 0; c < 3; c++) {
    out[c] =
      data[i00 + c] * (1 - tx) * (1 - ty) +
      data[i10 + c] * tx * (1 - ty) +
      data[i01 + c] * (1 - tx) * ty +
      data[i11 + c] * tx * ty
  }
  return out
}

const dst = new PNG({ width: SIZE, height: SIZE })
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const idx = (y * SIZE + x) << 2
    const lx = (x + 0.5 - originX) / drawW
    const ly = (y + 0.5 - originY) / drawH
    if (lx < -0.02 || lx > 1.02 || ly < -0.02 || ly > 1.02) {
      dst.data[idx + 3] = 0
      continue
    }
    const [r, g, b] = sample(bounds.minX + lx * bounds.width, bounds.minY + ly * bounds.height)
    // 白底上的蓝鲸：离白色越远，鲸鱼覆盖度越高
    const distance = Math.hypot(255 - r, 255 - g, 255 - b)
    const alpha = Math.max(0, Math.min(1, distance / 170))
    if (alpha <= 0.004) {
      dst.data[idx + 3] = 0
      continue
    }
    // 反混合：去掉白色背景后还原成纯蓝
    dst.data[idx] = Math.round((r - 255 * (1 - alpha)) / alpha)
    dst.data[idx + 1] = Math.round((g - 255 * (1 - alpha)) / alpha)
    dst.data[idx + 2] = Math.round((b - 255 * (1 - alpha)) / alpha)
    dst.data[idx + 3] = Math.round(alpha * 255)
  }
}

writeFileSync(path.join(root, 'public', 'logo.png'), PNG.sync.write(dst))
console.log(`wrote public/logo.png 256x256 (whale ${bounds.width}x${bounds.height})`)
