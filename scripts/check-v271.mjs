// v2.7.1 功能检查：取消流式 / 官方账号锁定与能力 / 应用内更新公告 / 感谢赞助 / 版本规则
// 运行：node scripts/build-checks.mjs && node scripts/check-v271.mjs
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { allowsVision } from '../.tmp-check/vision.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const fetchOnce = read('src/services/api/fetchOnce.ts')
const store = read('src/services/chat/store.ts')
const providers = read('src/services/providers.ts')
const providerList = read('src/components/settings/ProviderList.tsx')
const dialogState = read('src/components/settings/settingsDialogState.ts')
const settingsDialog = read('src/components/settings/SettingsDialog.tsx')
const sponsors = read('src/services/sponsors.ts')
const sponsorPage = read('src/components/settings/SponsorSettings.tsx')
const pkg = JSON.parse(read('package.json'))
const gradle = read('android/app/build.gradle')
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

console.log('一、取消流式（v2.7.1 核心）')
check('有 fetchOnce 非流式层', fetchOnce.includes('export async function* fetchAnthropicMessage'))
check('OpenAI 非流式 stream:false', /fetchOpenAIMessage[\s\S]{0,900}stream: false/.test(fetchOnce))
check('Responses 非流式 stream:false', /fetchResponsesMessage[\s\S]{0,900}stream: false/.test(fetchOnce))
check('Anthropic 非流式 stream:false', /fetchAnthropicMessage[\s\S]{0,900}stream: false/.test(fetchOnce))
check('对话主链路不再用 streamMessage', !store.includes('streamMessage('))
check('对话主链路用 fetchAnthropicMessage', store.includes('fetchAnthropicMessage(settings.apiKey'))
check('压缩摘要也走非流式', store.includes('fetchResponsesMessage(') && store.includes('fetchOpenAIMessage('))
check('合成统一事件流 emitUnified', fetchOnce.includes('emitUnified'))
check('合成流以 message_stop 结束', /emitUnified[\s\S]+message_stop/.test(fetchOnce))

console.log('\n二、官方账号锁定与能力拉满')
check('官方条目不再渲染编辑按钮', !/provider\.builtin \? \(\s*<Button/.test(providerList) && providerList.includes('providerOfficialLocked'))
check('openProviderEditor 拦截官方条目', /openProviderEditor[\s\S]{0,300}builtin[\s\S]{0,200}showToast/.test(dialogState))
check('官方 flash maxTokens 65536', providers.includes('maxTokens: 65536'))
check('官方 flash 上下文 1M', providers.includes('contextWindow: 1_000_000'))
check('官方 flash 可看图', providers.includes("inputs: { text: true, image: true }"))
check('deepseek-flash 官方协议可看图', allowsVision('auto', 'deepseek-flash', 'deepseek') === true)
check('deepseek-v4-pro 官方协议可看图', allowsVision('auto', 'deepseek-v4-pro', 'deepseek') === true)
check('deepseek-chat 官方协议仍不看图', allowsVision('auto', 'deepseek-chat', 'deepseek') === false)

console.log('\n三、应用内更新公告入口')
check('设置主页有更新公告入口', settingsDialog.includes("t('updateAnnouncementEntryLabel')"))
check('入口可打开公告弹窗', settingsDialog.includes('openUpdateModal()'))
check('无缓存时先检查更新', settingsDialog.includes('checkForUpdates({ manual: true })'))
check('公告弹窗复用（UpdateModal 已存在）', read('src/components/settings/UpdateModal.tsx').includes('updateAnnouncementTitle'))

console.log('\n四、感谢赞助')
check('名单数据：西***', sponsors.includes("'西***'"))
check('名单数据：cyra', sponsors.includes("'cyra'"))
check('设置主页有赞助入口', settingsDialog.includes("t('sponsorEntryLabel')") && settingsDialog.includes("open('sponsor')"))
check('sponsor 子页已挂进 renderSection', settingsDialog.includes('<SponsorSettings />'))
check('赞助页展示名单', sponsorPage.includes('SPONSOR_NAMES.map'))
check('新增图标 IconHeartOutline16', read('src/components/base/icons.tsx').includes('IconHeartOutline16'))

console.log('\n五、版本规则 v2.7.1')
check('package.json 2.7.1', pkg.version === '2.7.1')
check('versionName 2.7.1', gradle.includes("'2.7.1'"))
check('versionCode 2701', gradle.includes('2701'))
check('i18n 双语键一致', (() => {
  const keys = (src) => [...src.matchAll(/^  (\w+):/gm)].map((m) => m[1]).sort().join(',')
  return keys(zh) === keys(en)
})())
check('新增 i18n 键齐全', ['providerOfficialLocked', 'providerOfficialLockedToast', 'updateAnnouncementEntryLabel', 'sponsorEntryLabel', 'sponsorPageIntro'].every((k) => zh.includes(`  ${k}:`)))

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
