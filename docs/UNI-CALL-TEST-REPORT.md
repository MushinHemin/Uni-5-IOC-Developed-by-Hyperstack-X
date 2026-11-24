# Uni Call · 2026-11-24 工程验收

一对一通话已完成本地工程验证。两套独立 Chromium 浏览器上下文使用合成账号、合成麦克风、实际 Socket.IO 服务器和实际 WebRTC 音频链路。Safari 实机、公网严格 NAT、移动网络与 TURN 中继仍待验收。

|检查|实际结果|
|---|---|
|Node 套件|**50/50**。包括 44 项已有聊天、上传、权限、论坛、通知和移动端测试及 6 项 Uni Call 服务端测试。|
|Uni Call 浏览器|**10/10**。Microsoft Edge Chromium 157.0.4341.46。包括实际私聊入口、来电不抢焦点、双向音频、静音、音量、前端导航、断线重登、挂断清理、权限拒绝、移动与横屏、多方竞态。|
|既有 Napa Fidelity 浏览器|**15/15**。首页、光学采样、通知互动、减少透明度与动态效果、布局继续通过。|
|浏览器媒体|两端实际选中 `audio/opus`。采样时 A、B 分别收 20、21 个 RTP 音频包，远端轨均 live、音频元素在播放，累计音频能量均非零。能量为合成源统计，无法推断真实语音音质。|
|会话恢复|模拟 Socket transport close，双方暂停发送。旧账号状态清空，同一页面重新登录后观察到 ICE ufrag 改变，原 PeerConnection 继续使用。服务端额外覆盖恢复密钥、跨账号拒绝、终止后信令和重试耗尽。|
|资源释放|挂断后两端采集轨为 ended、PeerConnection 为 closed、AudioContext 为 closed，远端 audio.srcObject 清空。SQLite 只有一条完成记录，并能通过真实私聊历史读取。|
|请求边界|服务端验证离线、忙线、超时、同时呼叫、多设备竞争、重复接听与终止、信令轮次和 SDP 限制、账号限流、登出／封禁／会话撤销。|
|浏览器拒绝权限|测试以 NotAllowedError 注入权限拒绝，检查不会发出呼叫或写历史。真实 Safari 权限对话和实体设备选择待验收。|
|布局|1440×960 桌面、390×844 深色竖屏、844×390 横屏。横屏设备列表可滚动，挂断按钮保留在可见区域。模拟减少动态和减少透明度生效。|
|Safari|Safari WebDriver 拒绝创建会话，提示本机开发者设置未启用 Allow remote automation。本轮无 Safari 媒体和截图通过记录。|
|TURN|UDP/TCP/TLS URL、relay 策略与 coturn HMAC 凭据有自动化验证。授权公网 TURN 与真实中继选中未测。|
|性能|通话与恢复使用同一 PeerConnection，关停链路可观察。实际设备 CPU、GPU、电池、长通话内存及并发负载待测。|

前几次验证保留在输出目录。修复了隔离浏览器因动态端口未列入测试 origin 而无法连接、媒体测试过早读取统计、横屏挂断按钮滚出可视区域等问题。最终统计来自修复后的实际运行。

## 本地复验

在项目目录使用现有依赖。预览复制前端资源到临时路径，生成独立 SQLite 和上传目录，只绑定 127.0.0.1。关闭预览会清理该临时目录。

```sh
cd '/Users/mushin/Desktop/beluga-chat_副本'
node scripts/preview-uni-call.cjs
npm test
```

打开预览输出的地址，使用独立窗口或浏览器 profile 注册两个合成账号。打开双方私聊，从通话按钮发起并接听。若在同一设备人工双向讲话，建议使用耳机避免回授。自动化可以改用内置合成媒体。

```sh
UNI_PLAYWRIGHT_MODULE='/Users/mushin/Documents/Codex/2026-11-06/uni-5-sonoma-uni-5-sonoma/work/audit-tools/node_modules/playwright' \
UNI_BROWSER_EXECUTABLE='/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' \
UNI_VISUAL_OUTPUT='/tmp/uni-call-visual-recheck' \
node test/browser/uni-call.cjs
```

已有 Fidelity 使用 `scripts/preview-napa.cjs` 的专用合成 HTTP 预览运行 `test/browser/napa-fidelity.cjs`。该预览仅用于设计回归，Uni Call 的验证使用上面的真实 Socket.IO 隔离服务。

## Safari 与双设备清单

1. 在独立 macOS Safari 窗口打开隔离预览，另一窗口或 Chromium 使用另一合成账号。前台呼叫、接听、拒绝、取消，分别讲话，检查远端手动播放按钮、音量控件降级和挂断后的浏览器麦克风指示。
2. 在受信任的测试 HTTPS 地址上从两台独立设备接入。检查 macOS Safari、iPhone Safari、iPhone PWA，覆盖权限拒绝后重试、切换麦克风、外放与耳机、双向音频、横竖屏和减少透明度／动态效果。
3. 测试站内换页及来电时输入，通话中最小化恢复。验证账号切换与密码重置立即终止双方状态，并检查重复开关后的资源。体验锁屏、切后台和系统挂起时记录实际行为。
4. 分别在同一 Wi-Fi、不同宽带、移动网络和 relay-only 下验证。强制中继时确认双方双向媒体与选中 relay pair，详见 [TURN 部署及验证](UNI-CALL-TURN-DEPLOYMENT.md)。

