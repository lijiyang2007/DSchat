# DSchat (Mobile)

A mobile AI client rebuilt from the [DeepSeek open-source chat frontend](https://github.com/YanJiuWeiYuanHui/DeepChat) (MIT License).
This build is trimmed for phones and **removes voice calls, video calls (camera) and AI image generation / img2img entirely**.

Upstream: <https://github.com/YanJiuWeiYuanHui/DeepChat>

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
