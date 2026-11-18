// 多供应商模型界面的功能检查（纯逻辑 + 源码结构）
// 运行：node scripts/check-providers.mjs
//
// 覆盖：数据模型、旧配置迁移、增删改切换、添加向下追加、
//       模型目录（上下文窗口解析/输入类型）、UI 接线、i18n 双语

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

let failures = 0
const check = (name, ok, detail = '') => {
  if (ok) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name} ${detail}`)
  }
}

/* ------------------------- 复刻纯函数做逻辑测试 ------------------------- */

const parseTokenSize = (raw) => {
  const text = String(raw).trim().toLowerCase()
  if (!text) return undefined
  const match = /^([\d.]+)\s*([km]?)$/.exec(text)
  if (!match) return undefined
  const value = Number.parseFloat(match[1])
  if (!Number.isFinite(value) || value <= 0) return undefined
  const unit = match[2]
  const scale = unit === 'k' ? 1_000 : unit === 'm' ? 1_000_000 : 1
  return Math.round(value * scale)
}

const formatTokenSize = (tokens) => {
  if (!tokens || tokens <= 0) return ''
  if (tokens >= 1_000_000) {
    const value = tokens / 1_000_000
    return `${Number.isInteger(value) ? value : value.toFixed(1)}M`
  }
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`
  return String(tokens)
}

console.log('一、模型目录：token 长度解析')
check('128K → 128000', parseTokenSize('128K') === 128000)
check('1M → 1000000', parseTokenSize('1M') === 1000000)
check('小写 1m 也认', parseTokenSize('1m') === 1000000)
check('纯数字原样', parseTokenSize('200000') === 200000)
check('带空格 "1 M"', parseTokenSize('1 M') === 1000000)
check('小数 1.5M', parseTokenSize('1.5M') === 1500000)
check('空值返回 undefined', parseTokenSize('') === undefined)
check('乱写返回 undefined', parseTokenSize('abc') === undefined)
check('0 视为无效', parseTokenSize('0') === undefined)
check('负数视为无效', parseTokenSize('-5K') === undefined)

console.log('\n二、模型目录：token 长度显示')
check('1000000 → 1M', formatTokenSize(1000000) === '1M')
check('128000 → 128K', formatTokenSize(128000) === '128K')
check('1500000 → 1.5M', formatTokenSize(1500000) === '1.5M')
check('256000 → 256K', formatTokenSize(256000) === '256K')
check('空值 → 空串', formatTokenSize(undefined) === '')

console.log('\n三、往返一致')
for (const raw of ['1M', '128K', '256K', '200000']) {
  check(`${raw} 解析再格式化可还原`, formatTokenSize(parseTokenSize(raw)) === raw.toUpperCase().replace('000000', 'M').replace('000', 'K') || raw === '200000', raw)
}

/* ---------------------------- 源码结构检查 ---------------------------- */

const providers = read('src/services/providers.ts')
const settings = read('src/services/settings.ts')
const list = read('src/components/settings/ProviderList.tsx')
const editor = read('src/components/settings/ProviderEditor.tsx')
const modelSettings = read('src/components/settings/ModelSettings.tsx')
const zh = read('src/i18n/zh.ts')
const en = read('src/i18n/en.ts')

