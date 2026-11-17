// 输入框与欢迎页几何对齐检查：数值来自参考截图实测（390 宽视口）
// 运行：node scripts/check-input-geometry.mjs
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const css = read('src/components/chatInput/ChatInput.module.css')
const welcome = read('src/components/session/Welcome.module.css')
const zh = read('src/i18n/zh.ts')
const en = read('src/i18n/en.ts')

let failures = 0
const check = (name, ok, detail = '') => {
  if (ok) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name} ${detail}`)
  }
}

/**
 * 取某个顶层规则块内的声明值。
 * 逐行扫描，只认行首无缩进的选择器，媒体查询里缩进的同名规则不会被命中。
 */
const decl = (source, selector, prop) => {
  const lines = source.split(/\r?\n/)
  const head = `${selector} {`
  let startLine = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith(head)) {
      startLine = i
      break
    }
  }
  if (startLine < 0) {
    return null
  }
  let depth = 0
  let block = ''
  for (let i = startLine; i < lines.length; i += 1) {
    const line = lines[i]
    block += `${line}\n`
    depth += (line.match(/\{/g) ?? []).length
    depth -= (line.match(/\}/g) ?? []).length
    if (depth === 0) {
      break
    }
  }
  const pattern = new RegExp(`(?:^|[\\s;])${prop}:\\s*([^;]+);`)
  const found = pattern.exec(block)
  return found ? found[1].trim() : null
}

console.log('输入框卡片（参考：圆角大、高 106、左右各留 13）')
check('大圆角', /--chat-input-radius:\s*2[0-9]px/.test(css))
check('行高 22', decl(css, '.wrapper', '--line-height') === '22px', String(decl(css, '.wrapper', '--line-height')))
check('顶部内边距 14', decl(css, '.wrapper', '--input-padding-top') === '14px')
check('文本左内边距 17', /padding:\s*var\(--input-padding-top\) 16px 0 17px/.test(css))

console.log('\n功能行与 pill（参考：pill 高 40、字号 14、宽约 99）')
check('pill 高 40', decl(css, '.toggle', 'height') === '40px', String(decl(css, '.toggle', 'height')))
check('pill 字号 14', decl(css, '.toggle', 'font-size') === '14px', String(decl(css, '.toggle', 'font-size')))
check('pill 左右内边距 12', decl(css, '.toggle', 'padding') === '0 12px', String(decl(css, '.toggle', 'padding')))
check('pill 圆角 20', decl(css, '.toggle', 'border-radius') === '20px', String(decl(css, '.toggle', 'border-radius')))
check('pill 间距 8', decl(css, '.toggles', 'gap') === '8px', String(decl(css, '.toggles', 'gap')))
check('功能行内边距 10/12', decl(css, '.functionRow', 'padding') === '10px 10px 12px', String(decl(css, '.functionRow', 'padding')))
check('发送按钮 36', decl(css, '.sendButton', 'width') === '36px', String(decl(css, '.sendButton', 'width')))
check('加号按钮 36', decl(css, '.plusButton', 'width') === '36px', String(decl(css, '.plusButton', 'width')))

console.log('\n欢迎页（参考：logo 43、问候 20、左右留 13）')
check('logo 默认 43', welcome.includes('--welcome-logo-size, 43px'))
check('手机问候 20px', /\.greeting\s*\{\s*font-size:\s*20px/.test(welcome))
check('手机左右留白 13', welcome.includes('padding: 0 13px env(safe-area-inset-bottom)'))
check('hero 下间距 22', decl(welcome, '.hero', 'margin-bottom') === '22px', String(decl(welcome, '.hero', 'margin-bottom')))

console.log('\n手机端占位文案（参考：发消息或按住说话）')
check('中文文案存在', zh.includes("chatInputPlaceholderMobile: '发消息或按住说话'"))
check('英文文案存在', en.includes('chatInputPlaceholderMobile'))
check('按设备切换', read('src/components/chatInput/ChatInput.tsx').includes("isMobile ? 'chatInputPlaceholderMobile'"))

console.log('\n主题适配（不写死颜色）')
check('卡片底色走变量', css.includes('background: var(--dsw-specific-input-major)'))
check('pill 边框走变量', css.includes('border: 1px solid var(--dsw-alias-border-l2)'))
check('文字色走变量', css.includes('color: var(--dsw-alias-label-primary)'))

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
