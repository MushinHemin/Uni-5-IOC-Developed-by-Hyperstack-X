# Uni 5.6 Napa Valley · Beta 2

**Sonoma Crystal Glass · 本地视觉验收版 · 2026-11-09**

本次只完善光学材质。分支为 `design/napa-valley-optical-prototype`，HEAD 保持 `b8c177c255a8d955419d12e9994dd2c60b91d31d`。没有 commit、push、Release 或历史改写。原有 Stage A/B/B.1 修改和被否决设计的 stash 均保留。

## 参考图与本次判断

已实际查看负责人提供的 Safari 工具栏与 macOS 控制中心截图，并与同一 Sonoma 壁纸下的 Beta 1 对照。借鉴的是材质，不是布局：控制中心的亮外沿、暗内沿和内部柔和漫射；Safari 强调控件的局部蓝紫环境反射。参考图未复制进源码、产品素材或提交。

Beta 1 保留了壁纸色彩，但漫射主要集中于容器中部，较大区域仍清晰透出壁纸轮廓。本次扩大有效漫射区，按组件角色分配模糊强度，并加强细双边的厚度关系；没有继续统一降低 Alpha。

保留之前已确认的合成修正：页面内容使用 `transform-style: flat`，同时保留页面自身的空间位移/缩放及父级透视；卡片入场动画结束后释放 `forwards` 保留的合成状态，使内部 backdrop 真正采样背景。登录空间动画仍存在。非当前聊天页面不再透出后方聊天文字；DOM、草稿与业务状态保持。

## 三种材质

现有容器以 `data-napa-material` 标记角色。装饰层为绝对定位、`aria-hidden`、不接收指针事件，不占用布局位置。文本与图标不使用整体透明度或色散。

|材质|主要位置|默认 50% 时核心 blur|核心 tint 权重|设计作用|
|---|---|---:|---:|---|
|Structural Glass|主窗口、论坛/工作台等外层容器|14px|0.36|高环境透射，保留壁纸的大色块|
|Content Glass|首页三卡、登录卡片、确认弹窗|32px|0.88|更广的柔和漫射及阅读保护|
|Control Glass|输入区、导航、菜单、搜索通知入口|25px|0.94|曲面感、边缘厚度、局部响应|

这些权重乘以既有玻璃强度对应的核心 Alpha，不是最终整体 opacity。首页主窗口核心仅提供 tint，借用轻过渡采样；三张卡片各自负责内容漫射，避免叠加两次大面积强模糊。

- **Progressive Diffusion**：约 2px 清透外缘，有限的轻模糊过渡和核心采样，通过多段渐变 mask 连续混合；内容核心不再只存在于卡片中央的一小块区域。
- **Crystal Rim**：1.5–2px 方向性反射带、细外高光、内侧暗边和柔和阴影形成厚度；不是单一固定白色 border。
- **Dynamic Specular**：高光限定在 4px 边缘带。共享指针状态沿圆角矩形周长插值，曲面法线控制光斑长短轴；离开回到默认光源，稳定后停止 RAF。按压时高光收束，小控件轻微压缩。
- **Dispersion**：只在少量边缘使用很弱的冷暖颜色。文字和图标不分色。
- **Adaptive Tint**：浅色使用淡冷中性色，深色使用蓝灰色；背景颜色通过透明混合自然进入材质。不是对壁纸做实时像素取色。蓝紫反射只用于发送/登录等强调控件和导航激活态。

**折射、透镜厚度与色散是 Web 上的视觉近似，不是光线追踪、真实色散或像素位移折射。** 未引入全屏 SVG 位移、持续装饰循环或新的依赖。

## 兼容与实现边界

- 现有布局、功能入口、蓝色主题、Sonoma 图片、消息气泡阅读底色以及 Phase 01–05 行为保留。
- 主窗口约 48px、内容卡约 40px、弹窗约 42px；输入/菜单约 28px，内部多行输入区采用相应内圆角。移动端保持原有全屏窗口和 U19 safe-area/键盘布局。
- 小按钮借用所属容器的漫射，不为每个按钮添加 backdrop-filter；共用同一指针监听与有限 RAF。最多一个活动表面和两个回落表面。
- 移动端去掉额外过渡采样，首页卡片借用窗口采样；支持 reduced-motion、增强对比度、forced-colors 和无高级滤镜降级。
- 原有 `账户与设置` 标签使用 `::after`。视觉检查发现与高光伪元素冲突后，将该按钮排除出紧凑高光增强，保留文字和原尺寸，并加入专门回归检查。
- 保留用户玻璃强度存储键、默认 50% 和显式 0%；不重置偏好。

## 验证结果

**32/32 浏览器定向检查通过；14/14 既有可靠性与移动布局回归通过。** 本次集中执行，浏览器报告无脚本错误。

