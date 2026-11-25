# Napa Valley Beta 2 · Crystal 小范围精修

日期：2026-11-09。仅调整两处视觉问题，保留 Sonoma 布局、壁纸、品牌色、业务 DOM 和既有功能。

## 工作区保护

开始时分支为 `design/napa-valley-optical-prototype`，HEAD 为 `b8c177c255a8d955419d12e9994dd2c60b91d31d`。已有 `public/index.html` 修改及未跟踪的设计样式、脚本、文档和浏览器测试。原有 rejected-design stash 保留。本轮未暂存、提交、推送或操作 stash，未访问真实数据库、上传内容和用户凭证。

## 本轮改动

源文件：`public/styles/napa-transparency.css`。

1. 登录面板、首页功能卡片和聊天输入容器的光学边缘由 2px 微调为 2.25px，并加强浅深主题的内侧暗边。借用原有方向性反射和遮罩增强厚度感；未新增模糊层、白色蒙层或持续动画。这里的厚度与折射感属于视觉近似，不是物理背景折射。
2. 登录和聊天输入提示使用明确的浅深主题颜色；恢复被后置玻璃规则覆盖的聊天输入聚焦边框与蓝色光环，并提供强制颜色模式的系统焦点轮廓。输入区域填色和几何尺寸不变。

保留原有 Clear Edge → Transition → Frosted Core 漫射、高光跟随、圆角和玻璃强度设置。本轮没有继续扩大模糊或降低透明度。

## 验证

使用已有本地无头 Chromium 和合成预览内容，快速定向检查最终 **10/10 通过，页面脚本错误 0**：

- 登录、首页、聊天 × 浅深主题：边缘参数生效；布局、填色、核心模糊和文字透明度保持原值。
- 浅深主题聊天输入：提示文字颜色与蓝色聚焦反馈。
- 390px：输入容器与底部导航边界、无水平溢出。
- 强制颜色模式：系统焦点轮廓可见。

首次检查中首页入场动画尚未结束，引发透明度取样误差。检查脚本改为等待动画结束，随后只续跑失败项和剩余项；未为测试修改产品动画。

未运行全量功能测试、压力测试或外部浏览器自动化。截图与计算样式不能代替负责人审美验收，也不能证明 Safari/iPhone/PWA、真实软键盘、GPU 能耗或完整 WCAG 合规。既有动态高光代码未改，本轮不重复其完整交互测试。U11 历史隐私授权问题仍未关闭。

## 预览与证据

当前合成预览：

- 首页：http://127.0.0.1:8859/?scene=home
- 聊天：http://127.0.0.1:8859/?scene=chat
- 登录：http://127.0.0.1:8859/?scene=login
- 深色主题：在上述地址后添加 `&theme=dark`。

若预览已关闭，在项目目录运行：

```sh
NAPA_PREVIEW_PORT=8859 node scripts/preview-napa.cjs
```

该预览使用合成内容，不启动真实业务服务。已有 `stageb=1` 参数比较的是旧 Beta 1，并非本轮修改前状态。

本轮精确前后截图、修改前 CSS、两次独立保存点、定向检查脚本及 JSON 结果位于：

`/Users/mushin/Documents/Codex/2026-11-06/uni-5-sonoma-uni-5-sonoma/outputs/napa-beta2-refinement/`

其中 `before-*.png` / `after-*.png` 为本轮同壁纸、同主题、同场景对照，`quick-check-results.json` 为最终检查结果。检查命令：

```sh
node '/Users/mushin/Documents/Codex/2026-11-06/uni-5-sonoma-uni-5-sonoma/outputs/napa-beta2-refinement/quick-check.cjs'
```

改动已保存，等待视觉验收；不自动进入下一阶段。
