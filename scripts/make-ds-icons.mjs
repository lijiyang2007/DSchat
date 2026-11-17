// Generates the DSchat launcher icon set from the whale artwork.
// Usage: node scripts/make-ds-icons.mjs [sourcePng]
//
// Only the blue whale is taken from the source; every target icon is composed from scratch
// (white rounded plate + blue whale) so the shapes stay crisp at 48px and are consistent with
// Android's adaptive-icon safe zone:
//   - ic_launcher / ic_launcher_round : one baked bitmap
//   - ic_launcher_foreground          : transparent whale on a white background layer
//   - splash                          : whale on the white plate
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = process.argv[2] ?? path.join(root, 'assets', 'icon-source.png')
if (!existsSync(sourcePath)) {
  throw new Error(`icon source not found: ${sourcePath}`)
}

const resDir = path.join(root, 'android', 'app', 'src', 'main', 'res')
/** Share of the icon width the whale spans. */
const GLYPH_RATIO = 0.62
/** Adaptive icons are 108dp with a 66dp safe zone: keep the whale inside that. */
const ADAPTIVE_GLYPH_RATIO = 0.56
/** Corner radius of the white plate, as a share of the icon size. */
const CORNER_RATIO = 0.235
const PLATE = [255, 255, 255]

const read = (file) => PNG.sync.read(readFileSync(file))

const sampleBilinear = (png, x, y) => {
  const { width, height, data } = png
  const cx = Math.max(0, Math.min(width - 1, x))
  const cy = Math.max(0, Math.min(height - 1, y))
  const x0 = Math.floor(cx)
  const y0 = Math.floor(cy)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const tx = cx - x0
  const ty = cy - y0
  const out = [0, 0, 0, 0]
  const w00 = (1 - tx) * (1 - ty)
  const w10 = tx * (1 - ty)
  const w01 = (1 - tx) * ty
  const w11 = tx * ty
  const i00 = (y0 * width + x0) << 2
  const i10 = (y0 * width + x1) << 2
  const i01 = (y1 * width + x0) << 2
  const i11 = (y1 * width + x1) << 2
  for (let c = 0; c < 4; c++) {
    out[c] = data[i00 + c] * w00 + data[i10 + c] * w10 + data[i01 + c] * w01 + data[i11 + c] * w11
  }
  return out
}

/** Saturated blue: the whale body, ignoring the white backdrop and the anti-aliased fringe. */
const isWhale = (r, g, b) => b > 120 && b - r > 30 && b - g > 20

const whaleBounds = (png) => {
  const { width, height, data } = png
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
  if (maxX < minX || maxY < minY) {
    throw new Error('no blue glyph found in the source artwork')
  }
  return { minX, minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

/** Most common blue in the artwork, so re-tinting stays faithful to the original. */
const whaleColor = (png) => {
  const { width, height, data } = png
  const counts = new Map()
  let best = [79, 107, 254]
  let bestCount = 0
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) << 2
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      if (!isWhale(r, g, b)) continue
      const key = (r << 16) | (g << 8) | b
      const next = (counts.get(key) ?? 0) + 1
      counts.set(key, next)
      if (next > bestCount) {
        bestCount = next
        best = [r, g, b]
      }
    }
  }
  return best
}