浏览器：本机 Headless Edge / Chromium 156.0.4314.50。检查包括：

- 同一壁纸、主题、1440×960 视口及合成状态的首页/聊天/登录前后对照；主容器边界保持。
- 1440px、390px 浅深主题下所有首页工具栏按钮的文字、显隐和几何尺寸；包括设置按钮伪元素标签。
- 三类材质真实参数、紧凑控件无额外模糊层、装饰层去重及不拦截输入。
- 条纹校准图的实际渲染漫射：核心高频变化指标从关闭采样时的约 5.991 降至 0.274（比值约 0.0458）。此项证明采样起效，不代表审美评分或完整对比度认证。
- 高光平滑跟随、圆角周长投影、按压/释放、离开回落；输入法、Enter/Shift+Enter、导航、草稿保留、普通用户权限入口。
- 0/50/100 强度及已保存 0 经重载/换主题保留。
- 390/430/768/1366px 输入区域、模拟软键盘恢复、reduced-motion 和高对比度。
- 30 次空闲 RAF 的中位数/P95 约 16.7ms，仅为无头浏览器观察，不代表真实设备帧率、GPU 开销或功耗。

语法检查和 `git diff --check` 通过。自动化测试使用合成数据与隔离环境，未读取或改写真实数据库、上传内容和用户资料。

### 尚未验证

Safari 控制工具在尝试创建独立预览标签页前持续拒绝操作，未完成 Safari 实际加载/点击/高光验收。没有改变 Safari 设置或绕过控制限制。WebKit CSS 前缀不等于 Safari 验证通过。

iPhone 真机、PWA 独立窗口、真实软键盘、长列表滚动/GPU/功耗和全站逐项对比度仍待验收。自动化通过不能替代负责人对参考图、厚度、漫射与可读性的视觉判断。

## 本地预览与证据

当前预览（只监听本机、合成数据）：

- 首页：<http://127.0.0.1:8859/?scene=home>
- 聊天：<http://127.0.0.1:8859/?scene=chat>
- 登录：<http://127.0.0.1:8859/?scene=login>
- 深色增加 `&theme=dark`；Beta 1 对照增加 `&stageb=1`。

启动方式（如预览进程已退出）：

```sh
cd '/Users/mushin/Desktop/beluga-chat_副本'
NAPA_PREVIEW_PORT=8859 \
NAPA_BEFORE_DIR='/Users/mushin/Documents/Codex/2026-11-06/uni-5-sonoma-uni-5-sonoma/outputs/napa-beta2/before' \
node scripts/preview-napa.cjs
```

输出目录：`/Users/mushin/Documents/Codex/2026-11-06/uni-5-sonoma-uni-5-sonoma/outputs/napa-beta2/`

|文件|内容|
|---|---|
|`comparison.html`|可选页面/主题、拖动分界线的同画面对照|
|`before/`|Beta 2 开始前的源码快照，不是失败设计 stash|
|`before-*.png` / `after-*.png`|浅深主题、桌面及控件/移动截图|
|`highlight-*.png`|局部高光状态|
|`beta2-validation.json`|32 项检查、实际尺寸/参数/像素校准与截图索引|
|`targeted-tests.log`|14 项可靠性/U19 回归结果|
|`baseline.json` / `final-state.json`|工作区、HEAD、stash 与保护检查|

必要验证命令：

```sh
UNI_PLAYWRIGHT_MODULE='/Users/mushin/Documents/Codex/2026-11-06/uni-5-sonoma-uni-5-sonoma/work/audit-tools/node_modules/playwright' \
UNI_BROWSER_EXECUTABLE='/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' \
UNI_VISUAL_OUTPUT='/Users/mushin/Documents/Codex/2026-11-06/uni-5-sonoma-uni-5-sonoma/outputs/napa-beta2' \
node test/browser/napa-beta2.cjs

'/Users/mushin/Documents/Codex/2026-11-06/uni-5-sonoma-uni-5-sonoma/outputs/phase5/isolated-runtime/node-v24.22.1-darwin-arm64/bin/node' \
--test test/mobile.test.cjs test/reliability.test.cjs
```

## 本批次文件

- `public/styles/napa-transparency.css`：三类材质、渐进漫射、双边厚度、强调色及降级。
- `public/scripts/napa-optics.js`：材质角色、紧凑控件增强及更小的光斑预算，保留设置标签的伪元素。
- `scripts/preview-napa.cjs`：Beta 1/Beta 2 对照工具条文字。
- `test/browser/napa-beta2.cjs`：本次集中验证及截图。
- 本说明文件。

`public/index.html` 等 Stage A/B/B.1 未提交改动原样保留；本次 Beta 2 没有修改业务内联脚本。服务器业务、API、数据库结构、依赖与真实数据未改动。U11 历史隐私授权仍未关闭。

**Beta 2 到此停止，等待产品负责人视觉验收。**