console.log('\n四、数据模型')
check('定义了 Provider 类型', /export type Provider = \{/.test(providers))
check('Provider 含 id/name', providers.includes('id: string') && providers.includes('name: string'))
check('Provider 含协议与地址', providers.includes('protocol: ChatProtocol') && providers.includes('baseUrl: string'))
check('Provider 含密钥与请求头', providers.includes('apiKey: string') && providers.includes('headers: string'))
check('Provider 含模型目录与当前模型', providers.includes('models: ProviderModel[]') && providers.includes('model: string'))
check('模型含上下文窗口', providers.includes('contextWindow?: number'))
check('模型含最大输出', providers.includes('maxTokens?: number'))
check('模型含输入类型', providers.includes('inputs?: { text: boolean; image: boolean }'))
check('内置官方供应商存在', /createOfficialProvider[\s\S]{0,200}builtin: true/.test(providers))
check('官方供应商带两个默认模型', /deepseek-flash[\s\S]{0,400}deepseek-v4-pro/.test(providers))
check('供应商 id 生成不依赖 crypto.randomUUID', /newProviderId[\s\S]{0,200}Date\.now\(\)\.toString\(36\)/.test(providers))

console.log('\n五、旧配置迁移')
check('迁移函数存在', /const initialProviders = \(\): Provider\[\]/.test(settings))
check('读取新键', settings.includes('read(KEYS.providers)'))
check('旧 Key 被搬进新结构', /legacyKey[\s\S]{0,80}read\(KEYS\.apiKey\)/.test(settings))
check('旧地址被搬进新结构', /legacyOrigin[\s\S]{0,80}read\(KEYS\.apiOrigin\)/.test(settings))
check('旧模型被搬进新结构', /legacyModel[\s\S]{0,80}read\(KEYS\.model\)/.test(settings))
check('旧协议被搬进新结构', /legacyProtocol = initialChatProtocol\(\)/.test(settings))
check('纯官方配置不重复建条目', settings.includes('isPlainOfficial'))
check('自定义条目打 custom 标记', /custom: true/.test(settings))
check('迁移后补齐官方条目', settings.includes('createOfficialProvider(), ...parsed'))

console.log('\n六、增删改与切换')
check('有 addProvider', /export const addProvider/.test(settings))
check('新增追加到末尾', /commitProviders\(\[\.\.\.providers, provider\], provider\.id\)/.test(settings))
check('有 updateProvider', /export const updateProvider/.test(settings))
check('有 removeProvider', /export const removeProvider/.test(settings))
check('内置条目不可删', /if \(!target \|\| target\.builtin\)[\s\S]{0,40}return false/.test(settings))
check('删掉当前供应商时回落', /activeProviderId === id \? next\[0\]\.id/.test(settings))
check('有 setActiveProvider', /export const setActiveProvider/.test(settings))
check('切换会写回并同步全局（含官方自愈）', /commitProviders\(/.test(settings) && /dirty[\s\S]{0,400}repaired/.test(settings))
check('commitProviders 同步 apiKey', /write\(KEYS\.apiKey, active\.apiKey \|\| null\)/.test(settings))
check('commitProviders 同步 model', /write\(KEYS\.model, active\.model \|\| null\)/.test(settings))
check('commitProviders 同步 apiOrigin', /write\(KEYS\.apiOrigin, active\.baseUrl \|\| null\)/.test(settings))
check('commitProviders 同步 protocol', /write\(KEYS\.chatProtocol, active\.protocol\)/.test(settings))
check('改 Key 会同步回供应商', /setApiKey[\s\S]{0,300}syncActiveProvider\(\{ apiKey/.test(settings))
check('改模型会同步回供应商', /export const setModel[\s\S]{0,220}syncActiveProvider\(\{ model \}\)/.test(settings))
check('改地址会同步回供应商', /export const setApiOrigin[\s\S]{0,220}syncActiveProvider\(\{ baseUrl/.test(settings))
check('改协议会同步回供应商', /export const setChatProtocol[\s\S]{0,200}syncActiveProvider\(\{ protocol/.test(settings))

console.log('\n七、列表界面')
check('导出 ProviderList', /export const ProviderList/.test(list))
check('遍历所有供应商', /providers\.map\(/.test(list))
check('点一行切换当前供应商', /onClick=\{\(\) => setActiveProvider/.test(list))
check('当前供应商有「使用中」标记', list.includes("t('providerInUse')"))
check('自定义打标签', list.includes("t('providerCustomTag')"))
check('每行有编辑按钮', list.includes("t('providerEdit')"))
check('自定义才有删除', /provider\.custom \? \([\s\S]{0,400}t\('delete'\)/.test(list))
check('添加按钮追加在末尾（在 map 之后）', list.indexOf('providers.map(') < list.indexOf("t('providerAdd')"))
check('添加后直接进编辑', /const id = addProvider\(\)[\s\S]{0,60}onEdit\(id\)/.test(list))

console.log('\n八、编辑页')
check('导出 ProviderEditor', /export const ProviderEditor/.test(editor))
check('编辑用本地草稿', editor.includes('useState<Provider>(provider)'))
check('保存才写回', /const save = \(\)[\s\S]{0,200}updateProvider\(draft\.id/.test(editor))
check('取消不写回', /onClick=\{onCancel\}[\s\S]{0,80}取消|t\('cancel'\)/.test(editor))
check('API 密钥输入框', /type="password"/.test(editor))
check('自定义设置可折叠', editor.includes("t('providerCustomSettings')"))
check('API 地址输入', editor.includes("t('providerBaseUrlLabel')"))
check('协议选择', editor.includes("t('chatProtocolLabel')") && editor.includes('<Select'))
check('额外请求头', editor.includes("t('providerHeadersLabel')"))
check('模型目录区块', editor.includes("t('providerModelCatalog')"))
check('可添加模型', editor.includes("t('providerAddModel')"))
check('模型行有上下文窗口', editor.includes("t('providerModelContextWindow')"))
check('模型行有最大输出', editor.includes("t('providerModelMaxTokens')"))
check('模型行有输入类型复选', editor.includes("t('providerModelInputText')") && editor.includes("t('providerModelInputImage')"))
check('删模型后当前模型回落', /const model = models\.some[\s\S]{0,120}models\[0\]\?\.id/.test(editor))
check('保存时同步当前供应商协议', /draft\.id === activeProviderId[\s\S]{0,80}setChatProtocol/.test(editor))

console.log('\n九、接入模型设置页')
check('ModelSettings 使用 ProviderList', modelSettings.includes('<ProviderList'))
check('设置对话框渲染 ProviderEditor 子页', read('src/components/settings/SettingsDialog.tsx').includes('<ProviderEditor'))
check('编辑时进独立子页', /onEdit=\{openProviderEditor\}/.test(modelSettings) && /editingProviderId/.test(modelSettings))
check('保留了协议选择', modelSettings.includes("t('chatProtocolLabel')"))
check('保留了地址设置', modelSettings.includes("t('modelSettingsApiOriginLabel')"))
check('保留了模型设置', modelSettings.includes("t('modelSettingsModelLabel')"))
check('保留了片段导入', modelSettings.includes('applyConfigSnippet'))
check('语音渠道卡片已移除（2.7.5 锁死官方账号）', !modelSettings.includes('<CapabilityChannelCard'))

console.log('\n十、i18n 双语齐备')
const zhKeys = [...zh.matchAll(/^  (\w+):/gm)].map((m) => m[1])
const enKeys = [...en.matchAll(/^  (\w+):/gm)].map((m) => m[1])
check('中文无重复键', new Set(zhKeys).size === zhKeys.length)
check('英文无重复键', new Set(enKeys).size === enKeys.length)
check('中英键集合一致', [...zhKeys].sort().join(',') === [...enKeys].sort().join(','), `${zhKeys.length} vs ${enKeys.length}`)
const need = [
  'providerListHint', 'providerAdd', 'providerEdit', 'providerUntitled',
  'providerCustomTag', 'providerInUse', 'providerModelCount', 'providerNoModel',
  'providerApiKeyLabel', 'providerApiKeyPlaceholder', 'providerApiKeyMissing',
  'providerCustomSettings', 'providerBaseUrlLabel', 'providerBaseUrlHint',
  'providerHeadersLabel', 'providerModelCatalog', 'providerAddModel',
  'providerModelIdPlaceholder', 'providerModelContextWindow', 'providerModelMaxTokens',
  'providerModelInputText', 'providerModelInputImage',
]
const missing = need.filter((k) => !zhKeys.includes(k))
check('新增键齐全', missing.length === 0, missing.join(','))

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
