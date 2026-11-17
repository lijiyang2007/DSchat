# DSchat (Mobile)

A mobile AI client rebuilt from the [DeepSeek open-source chat frontend](https://github.com/YanJiuWeiYuanHui/DeepChat) (MIT License).
This build is trimmed for phones and **removes voice calls, video calls (camera) and AI image generation / img2img entirely**.

Upstream: <https://github.com/YanJiuWeiYuanHui/DeepChat>

## Disclaimer / 免责声明

> [!IMPORTANT]
> - **独立第三方客户端**：DSchat 是基于开源前端（MIT License）构建的第三方聊天客户端，与深度求索（DeepSeek）公司**无任何隶属、合作或授权关系**。"DeepSeek" 及相关名称归其权利人所有。
> - **API 使用自担风险**：本应用调用 DeepSeek 官方 API 或任何第三方接口时，产生的**费用、额度消耗、数据传输均由用户自行承担**。请遵守对应服务商的用户协议、付费条款与用量政策。
> - **账号与凭据安全**：登录 DeepSeek 账号使用的是平台官方 OAuth 流程（PKCE）。应用仅在本地存储凭据，不上传到任何第三方服务器；但请自行保管好账号与设备安全。
> - **无任何担保**：本软件按"现状"（AS IS）提供，不附带任何明示或默示的担保。使用本软件造成的任何直接或间接损失（包括但不限于对话数据丢失、API 费用损失、账号风控），作者不承担责任。详见 [MIT License](LICENSE)。
> - **合规使用**：请勿将本应用用于任何违反法律法规或服务条款的用途；生成内容由 AI 产出，请仔细甄别，不构成专业建议。
> - **数据存储**：所有对话、附件、配置均保存在用户本地设备；卸载应用或清除数据将导致本地记录不可恢复，请自行做好备份。

## Differences from upstream

| Item | Upstream DeepChat | This build |
| --- | --- | --- |
| App name | DeepChat | **DSchat** |
| Package id | `com.deepchat.app` | `com.dschat.app` |
| Voice call (live conversation) | yes | **removed** |
| Video call (camera frames) | yes | **removed** |
| AI image generation / img2img | yes | **removed** |
| Speech input (ASR) | yes | kept |
| Read aloud (TTS) | yes | kept |
| Photo / gallery / file attachments | yes | kept (plain attachments via vision/OCR) |

## Kept features

Multi-model (DeepSeek native, OpenAI `/chat/completions`, OpenAI `/responses`, local Ollama / LM Studio / vLLM / LocalAI),
independent capability channels (ASR / TTS / vision / OCR), long-term memory with adjustable cross-chat recall,
branch editing, custom refusal keywords, token usage stats with daily limits, history import/export
(DeepSeek `export_format_version: 3`), and in-app update checks.

## Build the APK

Requires Node.js 22+, pnpm, JDK 17 and Android SDK (platform 34 / build-tools 34.0.0).

```sh
pnpm install
pnpm run build
npx cap sync android
cd android
gradlew.bat assembleRelease         # app/build/outputs/apk/release/app-release.apk
```

Signing uses `~/.android/debug.keystore` by default; override with
`DEEPCHAT_KEYSTORE_FILE` / `DEEPCHAT_KEYSTORE_PASS` / `DEEPCHAT_KEY_ALIAS` / `DEEPCHAT_KEY_PASS`.

## License

[MIT License](LICENSE), as the upstream project.
