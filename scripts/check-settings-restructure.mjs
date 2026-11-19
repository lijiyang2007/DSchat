/**
 * v2.9.2 检查：第三方编辑页重做 + 官方只开放思考强度 + 模型与接口页精简。
 *
 * 用户这一轮的两件事：
 * 1. 编辑页参照截图重做：「自定义设置 / 思考强度 / 模型目录」三个折叠入口；
 *    官方条目**也能进编辑页，但只允许调思考强度**。
 * 2. 模型与接口页删掉 8 个入口：识图、上下文窗口、思考程度、接口类型、API 地址、
 *    模型、流式输出、压缩开关（功能都挪到编辑页或对话设置）。
 *
 * 运行：node scripts/check-settings-restructure.mjs
 */
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

let failed = 0
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok   ${label}`)
  else {
    failed += 1
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const modelSettings = read('src/components/settings/ModelSettings.tsx')
const editor = read('src/components/settings/ProviderEditor.tsx')
const providerList = read('src/components/settings/ProviderList.tsx')
const dialogState = read('src/components/settings/settingsDialogState.ts')
const providers = read('src/services/providers.ts')
const settings = read('src/services/settings.ts')
const store = read('src/services/chat/store.ts')
const contextUsage = read('src/components/settings/ContextUsage.tsx')
const dialog = read('src/components/settings/SettingsDialog.tsx')
const throttle = read('src/components/markdown/useThrottleMarkdownRender.ts')
const zh = read('src/i18n/zh.ts')
const en = read('src/i18n/en.ts')

console.log('\n一、官方条目可以进编辑页，但只开放思考强度')
check('列表里官方条目也渲染编辑按钮', !providerList.includes("provider.builtin ? (\n                <span"))
check('列表不再显示「登录后自动可用」占位', !providerList.includes("t('providerOfficialLocked')"))
check('openProviderEditor 不再拦官方条目', !/provider\?\.builtin[\s\S]{0,200}providerOfficialLockedToast/.test(dialogState))
check(
  '官方保存时只写思考强度',
  /if \(draft\.builtin\) \{[\s\S]{0,400}updateProvider\(draft\.id, \{\s*thinkingEffort: draft\.thinkingEffort \?\? DEFAULT_THINKING_EFFORT,\s*\}\)/.test(
    editor
  )
)
check('官方保存不写地址/协议/模型目录', !/if \(draft\.builtin\)[\s\S]{0,400}baseUrl: draft\.baseUrl/.test(editor))
check('官方不渲染 API 密钥输入', /draft\.builtin \? \([\s\S]{0,300}providerOfficialBaseUrlHint/.test(editor) && !/provider\.builtin \? null : \(\s*<div className=\{styles\.block\}>\s*<div className=\{styles\.blockLabel\}>/.test(editor))
check('官方不渲染自定义设置折叠', /draft\.builtin \? null : \(\s*<Section/.test(editor))
check('官方不渲染模型目录折叠', /draft\.builtin \? null : \(\s*<Section[\s\S]{0,120}providerModelCatalog/.test(editor))
check('官方仍在用的供应商时同步全局强度', /draft\.id === activeProviderId[\s\S]{0,160}setThinkingEffort/.test(editor))

console.log('\n二、第三方编辑页：三个折叠入口（参照截图布局）')
check('有可复用的折叠区块组件', /const Section = \(/.test(editor))
check('自定义设置可折叠', /title=\{t\('providerCustomSettings'\)\}/.test(editor))
check('思考强度可折叠', /title=\{t\('providerThinkingEffort'\)\}/.test(editor))
check('模型目录可折叠', /title=\{t\('providerModelCatalog'\)\}/.test(editor))
check('默认全部收起', /setCustomOpen\(false\)/.test(editor) && /setThinkingOpen\(false\)/.test(editor) && /setModelsOpen\(false\)/.test(editor))
check('折叠状态各自独立管理', /const \[thinkingOpen, setThinkingOpen\]/.test(editor) && /const \[modelsOpen, setModelsOpen\]/.test(editor))
check('三个入口都用同一个 Section 渲染', (editor.match(/<Section/g) ?? []).length >= 3)
check('折叠按钮带 aria-expanded', /aria-expanded=\{open\}/.test(editor))

console.log('\n三、思考强度按供应商保存（第三方也能调）')
check('Provider 有 thinkingEffort 字段', /thinkingEffort\?: ThinkingEffort/.test(providers))
check('默认强度是 off', /DEFAULT_THINKING_EFFORT: ThinkingEffort = 'off'/.test(providers))
check('官方内置条目默认 off', /thinkingEffort: DEFAULT_THINKING_EFFORT/.test(providers))
check('新增供应商默认 off', /thinkingEffort: DEFAULT_THINKING_EFFORT/.test(settings))
check('setThinkingEffort 写回当前供应商', /export const setThinkingEffort[\s\S]{0,900}item\.id === activeProviderId \? \{ \.\.\.item, thinkingEffort/.test(settings))
check('切换供应商时同步镜像值', /const effort = active\.thinkingEffort \?\? DEFAULT_THINKING_EFFORT/.test(settings) && /thinkingEffort: effort,[\s\S]{0,80}thinking: effort !== 'off'/.test(settings))
check('官方自愈保留思考强度', /repairOfficialProvider[\s\S]{0,400}thinkingEffort: saved\.thinkingEffort/.test(settings))
check('官方自愈仍用内置值重建其余字段', /repairOfficialProvider = \(saved: Provider\): Provider => \(\{\s*\.\.\.createOfficialProvider\(\)/.test(settings))

console.log('\n四、模型与接口页删掉的 8 个入口')
check('① 不再有「图片识别能力」', !modelSettings.includes("t('modelSettingsVisionLabel')"))
check('② 不再有「模型上下文窗口」', !modelSettings.includes("t('modelSettingsContextWindowLabel')"))
check('③ 不再有「思考程度」', !modelSettings.includes("t('modelSettingsThinkingEffortLabel')"))
check('④ 不再有「接口类型」', !modelSettings.includes("t('chatProtocolLabel')"))
check('⑤ 不再有「API 地址」', !modelSettings.includes("t('modelSettingsApiOriginLabel')"))
check('⑥ 不再有「模型（Model）」', !modelSettings.includes("t('modelSettingsModelLabel')"))
check('⑦ 不再有「流式输出」', !modelSettings.includes("t('modelSettingsStreamThrottleLabel')"))
check('⑧ 不再有压缩开关（只留对话设置那份）', !modelSettings.includes("t('modelSettingsAutoCompactLabel')"))
check('保留系统提示词', modelSettings.includes("t('modelSettingsSystemPromptLabel')"))
check('保留 Temperature/TopP/MaxTokens', modelSettings.includes("t('modelSettingsTemperatureLabel')") && modelSettings.includes("t('modelSettingsMaxTokensLabel')"))
check('保留供应商列表', modelSettings.includes('<ProviderList'))
check('保留片段导入', modelSettings.includes('applyConfigSnippet'))
check('保留语音 Key', modelSettings.includes('<SpeechKeyCell'))
check('保留协议与工具开关', modelSettings.includes("t('modelSettingsSafetyCheckLabel')"))
check('保留回复与拒答策略', modelSettings.includes("t('modelSettingsRefusalEnabledLabel')"))

console.log('\n五、功能没被删，只是换了入口')
check('流式输出档位功能仍在（streamThrottle）', /streamThrottle/.test(throttle) && /streamThrottle/.test(settings))
check('对话设置里仍有自动压缩开关', dialog.includes("t('modelSettingsAutoCompactLabel')"))
check('对话设置里仍有压缩档位滑块', dialog.includes('compactLevelSlider'))
check('识图改由模型目录的输入类型决定', /modelSupportsImage\(activeProvider\(settings\)\)/.test(store))
check(
  '识图有兜底：没勾「图片」时按模型名推断',
  /export const modelSupportsImage[\s\S]{0,600}allowsVision\('auto', model\.id, provider\.protocol\)/.test(providers)
)
check('压缩窗口跟当前模型走', /contextWindow: activeContextWindow\(settings\)/.test(store))
check('用量面板也用同一个窗口', /useSettings\(activeContextWindow\)/.test(contextUsage))

console.log('\n六、自动压缩真的会触发（窗口不再永远 1M）')
check('有 activeContextWindow', /export const activeContextWindow/.test(settings))
check('优先用模型目录里的窗口', /const own = model\?\.contextWindow[\s\S]{0,120}return own/.test(settings))
check('没填时按模型名推断再退回全局', /return getContextWindow\(model\?\.id \?\? state\.model, state\.contextWindow\)/.test(settings))
check('主链路不再直接读 settings.contextWindow 当窗口', !/contextWindow: settings\.contextWindow/.test(store))

console.log('\n七、i18n 双语齐备')
const keys = (s) => [...s.matchAll(/^  (\w+):/gm)].map((m) => m[1])
const zhKeys = keys(zh)
const enKeys = keys(en)
check('中文无重复键', new Set(zhKeys).size === zhKeys.length)
check('英文无重复键', new Set(enKeys).size === enKeys.length)
check('zh/en 键集合一致', [...zhKeys].sort().join(',') === [...enKeys].sort().join(','), `${zhKeys.length} vs ${enKeys.length}`)
for (const key of [
  'providerThinkingEffort',
  'providerThinkingEffortHint',
  'providerModelCatalogHint',
  'providerOfficialBaseUrlHint',
]) {
  check(`新增键 ${key} 双语齐备`, zhKeys.includes(key) && enKeys.includes(key))
}

console.log(failed === 0 ? '\n全部通过\n' : `\n${failed} 项失败\n`)
process.exit(failed === 0 ? 0 : 1)
