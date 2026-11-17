// 设置页动效检查：入场、退场、子页左右滑动、reduced-motion 降级
// 运行：node scripts/check-settings-anim.mjs
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const page = read('src/components/settings/SettingsPage.tsx')
const css = read('src/components/settings/SettingsPage.module.css')
const dialog = read('src/components/settings/SettingsDialog.tsx')

let failures = 0
const check = (name, ok, detail = '') => {
  if (ok) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name} ${detail}`)
  }
}

console.log('整页入场动画')
check('page 有入场动画', /\.page\s*\{[\s\S]{0,400}animation:\s*settingsPageEnter/.test(css))
check('入场含淡入', /@keyframes settingsPageEnter[\s\S]{0,200}opacity:\s*0/.test(css))
check('入场含上浮位移', /@keyframes settingsPageEnter[\s\S]{0,200}translate3d\(0,\s*16px/.test(css))
check('入场含轻微缩放', /@keyframes settingsPageEnter[\s\S]{0,200}scale\(0\.985\)/.test(css))
check('入场终点归位', /@keyframes settingsPageEnter[\s\S]{0,260}opacity:\s*1[\s\S]{0,120}scale\(1\)/.test(css))
check('入场用 ease-out 曲线', /settingsPageEnter 0\.22s cubic-bezier\(0\.22,\s*1,\s*0\.36,\s*1\)/.test(css))
check('入场 both 填充', /animation:\s*settingsPageEnter[^;]*both/.test(css))

console.log('\n整页退场动画')
check('closing 有退场动画', /\.page\[data-closing='true'\]\s*\{[\s\S]{0,220}animation:\s*settingsPageExit/.test(css))
check('退场淡出', /@keyframes settingsPageExit[\s\S]{0,220}opacity:\s*0/.test(css))
check('退场下浮', /@keyframes settingsPageExit[\s\S]{0,220}translate3d\(0,\s*10px/.test(css))
check('退场时不可交互', /\.page\[data-closing='true'\][\s\S]{0,220}pointer-events:\s*none/.test(css))
check('页面接收 closing 属性', page.includes("data-closing={closing ? 'true' : undefined}"))
check('退场后再卸载', /setClosing\(true\)[\s\S]{0,260}setTimeout\([\s\S]{0,200}setMounted\(false\)/.test(dialog))
check('退场时长与 JS 常量一致', /SETTINGS_PAGE_EXIT_MS\s*=\s*180/.test(dialog) && /settingsPageExit 0\.18s/.test(css))

console.log('\n子页左右滑动')
check('前进滑入', /\.body\[data-nav='forward'\]\s*\{[\s\S]{0,160}settingsNavForward/.test(css))
check('返回滑入', /\.body\[data-nav='back'\]\s*\{[\s\S]{0,160}settingsNavBack/.test(css))
check('前进从右侧来', /@keyframes settingsNavForward[\s\S]{0,200}translate3d\(18px/.test(css))
check('返回从左侧来', /@keyframes settingsNavBack[\s\S]{0,200}translate3d\(-18px/.test(css))
check('内容层带 nav 标记', page.includes("data-nav={hasNavigated.current && !closing ? direction : undefined}"))
check('navKey 变化才重挂载', page.includes('key={navKey}'))
check('首次挂载不重复播', page.includes('hasNavigated') && page.includes('previousNavKey'))
check('方向由上次 page 推导', dialog.includes('previousPage.current !== opened'))
check('子页传入 navKey', dialog.includes('navKey={current.value}') && dialog.includes('navKey="home"'))
check('传入 direction', dialog.includes('direction={direction}'))

console.log('\n减弱动态效果降级')
check('CSS 有 reduced-motion 分支', css.includes('@media (prefers-reduced-motion: reduce)'))
check('降级为纯淡入', /prefers-reduced-motion: reduce\)[\s\S]{0,420}animation-name:\s*settingsPageFade/.test(css))
check('降级时长极短', /prefers-reduced-motion: reduce\)[\s\S]{0,200}animation-duration:\s*0\.01ms/.test(css))
check('JS 侧直接卸载', dialog.includes('prefersReducedMotion()') && /prefersReducedMotion\(\)[\s\S]{0,160}setMounted\(false\)/.test(dialog))

console.log('\n不破坏原有行为')
check('Esc 逐级返回仍在', page.includes("event.key !== 'Escape'"))
check('返回键逐级返回仍在', dialog.includes('closeSettingsSection()'))
check('关闭仍走 closeSettings', dialog.includes('closeSettings()'))
check('子页切换不丢 API Key 表单', dialog.includes('useApiKeyEditor()'))
check('未用 window.setTimeout 全局', !/window\.setTimeout/.test(dialog))
check('过渡只用 transform/opacity', !/animation:[^;]*\b(width|height|top|left|margin|padding)\b/.test(css))

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
