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

console.log('一、输出管线（2.7.1 非流式 → 2.7.7 恢复真流式）')
// 2.7.1 曾改非流式 + 打字机；2.7.7 按官方 chat-demo 恢复真流式，
// fetchOnce.ts 作为历史实现保留（备查），但主链路不再调用。
check('fetchOnce 历史层仍在（备查）', fetchOnce.includes('export async function* fetchAnthropicMessage'))
check('OpenAI 非流式实现仍在（备查）', /fetchOpenAIMessage[\s\S]{0,900}stream: false/.test(fetchOnce))
check('Responses 非流式实现仍在（备查）', /fetchResponsesMessage[\s\S]{0,900}stream: false/.test(fetchOnce))
check('Anthropic 非流式实现仍在（备查）', /fetchAnthropicMessage[\s\S]{0,900}stream: false/.test(fetchOnce))
check('对话主链路用 streamMessage（真流式）', /streamMessage\(settings\.apiKey/.test(store))
check('对话主链路不再用非流式 fetchOnce', !/fetchAnthropicMessage\(/.test(store))
check('压缩摘要也走流式', store.includes('streamResponsesMessage(') && store.includes('streamOpenAIMessage('))
check('合成统一事件流 emitUnified（备查）', fetchOnce.includes('emitUnified'))
check('合成流以 message_stop 结束（备查）', /emitUnified[\s\S]+message_stop/.test(fetchOnce))

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

console.log('\n五、版本号（双轨制：两段正式版 / 三段测试版，逢九进位）')
const pkgVersion = pkg.version
const gradleVersion = gradle.match(/: '(\d+\.\d+(?:\.\d+)?)'\)/)?.[1] ?? ''
// versionCode = 主×1000 + 次×100 + 补丁；正式版（两段）补丁位记 0
const seg = pkgVersion.split('.').map(Number)
const expectedCode = (seg[0] ?? 0) * 1000 + (seg[1] ?? 0) * 100 + (seg[2] ?? 0)
check(`package.json 与 versionName 一致（${pkgVersion} vs ${gradleVersion}）`, pkgVersion === gradleVersion)
check(`versionName ${pkgVersion}`, gradle.includes(`'${pkgVersion}'`))
check(`versionCode ${expectedCode} 与版本号对应`, gradle.includes(`: ${expectedCode})`))
check('i18n 双语键一致', (() => {
  const keys = (src) => [...src.matchAll(/^  (\w+):/gm)].map((m) => m[1]).sort().join(',')
  return keys(zh) === keys(en)
})())
check('新增 i18n 键齐全', ['providerOfficialLocked', 'providerOfficialLockedToast', 'updateAnnouncementEntryLabel', 'sponsorEntryLabel', 'sponsorPageIntro'].every((k) => zh.includes(`  ${k}:`)))

console.log('\n六、思考关闭与官方自愈（2.7.4/2.7.5）')
check('off 档也发协议字段（enable_thinking:false）', /buildReasoningPayload\(effort, settings\.chatProtocol\)/.test(store) && !/\?\s*buildReasoningPayload/.test(store))
check('openai 协议 off 带 enable_thinking:false', /enable_thinking: effort !== 'off'/.test(store))
check('官方条目启动时自愈', /createOfficialProvider\(\), apiKey: item\.apiKey/.test(read('src/services/settings.ts')))
check('官方条目切换时自愈', /setActiveProvider[\s\S]{0,900}dirty[\s\S]{0,400}repaired/.test(read('src/services/settings.ts')))
check('anthropic-beta 按文件引用携带', /fetchAnthropicMessage[\s\S]{0,200}hasFileRef/.test(read('src/services/api/fetchOnce.ts')))
// 2.7.7 真流式：streamMessage 自己按 body 内容判定是否带 files beta，
// 主链路不再需要显式传 hasFileRef
check('streamMessage 内部按文件引用带 beta', /hasFile\(body\)/.test(read('src/services/api/client.ts')))
const settingsSrc = read('src/services/settings.ts')
check('启动时修复运行时扁平键（2.7.5）', /repairOfficialRuntimeKeys[\s\S]{0,700}setRuntimeApiOrigin\(official\.baseUrl\)/.test(settingsSrc))
check('运行时地址在自愈后读取', settingsSrc.indexOf('repairOfficialRuntimeKeys()') < settingsSrc.indexOf('const initialApiOrigin'))
check('压缩提示仍在（2.7.2 功能保留）', store.includes('compacting: Record<string, boolean>') && read('src/components/messages/AssistantMessage.tsx').includes('contextCompactingHint'))

console.log('\n七、语音走官方 tools 接口（2.7.5 起，2.7.6 修正鉴权）')
const speech = read('src/services/api/speech.ts')
check('speech 不再接受自定义渠道', !speech.includes('SpeechChannelOverride') && !/custom\?/.test(speech))
check('语音固定官方 /v1/tools 路径', speech.includes('/v1/tools'))
// 2.7.5 曾锁死账号 token，实测官方 /v1/tools/* 只认 Bearer API Key，账号 token 必然 401
check(
  '语音鉴权用 Bearer API Key（官方 tools 接口不接受账号 token）',
  /Authorization: `Bearer \$\{key\}`/.test(speech) &&
    !speech
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n')
      .includes('x-dsh-auth-token')
)
check('未配置 Key 抛固定错误并有就绪判定', /speechAccountError/.test(speech) && /speechAccountReady/.test(speech))
check('朗读入口未配置 Key 时拦截', /speechAccountReady\(\)/.test(read('src/services/speech/readAloud.ts')))
check('语音输入未配置 Key 时拦截', /speechAccountReady\(\)/.test(read('src/components/chatInput/useVoiceInput.ts')))
check('设置页渠道卡片已移除', !read('src/components/settings/ModelSettings.tsx').includes('CapabilityChannelCard'))
check('未配置 Key 的提示文案齐备', zh.includes('ttsNeedsAccount') && zh.includes('speechRequiresAccount') && en.includes('ttsNeedsAccount'))
check('设置页有语音 API Key 输入框', read('src/components/settings/ModelSettings.tsx').includes('SpeechKeyCell'))

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
