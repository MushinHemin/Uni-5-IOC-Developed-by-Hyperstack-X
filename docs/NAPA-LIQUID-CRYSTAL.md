# Uni 5.6 Napa Valley · Liquid Crystal 首页光学原型

2026-11-09 · 本地视觉验收版本，未提交、未推送。

## 交付范围与保护

本次完成可复用的壁纸重采样原型，并应用到首页三张功能卡片。登录、聊天、工具栏、菜单和弹窗仍使用此前 Beta 2 材质，没有提前扩展到全站。Sonoma 布局、壁纸、蓝色图标、圆角、业务 DOM 和协议保持。

开始时为 `design/napa-valley-optical-prototype`，HEAD `b8c177c255a8d955419d12e9994dd2c60b91d31d`。存在 `public/index.html` 及未跟踪的设计文件，`git diff --check` 无错误。既有修改和 rejected-design stash 原样保留；本轮不操作真实数据库、上传内容或 Git 历史。U11 继续未关闭。

## 真实采样位移与明确边界

原 Beta 2 使用 backdrop 模糊、渐变轮廓和方向性阴影；它没有改变背景采样坐标。本原型增加 **WebGL 1 片元着色器**：

1. 根据实际 Sonoma 背景伪元素的尺寸、负 inset、`cover` 裁切与缩放，建立屏幕到纹理的坐标映射。
2. 用圆角矩形距离函数计算到外沿的距离和局部法线。约 24px 的折射带内，沿法线移动采样位置；圆角增加约 42% 的偏移增益。
3. 默认 50% 玻璃设置下基础位移为 12 CSS px，靠近中央平滑归零。既有 0–100 强度仍影响位移和漫射，不改存储键或默认值。
4. RGB 使用不同的实际纹理坐标；基准通道偏移为 0.65 CSS px，直边更弱、圆角更强，中央无分色。
5. 保留原有动态边缘反射，增加着色器中的窄外高光与内侧肩部阴影。独立的方向性光照与真实采样位移共同形成厚度。

**这是已知背景的图像空间折射近似，有真实纹理坐标位移；不是物理光线追踪，也无法采样任意背后的 HTML、其他窗口或媒体。** 渲染的是同一 Sonoma 壁纸，不是截图。没有把文字、图标送进着色器。不同背景、非中心 cover 或复杂变换不符合映射条件时退回 CSS 材质。