const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`

/** Coverage of the whale glyph at a point, 0..1 (white backdrop reads as 0). */
const glyphCoverage = (source, whale, px, py) => {
  const [r, g, b] = sampleBilinear(source, px, py)
  // Blue-on-white: distance from white tells how much whale covers this sample.
  const distance = Math.hypot(255 - r, 255 - g, 255 - b)
  return Math.max(0, Math.min(1, distance / 170))
}

/** Rounded-square plate coverage, with a 1px anti-aliased edge. */
const plateCoverage = (x, y, size, shape) => {
  const radius = shape === 'circle' ? size / 2 : size * CORNER_RATIO
  const cx = (size - 1) / 2
  const cy = (size - 1) / 2
  if (shape === 'circle') {
    const d = Math.hypot(x - cx, y - cy)
    return Math.max(0, Math.min(1, radius + 0.5 - d))
  }
  const minX = Math.min(x, size - 1 - x)
  const minY = Math.min(y, size - 1 - y)
  if (minX >= radius || minY >= radius) {
    return 1
  }
  const d = Math.hypot(radius - minX, radius - minY)
  return Math.max(0, Math.min(1, radius + 0.5 - d))
}

const glyphLayout = (size, whale, ratio) => {
  const drawSize = size * ratio
  const scale = drawSize / Math.max(whale.width, whale.height)
  const drawW = whale.width * scale
  const drawH = whale.height * scale
  return { drawW, drawH, originX: (size - drawW) / 2, originY: (size - drawH) / 2 }
}

/** Baked icon: white plate + whale. */
const renderIcon = (source, whale, color, size, shape) => {
  const dst = new PNG({ width: size, height: size })
  const layout = glyphLayout(size, whale, GLYPH_RATIO)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) << 2
      const plateA = plateCoverage(x, y, size, shape)
      if (plateA <= 0) {
        dst.data[idx + 3] = 0
        continue
      }
      const lx = (x + 0.5 - layout.originX) / layout.drawW
      const ly = (y + 0.5 - layout.originY) / layout.drawH
      let glyphA = 0
      if (lx >= -0.02 && lx <= 1.02 && ly >= -0.02 && ly <= 1.02) {
        glyphA = glyphCoverage(
          source,
          whale,
          whale.minX + lx * whale.width,
          whale.minY + ly * whale.height
        )
      }
      const outA = plateA
      const r = PLATE[0] * plateA * (1 - glyphA) + color[0] * glyphA * plateA
      const g = PLATE[1] * plateA * (1 - glyphA) + color[1] * glyphA * plateA
      const b = PLATE[2] * plateA * (1 - glyphA) + color[2] * glyphA * plateA
      dst.data[idx] = Math.round(r / outA)
      dst.data[idx + 1] = Math.round(g / outA)
      dst.data[idx + 2] = Math.round(b / outA)
      dst.data[idx + 3] = Math.round(outA * 255)
    }
  }
  return PNG.sync.write(dst)
}

/** Adaptive foreground: transparent layer with just the whale. */
const renderForeground = (source, whale, color, size, ratio) => {
  const dst = new PNG({ width: size, height: size })
  const layout = glyphLayout(size, whale, ratio)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) << 2
      const lx = (x + 0.5 - layout.originX) / layout.drawW
      const ly = (y + 0.5 - layout.originY) / layout.drawH
      if (lx < -0.02 || lx > 1.02 || ly < -0.02 || ly > 1.02) {
        dst.data[idx + 3] = 0
        continue
      }
      const a = glyphCoverage(
        source,
        whale,
        whale.minX + lx * whale.width,
        whale.minY + ly * whale.height
      )
      dst.data[idx] = color[0]
      dst.data[idx + 1] = color[1]
      dst.data[idx + 2] = color[2]
      dst.data[idx + 3] = Math.round(a * 255)
    }
  }
  return PNG.sync.write(dst)
}

/** Splash: whale on the white plate. */
const renderSplash = (source, whale, color, width, height, ratio) => {
  const size = Math.min(width, height)
  const glyph = PNG.sync.read(renderForeground(source, whale, color, size, ratio))
  const dst = new PNG({ width, height })
  const offsetX = Math.round((width - glyph.width) / 2)
  const offsetY = Math.round((height - glyph.height) / 2)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) << 2
      dst.data[idx] = PLATE[0]
      dst.data[idx + 1] = PLATE[1]
      dst.data[idx + 2] = PLATE[2]
      dst.data[idx + 3] = 255
      const gx = x - offsetX
      const gy = y - offsetY
      if (gx < 0 || gy < 0 || gx >= glyph.width || gy >= glyph.height) {
        continue
      }
      const gi = (gy * glyph.width + gx) << 2
      const ga = glyph.data[gi + 3] / 255
      if (ga <= 0) {
        continue
      }
      dst.data[idx] = Math.round(glyph.data[gi] * ga + PLATE[0] * (1 - ga))
      dst.data[idx + 1] = Math.round(glyph.data[gi + 1] * ga + PLATE[1] * (1 - ga))
      dst.data[idx + 2] = Math.round(glyph.data[gi + 2] * ga + PLATE[2] * (1 - ga))
    }
  }
  return PNG.sync.write(dst)
}

const source = read(sourcePath)
const whale = whaleBounds(source)
const color = whaleColor(source)

const densities = [
  ['mipmap-mdpi', 48, 108],
  ['mipmap-hdpi', 72, 162],
  ['mipmap-xhdpi', 96, 216],
  ['mipmap-xxhdpi', 144, 324],
  ['mipmap-xxxhdpi', 192, 432],
]

for (const [dirName, legacySize, adaptiveSize] of densities) {
  const dir = path.join(resDir, dirName)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'ic_launcher.png'), renderIcon(source, whale, color, legacySize, 'rounded'))
  writeFileSync(
    path.join(dir, 'ic_launcher_round.png'),
    renderIcon(source, whale, color, legacySize, 'circle')
  )
  writeFileSync(
    path.join(dir, 'ic_launcher_foreground.png'),
    renderForeground(source, whale, color, adaptiveSize, ADAPTIVE_GLYPH_RATIO)
  )
}

mkdirSync(path.join(resDir, 'values'), { recursive: true })
writeFileSync(
  path.join(resDir, 'values', 'ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${hex(PLATE)}</color>\n</resources>\n`
)

for (const entry of readdirSync(resDir, { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith('drawable')) {
    continue
  }
  const splashPath = path.join(resDir, entry.name, 'splash.png')
  if (!existsSync(splashPath)) {
    continue
  }
  const existing = read(splashPath)
  writeFileSync(
    splashPath,
    renderSplash(source, whale, color, existing.width, existing.height, 0.34)
  )
}

// Web favicons for the browser build.
const publicDir = path.join(root, 'public')
mkdirSync(publicDir, { recursive: true })
for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  writeFileSync(path.join(publicDir, name), renderIcon(source, whale, color, size, 'rounded'))
}

console.log(
  `DSchat icons generated from ${sourcePath}\n  whale: ${whale.width}x${whale.height} at (${whale.minX},${whale.minY})\n  colours: glyph ${hex(color)} / plate ${hex(PLATE)}`
)
