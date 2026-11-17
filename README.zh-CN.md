# DSchat（手机版）

基于 [DeepSeek 开源对话前端](https://github.com/YanJiuWeiYuanHui/DeepChat) 二次改造的**手机版**多模型 AI 客户端（MIT 开源协议）。
本版本针对手机使用做了裁剪，**已彻底移除语音通话、视频通话（摄像头）、AI 生图/图生图**三项功能。

原项目：<https://github.com/YanJiuWeiYuanHui/DeepChat>

## 相对原版的改动

| 项目 | 原版 DeepChat | 本版 DSchat |
| --- | --- | --- |
| 应用名 | DeepChat | **DSchat** |
| 包名 | `com.deepchat.app` | `com.dschat.app` |
| 语音通话（连续对话 / 实时语音） | 有 | **已删除**（`voiceCall.ts`、通话浮层、通话按钮、通话系统提示词全部移除） |
| 视频通话（摄像头画面） | 有 | **已删除**（摄像头权限、切换前后摄、实时画面帧逻辑全部移除） |
| AI 生图 / 图生图 | 有 | **已删除**（生图渠道设置、生图开关、`<generate_image>` 提示词注入、`/images/generations` 客户端、生图消息块全部移除） |
| 语音输入（ASR） | 有 | 保留 |
| 朗读播报（TTS） | 有 | 保留 |
| 拍照 / 相册 / 文件上传 | 有 | 保留（作为普通附件走视觉/OCR 识别） |

## 保留的核心功能

- **多模型与本地部署**：DeepSeek 原生协议、OpenAI `/chat/completions`、OpenAI `/responses`，以及免 API Key 的本地部署（Ollama / LM Studio / vLLM / LocalAI，支持在线获取模型列表）。
- **多能力独立渠道**：语音识别（ASR）、语音播报（TTS）、视觉识图、文档 OCR 可分别配置接口与密钥。
- **长期记忆与可控策略**：自动提取与手动编辑长期记忆、跨会话记忆召回上限可调、回复分支编辑、自定义关键词拒答。
- **Token 用量统计与每日提醒**、**历史记录导入导出**（兼容 DeepSeek `export_format_version: 3`）、**版本检查与更新公告**。

## 目录说明

```
android/           Capacitor Android 工程（包名 com.dschat.app）
src/               前端源码（React + TypeScript + Zustand）
src/services/      API 客户端、会话存储（IndexedDB）、设置、语音播报
src/components/    界面组件（消息、输入框、设置、侧边栏）
dist/              构建产物（Capacitor 会同步到 android 内）
```

## 本地构建 APK

需要 Node.js 22+、pnpm、JDK 17、Android SDK（platform 34 / build-tools 34.0.0）。

```sh
pnpm install
pnpm run build                      # 打包前端到 dist/
npx cap sync android                # 同步到 Android 工程
cd android
gradlew.bat assembleRelease         # 产物: app/build/outputs/apk/release/app-release.apk
```

签名使用 `~/.android/debug.keystore`（可用 `keytool -genkeypair` 生成），也可用环境变量
`DEEPCHAT_KEYSTORE_FILE` / `DEEPCHAT_KEYSTORE_PASS` / `DEEPCHAT_KEY_ALIAS` / `DEEPCHAT_KEY_PASS` 指定自有签名。

## 开源协议

[MIT License](LICENSE)，遵循原项目协议。