浏览器 API 按 [Khronos WebGL 规范](https://registry.khronos.org/webgl/specs/latest/1.0/) 实现。一个共享 WebGL 上下文依次绘制三张卡片，在同一任务内复制到保留画面的 2D canvas；不依赖持续保留的 WebGL 帧缓冲。

## 对比度与材质分离

- 核心只做轻量对称纹理采样漫射，没有乳白色填充。光学参数在 `--crystal-*` 中集中管理。
- 在图片加载时仅取一次 64×64 缩略图像素，用于保守选择局部深色或浅色文字；不是逐帧 CPU 回读。
- 保护范围按真实正文与标签文字边界测量，外侧柔和衰减。浅色文字下，在 **线性 RGB** 中按亮度上限降低局部背景亮度，保留色相；已有明亮区域采用深色文字，并设局部亮度下限防止细节破坏对比度。
- 没有全卡片统一变黑或变白。文字和图标仍由浏览器原生渲染。
- WebGL 不可用时恢复原 CSS 材质，仅为文字提供局部深蓝保护；增强对比度与强制颜色模式使用原有实色/系统色降级。

已采样的浅深主题正文和标签最低对比度分别为 **5.337:1 / 5.335:1**。这高于 WCAG AA 普通文字的 [4.5:1 门槛](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)，但只证明当前合成页面的采样区域，不代表全站无障碍认证或所有缩放/背景场景。

## 性能和降级

- 一张最大 2048×2048 纹理；单张展示画布最多约 650,000 像素；桌面 DPR 上限 1.5，窄屏上限 1。三卡共享上下文，不为每个组件创建 GPU 渲染器。
- 静止时无自转动画和渲染循环。初始化、尺寸、主题、字体、页面状态变化以及过渡结束后按需更新；布局读取与绘制写入分批执行。
- 悬停位移继续交给原 CSS 合成动画，结束后刷新坐标。动画中可能有短暂的缓存图像跟随卡片，未宣称逐帧物理准确。
- 滚动时先恢复实时 CSS 材质，停止后重新采样，避免缓存壁纸持续错位。该切换在低端真机上的感受仍需验收。
- 数据节省模式、已知低内存设备、手动关闭折射、WebGL 不可用或丢失上下文均可降级；上下文恢复后重建纹理。支持 reduced-motion，未增加持续动态效果。
- 无新依赖、无业务网络请求、无全屏实时滤镜、无 `readPixels`。初次纹理上传、解码图像及 GPU 驱动仍有额外内存成本；没有宣称零成本。

## 验证与证据

定向测试最终 **10 个唯一检查全部通过**。首轮 9 通过、1 项因过早读取下一帧导航状态失败；改为等待页面切换后，该项定向复测通过，随后补测降级与两种移动宽度。不是多次运行全量测试。

- 首页浅深主题三卡尺寸与本轮修改前一致；正文/标签采样对比度达标。
- 高对比条纹：34,330 个边缘采样点中，仅改变折射参数时，最大通道差的平均值约 28.93/255；只开启色散时约 1.09/255。157,140 个中央采样点两项最大差均为 0。这里是像素颜色差，不是位移距离。
- 同一着色器关闭/开启位移的圆角放大图直接显示直线弯折，排除了“只换描边”的解释。
- 空闲观察窗口内绘制计数未增加；1440×960 / DPR 1 时单卡最大 232,152 像素。记录中的 1.8ms 是提交绘制的 JS 时间，不是 GPU 完成时间或真实帧率。
- 原有边缘跟随仍响应；动画结束后不持续触发纹理绘制。
- 390/768px 首页尺寸、水平边界与聊天输入/底部导航关系通过。
- 关闭折射、增强对比度、reduced-motion、WebGL 不可用、上下文丢失/恢复、导航入口通过。
- 玻璃强度 0/100、登录与聊天容器尺寸检查通过；未运行全量业务回归。
- 新增脚本、预览脚本及测试脚本语法检查通过；`git diff --check` 通过。合成页面脚本错误为 0。

### Safari 的实际状态

本机 Safari 27.2。WebDriver 因未开启远程自动化而拒绝创建会话；没有更改 Safari 安全设置。之后通过原生界面操作，**实际加载了浅色 Sonoma 首页并保存截图，三卡纹理与边缘正常显示**。后续深色操作因浏览器被用户切换而停止。

Safari 深色、动态高光逐帧/按压、校准图像素分析、iPhone/PWA、真实软键盘、滚动与 GPU 能耗尚未完整验收。Chromium 结果不能替代这些检查。此次不因自动检查通过就宣称达到最终审美标准。

## 文件与运行

|文件|职责|
|---|---|
|`public/scripts/napa-crystal.js`|共享渲染器、壁纸映射、法线位移、色散、局部亮度及降级|
|`public/styles/napa-crystal.css`|三卡光学层、文字颜色、局部降级；不改变布局|
|`public/index.html`|仅新增上述样式和脚本引用，保留之前所有差异|
|`scripts/preview-napa.cjs`|放行两项静态资源，增加关闭折射与条纹校准预览|
|`test/browser/napa-crystal.cjs`|定向像素、对比度、布局、故障恢复验证|
|本说明|方案、限制与验收记录|

本地预览：<http://127.0.0.1:8860/?scene=home>；深色加 `&theme=dark`；条纹加 `&calibration=1`；CSS 降级加 `&crystal=off`；本轮修改前加 `&stageb=1`。所有数据均为合成。

```sh
cd '/Users/mushin/Desktop/beluga-chat_副本'
NAPA_PREVIEW_PORT=8860 \
NAPA_BEFORE_DIR='/Users/mushin/Documents/Codex/2026-11-06/uni-5-sonoma-uni-5-sonoma/outputs/liquid-crystal/before' \
node scripts/preview-napa.cjs
```

验证命令（复用已安装工具，不安装依赖）：

```sh
UNI_PLAYWRIGHT_MODULE='/Users/mushin/Documents/Codex/2026-11-06/uni-5-sonoma-uni-5-sonoma/work/audit-tools/node_modules/playwright' \
UNI_BROWSER_EXECUTABLE='/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' \
UNI_VISUAL_OUTPUT='/Users/mushin/Documents/Codex/2026-11-06/uni-5-sonoma-uni-5-sonoma/outputs/liquid-crystal' \
node test/browser/napa-crystal.cjs
```

输出目录：`/Users/mushin/Documents/Codex/2026-11-06/uni-5-sonoma-uni-5-sonoma/outputs/liquid-crystal/`。

- `comparison.html`：浅深主题前后对照和圆角放大对照。
- `before-home-*.png` / `after-home-*.png`：相同合成场景截图。
- `edge-proof.png`、`calibration-*.png`：真实渲染的坐标校准；仅裁剪放大，没有重绘。
- `safari-home-light.png`：Safari 本地实际截图，仅存于输出目录，不进入 Git。
- `validation*.json`、`fallback-recheck/`、`mobile-recheck/`：保留首轮结果与定向复测，`validation-final.json` 汇总最终状态。
- `before/`、`baseline.json`、`final-state.json`：修改前快照及保护检查。

下一步应先验收三卡的折射幅度、局部亮度与过渡感觉，再考虑为登录和输入控件定义新的材质参数。本轮到此停止，不自动扩展或发布。
