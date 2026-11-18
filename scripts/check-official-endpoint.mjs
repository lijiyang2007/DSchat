/**
 * 官方接口路径与鉴权的回归检查。
 *
 * 背景（2026-11-18）：
 * - 2.7.1 引入非流式层时把 `anthropicUrl()`（返回 /anthropic/v1 前缀）直接当成
 *   Messages 端点 POST，请求打到 /anthropic/v1 被服务端 404，表现为「官方账号
 *   Not Found」。2.7.4 / 2.7.5 修的是配置自愈，没修这条路径，所以账号登录后
 *   仍然用不了。本脚本锁死「拼出来的必须是 /anthropic/v1/messages」。
 * - 2.7.5 把语音锁死到账号 token，但官方 /v1/tools/* 只认 Bearer API Key，
 *   账号 token 一律 401。本脚本锁死「语音只用 Bearer，不用 x-dsh-auth-token」。
 *
 * 纯读源码，随时可跑：node scripts/check-official-endpoint.mjs
 */

import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

let failed = 0
const check = (label, ok, detail = '') => {
  if (ok) {
    console.log(`  ok   ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const client = read('src/services/api/client.ts')
const fetchOnce = read('src/services/api/fetchOnce.ts')
const speech = read('src/services/api/speech.ts')
const store = read('src/services/chat/store.ts')

console.log('\n[官方 Messages 端点]')

// 前缀本身保持 /anthropic/v1
check(
  'anthropicBaseUrl 仍是 /anthropic/v1 前缀',
  /const anthropicBaseUrl = \(\) => `\$\{getApiOrigin\(\)\}\/anthropic\/v1`/.test(client)
)

// 必须存在拼 /messages 的导出，并且它真的拼了 /messages
check(
  '存在 anthropicMessagesUrl 且拼上 /messages',
  /export const anthropicMessagesUrl = \(\) => `\$\{anthropicBaseUrl\(\)\}\/messages`/.test(client)
)

// fetchOnce 必须用全路径，不能再用裸前缀
check(
  'fetchAnthropicMessage 请求的是 Messages 全路径',
  /const response = await request\(anthropicUrl\(\), \{/.test(fetchOnce) &&
    /export const anthropicUrl = anthropicMessagesUrl/.test(client),
  'anthropicUrl 必须指向 /anthropic/v1/messages'
)

// 防止有人把 anthropicUrl 改回前缀
check(
  'anthropicUrl 没有直接等于前缀函数',
  !/export const anthropicUrl = anthropicBaseUrl/.test(client)
)

// 流式路径（备查）仍自己拼 /messages，不能重复拼
check(
  '流式 streamMessage 仍拼 /messages',
  /\$\{anthropicBaseUrl\(\)\}\/messages/.test(client)
)

console.log('\n[官方语音鉴权]')

// tools 地址统一到 /v1/tools
check('toolsBaseUrl 拼 /v1/tools', /return `\$\{root\}\/v1\/tools`/.test(speech))

// 语音只认 Bearer API Key
check(
  '语音用 Authorization: Bearer <API Key>',
  /Authorization: `Bearer \$\{key\}`/.test(speech)
)

// 不能再用账号 token 打语音（注释里提到不算，只看真实代码行）
const speechCode = speech
  .split('\n')
  .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
  .join('\n')
check(
  '语音不再发送 x-dsh-auth-token',
  !/x-dsh-auth-token/.test(speechCode),
  '官方 /v1/tools/* 不接受账号 token，带它必然 401'
)

// 语音 Key 有独立存取
check('语音 Key 独立存储', /chat-demo:speech-api-key/.test(speech))
check('语音 Key 可保存/清除', /export const setSpeechApiKey/.test(speech))

console.log('\n[官方聊天鉴权（回归保护）]')

// 聊天仍然认账号 token 优先
check(
  '聊天鉴权仍是账号 token 优先、API Key 兜底',
  /'x-dsh-auth-token': token/.test(client) && /'x-api-key': apiKey/.test(client)
)

// 2.7.7 起主链路走真流式 streamMessage；它同样用 anthropicUrl()（Messages 全路径）
check(
  '对话主链路用 streamMessage（官方协议全路径）',
  /streamMessage\(settings\.apiKey/.test(store) &&
    /\$\{anthropicBaseUrl\(\)\}\/messages/.test(client)
)

console.log(failed === 0 ? '\n全部通过\n' : `\n${failed} 项失败\n`)
process.exit(failed === 0 ? 0 : 1)
