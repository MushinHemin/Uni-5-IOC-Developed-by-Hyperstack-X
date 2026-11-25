# Uni for macOS

**Uni 5.6 Napa Valley · 5.6.0 · Apple Silicon**

Crystal Window 在隔离的 Electron 视图中运行现有 Uni Web 界面。桌面客户端使用所连接服务的账户、聊天、论坛、通知与 Uni Call。

## 安装与连接

1. 从 [Uni 官方正式发布页](https://github.com/MushinHemin/Uni-5-IOC-Developed-by-Hyperstack-X/releases/tag/v5.6.0) 下载 `Uni-5.6.0-arm64.dmg` 和 `SHA256SUMS.txt`，核对 SHA-256。
2. 打开 DMG，将 **Uni** 拖入 **应用程序**，再从 Finder 启动。
3. 输入可信 Uni 服务器的 HTTPS 地址。地址应只包含来源和可选端口。本机开发测试可显式使用 `http://127.0.0.1:PORT`。
4. 使用 Uni 账户登录。选中 **在此 Mac 上保持登录**后，应用使用 macOS 钥匙串支持的加密存储保存登录信息，在需要时重新认证。
5. 使用 **Uni → 服务器连接设置…** 或 **⌘,** 修改连接地址、清除保存的登录或调整通知。通知内容预览默认关闭。启用**关闭窗口后保持连接**可在关闭窗口时保留连接。**⌘Q** 退出应用并结束当前通话。

macOS 控制麦克风与通知权限。需要检查权限时，使用 **Uni → 麦克风隐私设置…**。应用运行且保持连接时可接收实时事件。

## 构建与验证

在装有 Node/npm 和 macOS Command Line Tools 的 Apple Silicon Mac 进入 `desktop/macos`，执行以下命令。服务端与桌面依赖使用各自的锁文件。

```sh
npm ci
npm test
npm run dev
npm run build
```

构建会由品牌 SVG 生成 1024 px PNG、iconset 和 ICNS。产物位于 `dist/mac-arm64/Uni.app` 和 `dist/Uni-5.6.0-arm64.dmg`。Bundle ID 为 `com.hyperstackx.uni`，营销版本为 `5.6.0`，构建号为 `50602`。

Electron 和 DMG 制作工具需在构建机可用。离线环境可向 electron-builder 传入 `--config.electronDist=/absolute/path/to/electron-v45.5.0-darwin-arm64.zip`，使用已经核对校验值的官方归档，并将 `CUSTOM_DMGBUILD_PATH` 指向兼容的本地 dmgbuild 工具。本轮使用 dmgbuild 2.0.0。

桌面策略测试可独立执行。`test/electron-smoke.cjs` 使用仓库根目录的 Uni 测试服务，须先安装根目录依赖。通过 `UNI_PLAYWRIGHT_MODULE` 指定 Playwright 包位置，必要时通过 `UNI_BROWSER_EXECUTABLE` 指定 Chromium。测试使用临时资料与合成麦克风。

## 签名与系统提示

交付包采用本地 ad-hoc 签名。Developer ID 签名和 Apple 公证尚未完成，请保留 Gatekeeper 和其他系统保护。对外分发签名版时，需使用授权的 Developer ID Application、启用 Hardened Runtime、配置音频输入和 Electron 所需 entitlements，再用 `xcrun notarytool submit` 送审并核验 `xcrun stapler` 附加的公证票据。

[安全说明](MACOS-SECURITY.md) · [正式版验收报告](../../docs/RELEASE-READINESS-5.6.0.md) · [RC1 历史桌面验收](MACOS-TEST-REPORT.md)
