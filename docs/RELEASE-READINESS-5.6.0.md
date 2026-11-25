# Uni 5.6.0 Napa Valley · 正式版验收

验收日期 2026-11-25。正式版以 RC1 提交 `45f589f80d10e3aad1a2dae1f63712d9f9b29ace` 为功能基线，保留原远端 `main` 网页文档提交 `d4ea0436d0b8666007080fefe79963d73a39a2ac` 及 RC1 标签历史。

## 版本及构建

| 项目 | 结果 |
|---|---|
| Web、Manifest、桌面源码版本 | 5.6.0 |
| macOS 平台 | Apple Silicon ARM64 |
| Bundle | `com.hyperstackx.uni`，营销版本 `5.6.0`，构建号 `50602` |
| 桌面运行时 | Electron 45.5.0，Chromium 156.0.8078.109 |
| 构建 | 用锁文件在临时目录重新安装依赖。Electron 官方归档的 SHA-256 通过校验，使用 electron-builder 和 dmgbuild 重新制作 ARM64 DMG |
| 应用启动 | 从正式 APP ZIP 解压出的应用启动成功。设置页显示 5.6.0，原生关于窗口显示 5.6.0（50602），完成隔离测试服务登录 |
| DMG | 校验并只读挂载通过，包内 Uni.app 和 Applications 快捷方式存在，包内签名验证通过 |
| APP ZIP | 使用 ditto 制作。解压后框架符号链接保留，ASAR 和签名通过校验 |

本机共有 0 个有效的代码签名身份。产物采用 ad-hoc 签名，`codesign --verify --deep --strict` 通过。Developer ID 签名和 Apple 公证待办。

## 本轮验证

| 检查 | 通过 |
|---|---:|
| Node 24.22.1 服务端自动化 | 50/50 |
| Uni Call Chromium | 14/14 |
| Napa Fidelity Chromium | 15/15 |
| 桌面策略单测 | 7/7 |
| Electron 集成 | 11/11 |

重新运行了 97 项检查。Node 24.22.1 的隔离生产依赖安装及启动检查通过，首页返回 HTTP 200，Socket.IO 完成 WebSocket 握手，Manifest 和管理员后台显示正式版本。Electron 和 Chromium 的媒体路径使用合成麦克风与隔离账号。Electron 两端实际建立 WebRTC 连接，采样时分别收到 117 个 Opus RTP 音频包并处于播放状态。静音、挂断释放、通知路由、重新认证、切服隔离和未经授权的音频权限拒绝均已覆盖。中文 README 的断言继续验证 Android 历史工程属性。

## 发布材料校验

- 校验应用 ASAR 与桌面源码字节一致，应用内文件范围为品牌资源、桌面入口及必要代码。
- 审查源码和安装附件的文件路径及凭据模式。生产数据、运行时凭据、审计输出和构建缓存在交付附件范围之外。
- README 的六幅图来自本轮实际运行，使用合成内容。已压缩并人工检查，用相对路径引用仓库文档资源。
- 服务端测试、预览及客户端启动均使用隔离数据。保持 Git 历史和 RC1 历史记录。

## 待验收环境

Safari 全流程、iPhone Safari/PWA、实体麦克风、蓝牙、VoiceOver、macOS 系统横幅和专注模式、公网跨网络及强制 TURN 中继、长时功耗仍待完整测试。跨设备安装需进一步完成 Developer ID 签名和 Apple 公证。

[发布说明](RELEASE-NOTES-5.6.0.md) · [桌面构建与使用](../desktop/macos/README-MACOS.md) · [桌面安全说明](../desktop/macos/MACOS-SECURITY.md)
