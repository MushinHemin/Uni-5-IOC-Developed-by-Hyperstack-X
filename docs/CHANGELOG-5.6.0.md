# Uni 5.6.0 Napa Valley 更新日志

## macOS 客户端

- 新增独立的 Apple Silicon ARM64 客户端与 Crystal Window，可连接已有 Uni 服务。
- 原生应用菜单、Dock 未读徽标、系统通知、按服务器隔离保存的登录及有限退避重试。
- 正式版应用包与 DMG 从锁定依赖重新构建。Bundle ID 保持一致，构建号为 50602。

## Uni Call 与水晶岛

- 双向 WebRTC/Opus 语音及经认证的 Socket.IO 信令。
- 支持设备选择、静音、接听、拒绝、跨视图通话、断线恢复、通话记录和媒体释放。
- CSS 材质水晶岛支持紧凑和展开状态、连续可反向动画、通话控制和二级音频设置。

## Liquid Crystal 与 Web

- 首页卡片使用 WebGL 采样 Sonoma 壁纸，结合折射、色散、明暗修正与性能降级。
- 优化通知中心的空间过渡、焦点和移动视口，以及减少透明度和减少动效体验。
- 延续 5.5.9 的持久化、安全、数据完整性和移动布局修复。Web、PWA 和桌面共享 Uni 服务端。

[正式发布说明](RELEASE-NOTES-5.6.0.md) · [正式版工程验收](RELEASE-READINESS-5.6.0.md) · [RC1 更新日志](CHANGELOG-5.6.0-rc.1.md) · [Sonoma 5.5.9 更新日志](CHANGELOG-5.5.9.md)
