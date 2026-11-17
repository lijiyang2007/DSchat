// 语音接口路由检查：确认不同渠道配置下，请求发往正确的地址与路径
// 运行：node scripts/check-speech.mjs
import { joinApiPath, isDeepSeekOrigin, normalizeOrigin } from '../.tmp-check/origin.mjs'

let failures = 0
const check = (name, condition, detail = '') => {
  if (condition) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name} ${detail}`)
  }
}

// 复刻 speech.ts 里的判定逻辑
const isChannelConfigured = (custom) =>
  Boolean(custom && (normalizeOrigin(custom.baseUrl) || custom.model.trim()))
const toolsBaseUrl = (origin) => {
  const raw = normalizeOrigin(origin ?? '') || 'https://api.deepseek.com'
  const root = raw.replace(/\/v\d+(?:beta)?(?:\/openai)?$/i, '').replace(/\/+$/, '')
  return `${root}/v1/tools`
}

const routeFor = (custom) => {
  const useCustom = isChannelConfigured(custom) ? custom : undefined
  const useDeepSeekTools = !useCustom || isDeepSeekOrigin(useCustom.baseUrl)
  if (!useDeepSeekTools) {
    return {
      kind: 'openai',
      tts: joinApiPath(useCustom.baseUrl, '/audio/speech'),
      asr: joinApiPath(useCustom.baseUrl, '/audio/transcriptions'),
    }
  }
  const origin = useCustom?.baseUrl.trim() ? normalizeOrigin(useCustom.baseUrl) : undefined
  return { kind: 'deepseek', tts: `${toolsBaseUrl(origin)}/tts`, asr: `${toolsBaseUrl(origin)}/asr` }
}

console.log('joinApiPath')
check(
  '基础地址拼接 /v1',
  joinApiPath('https://api.openai.com', '/audio/speech') ===
    'https://api.openai.com/v1/audio/speech'
)
check(
  '已含 /v1 不重复',
  joinApiPath('https://api.openai.com/v1', '/audio/speech') ===
    'https://api.openai.com/v1/audio/speech'
)
check(
  '结尾斜杠不产生双斜杠（修复项）',
  joinApiPath('https://api.openai.com/v1/', '/audio/speech') ===
    'https://api.openai.com/v1/audio/speech',
  joinApiPath('https://api.openai.com/v1/', '/audio/speech')
)

console.log('\nisDeepSeekOrigin')
check('官方域名', isDeepSeekOrigin('https://api.deepseek.com') === true)
check('官方带 /v1', isDeepSeekOrigin('https://api.deepseek.com/v1') === true)
check('第三方中转不是官方', isDeepSeekOrigin('https://api.someproxy.com') === false)
check('畸形地址不崩溃', isDeepSeekOrigin('not-a-url') === false)

console.log('\n路由判定（本次修复的核心）')
// 场景 1：没配自定义 → 跟主服务
{
  const r = routeFor(undefined)
  check('未配置自定义走官方 tools', r.kind === 'deepseek' && r.tts.endsWith('/v1/tools/tts'), r.tts)
}
// 场景 2：关键场景 —— 自定义填 DeepSeek 官方地址
{
  const r = routeFor({ baseUrl: 'https://api.deepseek.com', apiKey: 'sk-x', model: '' })
  check(
    '自定义=官方地址 → 走 tools 而非 /audio（修复项）',
    r.kind === 'deepseek' && r.tts === 'https://api.deepseek.com/v1/tools/tts',
    r.tts
  )
  check('ASR 同样走官方', r.asr === 'https://api.deepseek.com/v1/tools/asr', r.asr)
}
// 场景 3：自定义填官方但带 /v1
{
  const r = routeFor({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-x', model: '' })
  check('官方地址带 /v1 也能识别', r.kind === 'deepseek', r.kind)
  check('不会拼出 /v1/v1', !r.tts.includes('/v1/v1'), r.tts)
}
// 场景 4：自定义填第三方 OpenAI 兼容
{
  const r = routeFor({ baseUrl: 'https://api.openai.com', apiKey: 'sk-x', model: 'tts-1' })
  check('第三方走 OpenAI 路径', r.kind === 'openai' && r.tts.endsWith('/v1/audio/speech'), r.tts)
}
// 场景 5：只填了模型没填地址 → 视为已配置，但 baseUrl 空 → 回到主服务地址
{
  const r = routeFor({ baseUrl: '', apiKey: '', model: 'whisper-1' })
  check('仅填模型：按已配置处理', isChannelConfigured({ baseUrl: '', model: 'whisper-1' }) === true)
  check('空 baseUrl 不崩溃', typeof r.tts === 'string' && r.tts.length > 0, r.tts)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