## 原始记录和截图

输出目录为 `/Users/mushin/Documents/Codex/2026-11-06/uni-5-sonoma-uni-5-sonoma/outputs/uni-call-2026-11-24/`。

|文件|内容|
|---|---|
|`node-tests-final.log`|最终 50 项测试的完整输出|
|`verified/browser-results.json`|最终 10 项真实 Chromium 检查与脱敏统计|
|`napa-regression/fidelity-validation.json`|原有设计回归 15 项|
|`safari-results.json`|Safari WebDriver 阻断|
|`verified/01-outgoing.png`|桌面呼出等待|
|`verified/02-incoming.png`|论坛中的来电|
|`verified/03-connected.png`|完整通话面板|
|`verified/04-capsule.png`|论坛中的浮动通话胶囊|
|`verified/05-incoming-mobile-dark.png`|移动端深色来电|
|`verified/06-connected-390.png`、`06-connected-844.png`|移动竖屏与横屏通话|

## 文件与工作区

- 服务端与配置：`server.js`、`lib/uni-call.js`、`.env.example`。
- 前端：`public/index.html`、`public/scripts/uni-call.js`、`public/styles/uni-call.css`。
- 预览：`scripts/preview-uni-call.cjs`、`scripts/preview-napa.cjs`。
- 测试：`test/uni-call.test.cjs`、`test/browser/uni-call.cjs`、`test/fixtures/uni-call-server.cjs`。五个已有服务端测试文件补齐隔离依赖，通信测试继续验证断线清理。
- 文档：[架构与安全](UNI-CALL-ARCHITECTURE.md)、[信令](UNI-CALL-SIGNALING.md)、[TURN 部署](UNI-CALL-TURN-DEPLOYMENT.md) 和本报告。

本地分支为 `design/napa-valley-optical-prototype`，HEAD 为 `b8c177c`。Napa 已保留的未提交文件和历史 stash 仍在工作区。U11 保持未关闭。此次为本地开发与隔离验证。

## Uni Call Island · UI 与交互复验

水晶岛使用单个组件承载来电、呼出、接通、重连和结束。展开及音频设置沿用同一组件，头像、身份、计时和主要动作保留在同一行。桌面布局实测为顶部居中的 320×54px 胶囊，展开来电为 432×113px。窄窗口在全局搜索与通知下方显示。音频设置单独展开，短横屏只滚动详情区。

现代浏览器通过手动 Popover 进入浏览器顶层，避开 Sonoma 页面透视对 fixed 定位的影响。此前在通过私聊跳转论坛时测得常规 fixed 元素偏离水平中心并超出顶部，修复后切换前后均在视口水平中心。旧浏览器的实现将控件移出 body 的透视范围。来电保持非模态，现有通知弹窗打开时继续遵守其键盘焦点规则。

- **动画**采用 CSS 对宽度、详情高度和圆角做 380ms 过渡。宽度和网格高度会计算局部布局，位置与透明度使用 transform／opacity。悬停从固定命中区触发，内层上提 2px、放大 1.025 倍。退出动画在媒体资源释放后收束。快速切换直接改变当前同一元素的样式目标。
- **材质**沿用 Napa 的环境色、圆角和边缘高光，采用一次 backdrop 采样、窄边渐变和 CSS 实色降级。边缘色彩为 CSS 近似。使用已有减少透明度设置与系统减少动态效果。 [Apple HIG Materials](https://developer.apple.com/design/human-interface-guidelines/materials) · [Apple HIG Motion](https://developer.apple.com/design/human-interface-guidelines/motion)
- **网络**以实际 WebRTC RTT、抖动及相邻计数的丢包率作为来源。前台约每 8 秒更新显示，做指数平滑、恢复阈值和两次采样确认。RTT 采用 20／50／100ms 区间，区间边界预留 4ms，缺少可用统计时显示检测状态。重连立即用文字和黄色点提示。原有 4 秒连接检查按原频率运行。

Edge Chromium 158.0.4370.33 实测 Uni Call 12/12，通过两套隔离上下文收发 Opus。合成链路检测的实际 RTT 为 0–1ms，界面显示 `连接良好 · RTT <20 ms`。采集 24 次浏览器动画帧回调，记录到 21 个不同高度和连续宽度，中心偏差小于 1px。论坛内容边界误差小于 1px，收起静置后无组件动画运行。三次快速反向切换后展开状态、可访问性属性及键盘操作一致。站内切换继续增加同一个 PeerConnection 的接收包数，计时继续。挂断时结果仍可见，双方资源已释放。该次短观察未测物理设备的 GPU、耗电、屏幕阅读器或丢包环境。

Node 套件 50/50，Napa Fidelity 浏览器回归 15/15。Safari WebDriver 返回未启用 Allow remote automation，Safari/iPhone 实机、真实麦克风和公网 TURN 保持待验收。

本轮输出在 `/Users/mushin/Documents/Codex/2026-11-06/uni-5-sonoma-uni-5-sonoma/outputs/uni-call-island/`。其中 `verified/browser-results.json` 记录形变、媒体、网络和截图列表，`node-tests.log` 记录 Node 回归，`napa-regression/fidelity-validation.json` 记录 Napa 回归，`safari-results.json` 记录 Safari 阻断。修改集中在页面组件、通话前端脚本、样式、浏览器测试和本报告，工作区未提交。
