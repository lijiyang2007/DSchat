# 版本发布流程（每次大更新都这么做）

仓库：<https://github.com/lijiyang2007/DSchat>

## 一、改版本号（三处，必须同步）

| 文件 | 字段 | 规则 |
| --- | --- | --- |
| `package.json` | `version` | 语义化版本，如 `2.2.0` |
| `android/app/build.gradle` | `versionCode` 默认值 | 整数，必须递增：`2200` |
| `android/app/build.gradle` | `versionName` 默认值 | 与 `package.json` 一致：`'2.2.0'` |

> `versionCode` 决定 Android 能不能覆盖升级，**只许加不许减**。
> 规则：`大版本*1000 + 次版本*100 + 修订`，例如 2.1.0 → `2100`，2.2.3 → `2203`。

## 二、提交并打 tag

```sh
git add -A
git commit -m "feat: DSchat 2.2.0 - 本次更新说明"
git push origin main

git tag -a v2.2.0 -m "DSchat 2.2.0"
git push origin v2.2.0      # ← 推送 tag 后 CI 自动构建并发布
```

推 tag 会触发 `.github/workflows/android-release.yml`：
自动跑类型检查与 lint → 构建前端 → 同步 Android → 打签名 APK → 发布到 Releases。

## 三、确认结果

- 构建进度：<https://github.com/lijiyang2007/DSchat/actions>
- 发布页：<https://github.com/lijiyang2007/DSchat/releases>

产物名固定为 `DSchat-v2.2.0.apk`。应用内「检查更新」会读这个 Release，
所以 **tag 名必须与 versionName 对应**，用户才能正确收到更新提示。

## 四、签名密钥（只需配置一次）

CI 必须用**与本机一致的签名证书**，否则用户无法覆盖升级。

1. 到 <https://github.com/lijiyang2007/DSchat/settings/secrets/actions>
2. 新建 Secret：`SIGNING_KEYSTORE_BASE64`
   值是 `~/.android/debug.keystore` 的 Base64（本机已导出到桌面 `dschat-keystore-base64.txt`）
3. 可选 Secret（不填则用默认值）：

   | Secret | 默认 |
   | --- | --- |
   | `SIGNING_KEYSTORE_PASS` | `android` |
   | `SIGNING_KEY_ALIAS` | `androiddebugkey` |
   | `SIGNING_KEY_PASS` | `android` |

> 本机证书 SHA-256：`095FFDB006C796733F55B5BBD7C911F347EAEB9F1F2D83C902A9918664DD0D28`
> 换证书会导致老用户无法覆盖升级，只能卸载重装。
