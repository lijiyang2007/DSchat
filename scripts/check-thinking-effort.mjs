// 思考程度是否真的发到服务端：四档 × 三种协议
// 运行：node scripts/build-checks.mjs && node scripts/check-thinking-effort.mjs
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const store = read('src/services/chat/store.ts')
const openai = read('src/services/api/openai.ts')
const types = read('src/services/api/types.ts')
const client = read('src/services/api/client.ts')

let failures = 0
const check = (name, ok, detail = '') => {
  if (ok) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name} ${detail}`)
  }
}

console.log('请求类型声明三种协议写法')
check('Anthropic output_config', types.includes('output_config?: { effort:'))
check('OpenAI reasoning_effort', types.includes('reasoning_effort?:'))
check('Responses reasoning.effort', types.includes('reasoning?: { effort:'))

console.log('\n映射函数覆盖四档')
check('存在 EFFORT_MAP', store.includes('EFFORT_MAP'))
check('off -> none', /off:\s*'none'/.test(store))
check('low -> low', /low:\s*'low'/.test(store))
check('high -> high', /high:\s*'high'/.test(store))
check('max -> max', /max:\s*'max'/.test(store))
check('存在 buildReasoningPayload', store.includes('buildReasoningPayload'))

console.log('\n三种协议各自带上字段')
check('Responses 走 reasoning', /protocol === 'responses'[\s\S]{0,160}reasoning: \{ effort: mapped \}/.test(store))
check('OpenAI 走 reasoning_effort', /protocol === 'openai' \|\| protocol === 'local'[\s\S]{0,200}reasoning_effort/.test(store))
check('DeepSeek 走 output_config', /output_config: \{ effort:/.test(store))

console.log('\n请求体真正调用映射（不再写死只给 deepseek）')
check('请求体调用 buildReasoningPayload', store.includes('buildReasoningPayload(effort, settings.chatProtocol)'))
check('off 时关闭 thinking', store.includes("thinking: { type: thinkingEnabled ? 'enabled' : 'disabled' }"))
check('thinkingEnabled 跟随档位', /const thinkingEnabled = effort !== 'off'/.test(store))
check(
  '不再有「仅原生协议」的旧判断',
  !store.includes("effort !== 'off' && settings.chatProtocol === 'deepseek'")
)

console.log('\nOpenAI 兼容层把字段放进 payload')
check('payload 不发 Anthropic 写法 thinking 对象', !/thinking: body\.thinking/.test(openai))
check('payload 带 reasoning_effort', openai.includes('body.reasoning_effort ? { reasoning_effort: body.reasoning_effort }'))
check('payload 带 enable_thinking（国产网关写法）', openai.includes('body.enable_thinking !== undefined ? { enable_thinking: body.enable_thinking }'))
check('OpenAI 层 off 也带 enable_thinking=false', /enable_thinking: effort !== 'off'/.test(store))
check('Responses payload 带 reasoning', openai.includes('body.reasoning ? { reasoning: body.reasoning }'))

console.log('\n更新推送只推最新一版')
const updater = read('src/services/updater.ts')
check('改用 releases 列表', updater.includes('RELEASES_LIST_API'))
check('存在 pickHighestRelease', updater.includes('pickHighestRelease'))
check('按版本号比较而非时间（新增降级过滤 pickNewestAbove）', /pickNewestAbove/.test(updater))
check('跳过草稿与预发布', updater.includes('obj.draft === true') && updater.includes('obj.prerelease === true'))
check('解析走 pickHighestRelease', updater.includes('pickHighestRelease(await attempt.json())'))

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
