# Uni 5.6 Napa Valley 正式版

## Sonoma 世代的最终进化

Uni 5.6 Napa Valley 将聊天、社区、实时双向语音与独立桌面客户端带到同一版本。这是 Sonoma 世代的最后一次重大功能更新。

从浏览器走向独立应用，从文字迈向真实声音，从磨砂水晶迈向液态水晶。

### 全新 Uni for macOS

面向 Apple Silicon 的独立客户端以 Crystal Window 承载 Uni。窗口保留 macOS 原生控件，应用提供系统菜单、Dock 未读徽标、系统通知、独立服务器设置及可选的登录保持。首次运行输入可信 Uni 服务器的 HTTPS 地址，即可使用该服务器的账户、聊天、社区和 Uni Call。

### 全新 Uni Call

Uni Call 支持一对一实时语音，使用 WebRTC 传输双向 Opus 音频，使用 Socket.IO 承载信令。支持接听、拒绝、取消、挂断、静音、音频设备选择、网络质量提示和 RTT 区间。连接中断时沿用既有恢复流程和 ICE 重启，通话结束后记录结果并释放媒体资源。

### 全新 Uni Call Island

水晶岛位于应用顶部，通话控制可跨页面使用。胶囊紧凑与展开状态之间采用可反向的 380 ms 连续过渡，保留悬停反馈、彩色电话按钮与二级音频设置。水晶岛使用 CSS 背景透射与边缘高光。

### 全新 Liquid Crystal

三张首页导航卡片使用 WebGL 重采样 Sonoma 壁纸。折射集中在玻璃边缘，伴随细微 RGB 色散、局部明暗补偿和材质降级。基于 Apple 公开设计资料调整了首页材质层级、通知中心动效、键盘焦点与响应式布局。

### 体验、安全与性能优化

- 桌面客户端隔离本地设置与远端 Uni 页面，校验导航、原生消息和音频权限。切换服务器时清除原服务器保存的登录，不同来源使用独立会话分区。
- 连接失败时以有限次数退避重试。通知消费既有服务器事件并去重，默认隐藏消息预览。
- 保留 Sonoma 的消息持久化、会话撤销、上传验证、历史分页和论坛数据完整性修复。
- WebGL 继续按需更新，减少透明度和减少动效偏好在桌面与 Web 中继续生效。

### 下载与安装

- [Uni-5.6.0-arm64.dmg](https://github.com/MushinHemin/Uni-5-IOC-Developed-by-Hyperstack-X/releases/download/v5.6.0/Uni-5.6.0-arm64.dmg)
- [Uni-5.6.0-arm64.app.zip](https://github.com/MushinHemin/Uni-5-IOC-Developed-by-Hyperstack-X/releases/download/v5.6.0/Uni-5.6.0-arm64.app.zip)
- [Uni-5.6.0-macOS-source.zip](https://github.com/MushinHemin/Uni-5-IOC-Developed-by-Hyperstack-X/releases/download/v5.6.0/Uni-5.6.0-macOS-source.zip)
- [SHA256SUMS.txt](https://github.com/MushinHemin/Uni-5-IOC-Developed-by-Hyperstack-X/releases/download/v5.6.0/SHA256SUMS.txt)

下载后核对 SHA-256，打开 DMG 并将 Uni 拖入「应用程序」。ZIP 方式可解压得到同一应用。桌面客户端需要连接已有 Uni 服务。Web/PWA 服务端安装见[项目主页](https://github.com/MushinHemin/Uni-5-IOC-Developed-by-Hyperstack-X)。

### 工程验收

| 检查 | 正式版结果 |
|---|---:|
| Node 24.22.1 服务端回归 | 50/50 |
| Uni Call Chromium | 14/14 |
| Napa Fidelity Chromium | 15/15 |
| 桌面安全策略 | 7/7 |
| Electron 集成 | 11/11 |

Chrome 系列浏览器与 Electron 使用合成麦克风通过实际双向 Opus 验收。最终 ARM64 应用已启动，关于窗口显示 5.6.0（50602）。DMG 通过校验并挂载，应用 ZIP 解压后通过严格签名验证。

### 已知限制

macOS 安装包采用本地 ad-hoc 签名。Developer ID 签名与 Apple 公证尚未完成，部分设备可能显示提示或限制打开。请从官方项目仓库获取文件、验证校验值，并保留系统安全保护。

实体麦克风、蓝牙设备、Safari、iPhone Safari/PWA、系统通知横幅与专注模式、VoiceOver、长时间功耗以及公网跨网络和强制 TURN 中继仍待完整验收。

### 结语

全新形态，真实声音，澄澈世界。

**A new form. A real voice. A clearer world.**

由 Hyperstack X 设计与开发。
