/**
 * 流式输出检查（v2.7.7 起）。
 *
 * 背景：2.7.1 曾因部分网关流式不稳，整体改成「非流式 + 固定字速打字机」，
 * 但那样用户看到的是「等很久 → 一下子蹦出全文」，观感反而更差。
 * 2.7.7 按官方 chat-demo 的做法恢复真流式：边收边渲染。
 *
 * 本脚本钉死：
 * - 主链路必须走 stream*（不是 fetchOnce 的非流式层）
 * - 打字机层必须已移除
 * - 渲染节流仍由 Markdown 层负责（避免长回答每个字都重解析 AST）
 * - 生成中尾部有光标
 *
 * 纯读源码，随时可跑：node scripts/check-streaming.mjs
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

const store = read('src/services/chat/store.ts')
const assistant = read('src/components/messages/AssistantMessage.tsx')
const markdown = read('src/components/markdown/Markdown.tsx')
const throttle = read('src/components/markdown/useThrottleMarkdownRender.ts')
const client = read('src/services/api/client.ts')
const openai = read('src/services/api/openai.ts')
const renderer = read('src/components/markdown/MarkdownAstRenderer.tsx')
const css = read('src/components/markdown/markdown.css')

console.log('\n一、主链路必须真流式')
check('store 走 streamMessage（官方协议）', /streamMessage\(settings\.apiKey/.test(store))
check('store 走 streamOpenAIMessage', /streamOpenAIMessage\(/.test(store))
check('store 走 streamResponsesMessage', /streamResponsesMessage\(/.test(store))
check(
  '主链路不再用非流式 fetchOnce',
  !/fetchAnthropicMessage|fetchOpenAIMessage|fetchResponsesMessage/.test(store),
  '恢复流式后主链路不能再调 fetchOnce'
)
check(
  '压缩摘要也走流式（同一套传输）',
  /summarizeRounds[\s\S]{0,1500}streamMessage\(/.test(store)
)

console.log('\n二、流式层实现完整')
check('streamMessage 请求 stream: true', /stream: true/.test(client))
check('streamMessage 接受 SSE', /text\/event-stream/.test(client))
check('OpenAI 流式带 stream_options.include_usage', /stream_options/.test(openai))
check('OpenAI 流式解析 reasoning_content', /reasoning_content/.test(openai))

console.log('\n三、打字机层已移除')
check(
  'AssistantMessage 不再用 useTypewriter',
  !assistant.includes('useTypewriter'),
  '恢复真流式后不需要打字机伪装'
)
check(
  '打字机实现文件已删除',
  (() => {
    try {
      read('src/components/markdown/useTypewriter.ts')
      return false
    } catch {
      return true
    }
  })(),
  'src/components/markdown/useTypewriter.ts 应已删除'
)
check(
  'Markdown 不再引用打字机占位符',
  !markdown.includes('TYPEWRITER_SENTINEL')
)

console.log('\n四、渲染节流与光标')
check('Markdown 流式时按渲染耗时节流', /useThrottleMarkdownRender/.test(markdown))
check(
  '节流按渲染耗时倍率 + 上限（官方 chat-demo 同款）',
  throttle.includes('TIME_CONSUMING_RATE') && throttle.includes('MAX_WAIT')
)
check('生成中挂光标', /caret/.test(markdown) && /caret/.test(renderer))
check('光标有闪烁动画', css.includes('ds-typewriter-caret') && css.includes('ds-typewriter-blink'))

console.log(failed === 0 ? '\n全部通过\n' : `\n${failed} 项失败\n`)
process.exit(failed === 0 ? 0 : 1)
