# Uni 5.6 Napa Valley · Uni Call Island 光学精修

本轮在原有顶部居中的水晶岛上降低雾度，重做电话按钮、设备选择和音量控制。组件继续使用同一个 DOM、原有 380ms 形态过渡及非模态来电。现有 320×54px 紧凑尺寸保留，展开来电为 432×113px。测试使用隔离服务和合成账号。

## 材质与接入边界

复用了 Apple Fidelity 的功能层与阅读层原则、Napa 的环境色和圆角、原有方向性边缘变量。收起和展开共享一个壁面。内部动作和设置使用稳定填充，外轮廓随同元素连续变化。动效与材质参数是 Uni 的工程选择。 [HIG Materials](https://developer.apple.com/design/human-interface-guidelines/materials) · [WWDC25 Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/) · [HIG Motion](https://developer.apple.com/design/human-interface-guidelines/motion)

|层次|实现|
|---|---|
|背景透射|单个 CSS backdrop，模糊 19px→9px。浅色主底 Alpha .73→.34，深色 .79→.46。浅色对比度 .83、饱和度 1.24、亮度 1.05，深色饱和度 1.18、亮度 .71。|
|文字保护|昵称、状态和展开详情有局部渐隐明暗补偿。文字、头像、图标位于材质上方。|
|边缘|1px 高光遮罩、冷暖局部反射和 4–9px 内影。伪元素继承实时圆角，悬停提升高光和投影，实际背景透射连续存在。|
|降级|减少透明度、增加对比度、未提供 backdrop 的浏览器和低内存／节省数据设备使用稳定底色。减少动态效果关闭形变与悬停位移，强制颜色下保留系统对比与操作轮廓。|

**本轮采用 CSS 光学精修，水晶岛没有接入 WebGL。** 现有 `napa-crystal.js` 在初始化时固定收集首页三张卡片，绘制限定在首页，公开接口仅提供诊断和刷新。它只采样 Sonoma 壁纸，直接用于位于顶层的水晶岛会覆盖聊天或论坛的真实背景内容。跨页注册需要改动现有的绘制门控、几何测量和背景组合。本轮选择保留这些核心边界。边缘色彩是渐变近似，CSS backdrop 透射及模糊不提供 UV 位移或 RGB 通道采样分离。展示的局部放大是透射和高光对比。

Chromium 在同一来电详情中替换控件后方的统一测试底色 `#152948`、`#e0c4ab`，读取水晶岛无文字中心的同一个截图像素。前后均使用 DPR 1。修改前 RGB 从 `181,193,207` 变为 `233,230,226`，差为 **52／37／19**。修改后从 `133,148,169` 变为 `230,218,208`，差为 **97／70／39**。这说明背景变化更明显地透过这处材质。该观测不衡量真实折射位移或全界面文字对比度。

## 控件与交互

- 绿色接听与红色结束使用半透明色、顶部渐变光和阴影填充，白色电话路径保留。中性按钮弱化边框，动作为原来的 SVG 与回调。保留 44px 主控件、原有静音斜线和 `aria-pressed` 状态。
- 展开内的横线和设置整块边框移除。昵称缩小字重，长昵称省略，网络状态与真实音频活动依旧来自既有链路。
- 麦克风与输出改为带图标、当前设备名和箭头的内联披露控件。列表使用原生按钮和真实已选状态，Tab／Enter／Space 保持本机行为，另支持方向键、Home／End、Escape 和焦点返回。选项变化保留仍存在的焦点，消失时回到按钮。超长混合名称保留完整可访问名称与 title，视觉截断。移除当前设备不会误标其它选项。所用输入轨真正停止时仍走原结束规则；输出由浏览器或用户切换，不擅自回退到外放。
- 设备选择继续通过浏览器 `enumerateDevices`、`replaceTrack`、`setSinkId` 和可选的系统输出选择器。异步枚举忽略过期结果。缺少输出 API 时隐藏对应控件。音量仍由原生 range 驱动实际音频元素，新增淡蓝填充、自定义滑块和百分比。
- 保留 380ms 主过渡、反向操作和原有资源释放顺序。颜色变化、圆角、内影和背景采样都由 CSS 随组件形状变化。没有画布分配、附加渲染循环或按秒重新测量材质。浏览器检测水晶岛 Canvas 为 0，原有首页 WebGL 上下文请求计数仍为 1。

## 验收与证据

|检查|实际结果|
|---|---|
|修改前原有浏览器套件|12/12。修改前源码快照的同脚本补充对照 13/13，其中新增一项透射验证。设备专用新增断言只在新版运行。|
|新版 Uni Call Chromium|14/14，Edge 158.0.4370.33，零未捕获脚本错误。|
|Node 与 Napa Fidelity|Node 50/50，Napa Fidelity 15/15，后者验证了首页光学渲染、通知与原有交互。|
|传输和生命周期|两端均收到真实 RTP 音频并协商 Opus，连接在同一 PeerConnection 上跨视图并恢复，计时连续；挂断后音轨、PeerConnection 和 AudioContext 释放。|
|设备与音量|Chromium 合成音频设备的麦克风替换、原音轨结束、输出实际切换均通过。合成长设备名、设备列表移除、缺少输出 API、键盘焦点和音量 35%→40% 均通过。|
|布局与运动|桌面浅／深、390px、768px、844×390px、长昵称、减少动态与透明度通过对应测试。保留快速点击后的正确终态及静置无持续动画检查。真实浏览器在 CSS 过渡的 0／95／190／285／380ms 分别暂停截帧。|
|Safari 实机|WebDriver 报告本机未启用 Allow remote automation，未完成 Safari 验收。|
|性能未测|长时间功耗、GPU 时间、真实设备和真实 AudioContext 负载。VoiceOver、真实麦克风和蓝牙热插拔、iPhone／PWA、跨网络及公网 TURN 继续待验收。|

原始记录及图片位于 `/Users/mushin/Documents/Codex/2026-11-06/uni-5-sonoma-uni-5-sonoma/outputs/uni-call-optical-refinement/`。打开 `gallery.html` 查看 13 组同场景、主题、视口与 DPR 的对照；另有新版设备列表和五个形变时点。旧版系统下拉弹层没有作为浏览器截图证据。桌面和移动图片均使用当时的真实浏览器绘制，未重新绘制截图。

运行方式为 `npm test`、`node test/browser/uni-call.cjs` 和隔离 Napa 预览上的 `node test/browser/napa-fidelity.cjs`。浏览器测试支持 `UNI_PLAYWRIGHT_MODULE`、`UNI_BROWSER_EXECUTABLE`、`UNI_VISUAL_OUTPUT`。使用 `UNI_CALL_BEFORE_DIR` 指定快照可重跑对照。输出里的 `before-matched/browser-results.json`、`after/browser-results.json`、`node-tests.log`、`napa-regression/fidelity-validation.json` 及 `safari-results.json` 保存实际结果。

## 文件与工作区

修改 `public/styles/uni-call.css`、`public/scripts/uni-call.js`、`public/index.html`、`test/browser/uni-call.cjs`，新增本报告。服务端、信令核心、现有光学核心及 Napa 回归测试与任务开始时的校验值一致。Git 分支为 `design/napa-valley-optical-prototype @ b8c177c`，此前未提交成果与 stash 保留，未提交、推送或部署。U11 仍未关闭。
