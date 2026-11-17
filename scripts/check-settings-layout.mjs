// 设置页排布与外观功能检查：分组结构、字号档位、主题三选一、外观子页路由
// 运行：node scripts/check-settings-layout.mjs
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const page = read('src/components/settings/SettingsPage.tsx')
const pageCss = read('src/components/settings/SettingsPage.module.css')
const dialog = read('src/components/settings/SettingsDialog.tsx')
const settings = read('src/services/settings.ts')
const globalCss = read('src/app/global.css')
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

console.log('分组卡片结构')
check('导出 SettingsGroup', page.includes('export const SettingsGroup'))
check('分组含标题与卡片', page.includes('groupLabel') && page.includes('groupCard'))
check('入口支持右侧当前值', page.includes('entryValue'))
check('入口保留描述行', page.includes('entryDesc'))
check('卡片圆角', /groupCard[\s\S]{0,220}border-radius/.test(pageCss))
check('行间细分隔线', pageCss.includes('inset 0 1px 0 0 var(--dsw-alias-border-l2-darkmode-thin)'))

console.log('\n首页分组')
check('账户分组', dialog.includes("settingsGroupAccountLabel"))
check('应用分组', dialog.includes("settingsGroupAppLabel"))
check('关于分组', dialog.includes("settingsGroupAboutLabel"))
check('外观入口进 appearance 页', /settingsAppearanceLabel[\s\S]{0,200}open\('appearance'\)/.test(dialog))
check('版本号显示当前版本', dialog.includes('versionInfo.versionName'))
check('有新版时提示版本', dialog.includes('settingsHomeUpdateAvailable'))

console.log('\n外观子页')
check('主题三选一', dialog.includes("themeOptions.map"))
check('字号滑块', dialog.includes('type="range"'))
check('四档文案齐全', ['settingsFontSizeSmall', 'settingsFontSizeStandard', 'settingsFontSizeLarge', 'settingsFontSizeHuge'].every((k) => dialog.includes(k)))
check('滑块与档位联动', dialog.includes('FONT_SCALES[Number(event.target.value)]'))
check('思考自动折叠开关', dialog.includes('settingsAutoCollapseThinkingLabel'))
check('token 用量开关', dialog.includes('modelSettingsShowTokenUsageLabel'))

console.log('\n字号缩放生效')
check('四档常量', /FONT_SCALES = \[0\.9, 1, 1\.1, 1\.2\]/.test(settings))
check('写 CSS 变量', settings.includes("setProperty('--ds-font-scale'"))
check('写 data 属性', settings.includes('root.dataset.fontScale'))
check('整页 zoom 缩放', globalCss.includes("html[data-font-scale='1.2']"))
check('启动时套用', read('src/app/theme.ts').includes('applyFontScale'))

console.log('\n外观适配（明暗主题）')
check('页面底色走主题变量', pageCss.includes('background-color: var(--dsw-alias-bg-base)'))
check('卡片底色走主题变量', pageCss.includes('background-color: var(--dsw-specific-sidebar-fill)'))
check('主文字走主题变量', pageCss.includes('color: var(--dsw-alias-label-primary)'))
check('次要文字走主题变量', pageCss.includes('color: var(--dsw-alias-label-tertiary)'))
check('无硬编码白底', !/background(-color)?:\s*#fff/i.test(pageCss))

console.log('\ni18n 双语齐备')
const zhKeys = [...zh.matchAll(/^  (\w+):/gm)].map((m) => m[1])
const enKeys = [...en.matchAll(/^  (\w+):/gm)].map((m) => m[1])
check('中文无重复键', new Set(zhKeys).size === zhKeys.length)
check('英文无重复键', new Set(enKeys).size === enKeys.length)
check('中英键集合一致', [...zhKeys].sort().join(',') === [...enKeys].sort().join(','), `${zhKeys.length} vs ${enKeys.length}`)
const missing = ['settingsGroupAccountLabel', 'settingsAppearanceLabel', 'settingsFontSizeHuge', 'settingsAutoCollapseThinkingDesc'].filter((k) => !zhKeys.includes(k))
check('新增键齐全', missing.length === 0, missing.join(','))

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
