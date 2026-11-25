# Uni for macOS · RC1 验收报告

验收日期 2026-11-25。项目基线为 `45f589f80d10e3aad1a2dae1f63712d9f9b29ace`，桌面改动位于 `desktop/macos-rc1`。

## 交付与启动

| 项目 | 实测结果 |
|---|---|
| 应用 | `mac-arm64/Uni.app`，Apple Silicon ARM64 |
| 安装镜像 | `Uni-5.6.0-rc.1-arm64.dmg`，122,085,376 字节，约 116.4 MiB |
| 应用大小 | 约 258 MiB 磁盘占用 |
| 运行时 | Electron 45.5.0，Chromium 156.0.8078.109 |
| Bundle | `com.hyperstackx.uni`，营销版本 `5.6.0`，构建号 `50601` |
| 安装验证 | 校验并只读挂载 DMG，Finder 显示 Uni 图标、背景和 Applications 快捷方式。复制到隔离安装目录后校验签名，并从该副本启动、登录隔离服务 |
| 签名 | 本地 ad-hoc 签名通过 `codesign --verify --deep --strict`。本机没有可用 Developer ID 签名身份，Apple 公证待办 |

原生窗口已从 Finder 双击启动并显示 macOS 窗口控件。最终 DMG 的安装副本登录后显示原有 Sonoma 首页，截图位于交付目录的 `screenshots/Uni-packaged-home.png`。镜像窗口截图为 `screenshots/Uni-dmg-installer.png`。测试服务停止后，打包版显示 Crystal Window 的连接失败和退避提示。

## 集中验证

| 检查 | 结果 | 覆盖 |
|---|---:|---|
| 桌面策略单测 | 7/7 | 裸 HTTPS origin、IPv4 loopback 例外、IPC 顶层发送者、音频权限字段、外链协议、按 origin 分区及通知数据校验 |
| Electron 集成 | 11/11 | 首次连接、沙盒配置、登录及重启恢复、论坛、实际私聊通知、Dock 徽标、通知点击路由、图片预览、权限拒绝、实际双向媒体、静音及音轨释放、断线重新认证和切服隔离 |
| Uni 服务端 Node 回归 | 50/50 | 认证、论坛、数据完整性和通话状态机等 |
| Uni Call Web Chromium 回归 | 14/14 | 原 Web 通话和交互链路 |
| 包结构与安全 | 通过 | Info.plist 格式与麦克风用途说明、ARM64、严格签名、ASAR 文件白名单及源码一致性、已配置 fuses |

Electron 集成使用隔离 Uni 服务端、合成账号和 Chromium 合成麦克风。实际 WebRTC 对等连接两端均以 Opus 接收了 119 个 RTP 音频包，远端播放器处于播放状态。静音改变音轨状态，挂断后两端音轨均结束。测试夹具模拟 macOS 麦克风授权结果并执行真实 Electron 权限检查。系统级弹窗和实体麦克风留待实机验收。通知点击使用真实私聊产生的原生通知对象触发回调，系统横幅与勿扰表现仍需人工验收。外链测试验证发送给系统浏览器的目标并拦截任意弹窗。

装包后核查了 ASAR 内容和与源码的一致性。电子包没有包含数据库、上传目录、运行时配置、测试驱动或合成账号资料。

## 性能观测

M1 Pro、16 GB RAM、macOS 27.3、Retina 2×。从启动 Electron 测试进程到新配置可操作首屏约 **2.49 秒**，含 Playwright 连接和首屏观察开销。此值为单次首启采样，系统文件缓存未清空。

| 场景 | 进程数 | 工作集之和 | 合计 CPU |
|---|---:|---:|---:|
| 登录后的首页空闲 | 7 | 786 MiB | 4.47% |
| 合成双向 Opus 通话 | 7 | 758 MiB | 1.92% |

每项为 Electron `app.getAppMetrics()` 的约 1.6 秒短样本，进程工作集相加会重复统计共享页。WebGL 和 GPU 合成状态均为 enabled，首页实际选择 `webgl1-to-2d` 渲染路径。长期功耗、休眠唤醒、真实设备和外网延迟未包含在采样中。

## 待验收

- Developer ID 签名、公证及跨机器 Gatekeeper 安装。
- 真实麦克风、系统权限从首次授权到撤销、蓝牙输入输出切换。完整音频设备功能沿用 Web Uni Call。
- 目标 HTTPS/WSS 服务、公网跨网络和 TURN 强制中继。当前以隔离 loopback 服务验收。
- 系统通知横幅、专注模式、VoiceOver、全屏及多显示器长期使用。桌面测试已核对控件、通知调用与导航行为。
- 生产部署与公开发布仍独立于本交付，U11 隐私门禁保持原状态。
