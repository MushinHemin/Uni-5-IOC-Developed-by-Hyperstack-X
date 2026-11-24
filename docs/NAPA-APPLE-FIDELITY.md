# Uni 5.6 Napa Valley · Apple Liquid Glass Fidelity

## 报告状态与范围

研究记录日期：2026-11-15；续接实施日期：2026-11-16；工程验收日期：2026-11-17（Asia/Shanghai）。本报告依据已保存的 Apple 官方正文、WWDC 字幕与现有 UI 源码审查编写，不重复开展全仓库审计。

本轮实施边界为**首页材质层级、通知中心实际交互原型，以及与它们相关的减少透明度支持**。首页三张导航卡片、Sonoma 壁纸、品牌蓝色与既有业务入口保留。其他页面已纳入符合性审查，但不因此声称已全部改造。

这是依据公开设计指导形成的工程对照报告，不是 Apple 认证或像素级原生实现声明。已保存实现与实际验收分开记录。下列 18 项矩阵保留实施起点的审查状态；其中“待验证”不代表本轮最终结果。本轮结果以“2026-11-17 工程验收”及独立验收报告为准；未纳入本轮的页面仍待后续验证。

工作起点为 `design/napa-valley-optical-prototype @ b8c177c255a8d955419d12e9994dd2c60b91d31d`。此前未提交成果及被否决方案的 stash 继续保留。原始起点快照位于任务输出目录的 `before/` 与 `baseline.json`。不操作真实数据库、聊天记录、上传内容，不自动提交或推送；U11 历史隐私风险继续未关闭。

## 证据分类

|标记|含义|本报告的使用边界|
|---|---|---|
|A：Apple 明确指导|官方正文或讲解明确描述的原则、行为、适用场景|给出来源及章节；不从截图推断未公开参数|
|O：观察到的视觉特征|实际查看官方演示或本项目浏览器画面后的观察|字幕描述不自动等于已独立观看；未保存视觉证据的项目不标为视觉验收通过|
|W：Web 工程近似|CSS、WebGL、Web Animations、DOM 焦点管理等实现|不等同 SwiftUI、UIKit、AppKit 的原生材质、动态合成或 vibrancy|
|U：Uni 品牌选择|Sonoma 壁纸、蓝色品牌、三卡片入口、既有空间登录与布局|有意保留的产品特征，不包装为 Apple 规定|

本轮未从 Apple 文档推导出固定的 Web 折射带宽、RGB 位移、圆角像素、透明度、动画毫秒或弹簧系数。代码中此类数值均是 Uni 的工程选择，需通过项目实际阅读、交互和性能检查判断。

## 官方依据与实际含义

下列来源均由前一阶段读取完整正文或字幕，而非仅依据搜索摘要。完整来源账本与原始存档见文末证据索引。

|来源|对应章节或时间|原文实际含义与对 Uni 的影响|
|---|---|---|
|S1：[HIG · Materials](https://developer.apple.com/design/human-interface-guidelines/materials)|Liquid Glass；Standard materials；Platform considerations|A：功能导航与内容层应有区分；重要导航和控件可以使用 Liquid Glass，内容层优先使用 standard materials；自定义玻璃应克制。Regular 面向复杂背景或较多文字，Clear 面向视觉丰富的背景。背景亮度决定保护方式，文中亮背景暗化参考值不是全局 Alpha 标准。W：Uni 需要自行实现材质与文字保护。|
|S2：[HIG · Color](https://developer.apple.com/design/human-interface-guidelines/color)|Best practices；Inclusive color；System colors；Liquid Glass color；Color management|A：颜色应一致，重要语义不能只靠颜色；需考虑浅色、深色与增加对比度；强调色用于关键操作，环境色可参与材质。U：保留 Sonoma 蓝色；W：CSS 颜色和已知壁纸采样不能完整复现原生语义颜色、显示管理与 vibrancy。|
|S3：[Liquid Glass · Technology Overview](https://developer.apple.com/documentation/technologyoverviews/liquid-glass)|Introduction to Liquid Glass；Adopting Liquid Glass；Design principles|A：材质、运动和层级共同工作，可逐步采用，无须推倒重建。原生标准控件可获得系统行为。W：HTML 不会因浏览器运行在 macOS 上就自动获得原生材质能力。|
|S4：[Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass)|Visual refresh；Controls；Navigation；Menus and toolbars；Windows and modals；Platform considerations|A：审查干扰材质的自定义背景、拥挤与重叠，保持导航及内容区分、功能分组、适配与可访问性；呈现应关联触发源。W：仅删除全部背景并不能获得原生自动适配；本项目采用单个明确的通知功能面板和稳定内部内容。|
|S5：[WWDC25 · Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/)|Dynamics 1:29；Adaptivity 6:00；Principles 10:31|A：光学变化、形状、交互和光照应协调；避免玻璃套玻璃；内部元素可使用填充及前景处理；尺寸与可访问性影响表现。W：保留背景采样位移，但不把某个色散强度说成 Apple 目标。|
|S6：[WWDC25 · Get to know the new design system](https://developer.apple.com/videos/play/wwdc2025/356/)|Design Language 2:06；Structure 6:16；Continuity 13:34|A：嵌套形状与间距应协调；桌面高密度控件并非全部胶囊化；材质作用于完整控件，分组表达层级，展开应体现来源关系。U：保留 Uni 现有入口与结构；W：通知原点及焦点管理是具体 Web 实现。|
|S7：[HIG · Motion](https://developer.apple.com/design/human-interface-guidelines/motion)|Best practices；Providing feedback|A：运动应有目的、简短准确、可以取消并适应减少动态效果；方向应符合操作预期。W：具体时长、缩放量和缓动曲线由 Uni 选择，不称为 Apple 运动参数。|
|S8：[WWDC26 · Platforms State of the Union](https://developer.apple.com/videos/play/wwdc2026/102/)|22:43–24:42|A：更新说明涉及复杂背景漫射、暗边与镜面高光、用户偏好的更清透至更着色，以及窗口、工具栏与选择性菜单图标调整。此来源说明 2025 演示并非所有外观的永久标准；不能推导“圆角越大、色散越强就越符合”。|

更新资料交叉检查还包括 [WWDC26 Design Guide](https://developer.apple.com/wwdc26/guides/design/) 与 [2026-06-23 Apple 设计资源更新](https://developer.apple.com/news/?id=e2lxw9l1)。未导入 Apple 专属图标、设计套件资源或产品品牌素材。

## Apple Liquid Glass Design Compliance Matrix

以下是逐项设计对照，不给出没有客观定义的“苹果味”分数。源码行号默认指 2026-11-15 开始实施前的快照；当前新增原型另列文件及函数，避免后续插入代码使旧行号失去可追溯性。

|编号／界面|当前 Uni 表现与源码证据|官方依据与具体差异|修改方案／范围|验证方式及状态|
|---|---|---|---|---|
|H01 首页三卡片|`public/index.html:5102/5113/5124` 为真实导航 button，附说明和统计；`napa-crystal.js` 为三卡片采样背景，并位于玻璃外窗中。|S1 Liquid Glass、S5 Principles：属于导航与内容混合角色，不能直接认定为被禁止的纯内容玻璃；但大面积持续边缘与外窗叠层竞争明显。|保留三个入口、尺寸关系和真实位移；减少外窗镜面层与卡片过重的静态浮雕／色散。U：保留全景式品牌入口。|原型已保存；同尺寸前后截图、导航目的地、像素位移与文字对比度待验证。|
|H02 结构窗与内容层|`napa-optics.js:8–24` 给结构窗、卡片、登录、对话框及控件注入材质；`napa-transparency.css:56–71` 使用内部 role 名称。|S1、S3、S5：过多层均有玻璃表现；内部 structural/content/control 名称不能等同 Apple 的 Regular/Clear。|先使首页外窗安静，卡片承担唯一主要光学层；其他页面按内容及功能角色分批处理。|首页原型待验证；全站层级统一仍待后续，不宣称完成。|
|H03 Sonoma 壁纸|`napa-transparency.css:27–33` 保留原图、无全局重度模糊，深色仅轻微环境调节。|S1、S2：环境色可参与材质，但文字需稳定。原图和蓝色属于 U，不是 Apple 标准。|保留壁纸，继续局部亮度保护，禁止重新引入大面积白罩。|浅深主题同状态截图及复杂背景文字检查待验证。|
|H04 登录|`index.html:5019–5062` 原表单；`napa-optics.css:47–64` 保留空间退后；`napa-optics.js:43` 管理背景 inert。|S6 Continuity、S7：已有来源于空间层次的表现，但共享材质与对话框角色并不精确。|本批保留；共享减少透明度只改变辅助呈现，不动认证和表单。|登录、键盘、中文输入与背景焦点回归待验证；材质改造延期。|
|H05 顶部／底部导航|`index.html:4867–4880` 搜索与通知组；`4265–4334` 移动导航；`napa-optics.js:27–48` 单个激活指示器与 aria-current。|S4 Menus and toolbars、S6 Structure：功能分组已有基础，按钮和父组重复独立玻璃可削弱统一层级。|搜索／通知共享父组材质，内部按钮使用普通填充反馈；保留入口与移动指示器。|导航、点击状态、键盘焦点和 safe-area 待验证。|
|H06 聊天内容与输入区|`index.html:1033–1055` 消息气泡；`napa-transparency.css:116–140` 正文与输入控制层区分。|S1、S6：已有较明确内容／控制区分，结构玻璃与输入面板仍可能叠加。|本批不重写聊天；只验证共享无障碍偏好不会破坏输入。|Enter／Shift+Enter、IME、回复、滚动与浅深主题待回归；更广材质调整延期。|
|H07 论坛|`index.html:2721/2772/3270` 外窗、列表、详情、评论多层透明；`napa-transparency.css:115` 正文面板透明底。|S1 Standard materials、S5 Principles：正文内容上多个相似透明层难以表达稳定阅读层级。|后续使正文／列表采用稳定内容材质，仅功能工具栏保留玻璃。|本批静态审查确认；密集帖子、评论、筛选与滚动视觉改造未完成。|
|H08 富文本编辑器|`index.html:2890–2901/3035–3047` 外层玻璃、内层字段；`9544–9590` 直接开关，已有草稿保护顺序。|S6、S7：展开关闭缺来源联系；草稿状态不能被视觉逻辑取代。|后续增加可中断呈现时，必须保留保存草稿先于清理编辑状态。|本批未改；新建／编辑草稿、快速关闭、IME 和图片联合验证待后续。|
|H09 主页与设置|`index.html:1434/1446/1582` 共享 confirm-card，设置与资料关闭时机不同。|S1、S4 Windows and modals：重阅读资料和短操作面板使用同一光学策略。|先验证通知原型；设置仅增加减少透明度选项，不重构资料。|辅助设置待验证；资料材质、完整焦点生命周期延期。|
|H10 通知中心|原 `openNotificationModal:6672`、close6683；原入口4875、markup5505。原先居中通用进入、缺触发源与焦点关系。|S4 Windows and modals、S6 Structure、S7：展开与来源联系不足，内部通知条目继续叠玻璃。|新增 `NapaPresentation`：来源关联进入／关闭、明确阅读表面、焦点进入／返回／约束。保留 Socket、筛选、单条已读、全部已读与目标导航。|原型已保存；点击、键盘、背景关闭、快速重开、目标跳转与通知更新待验证。|
|H11 弹层重叠|`index.html:1413–1434` 全屏 blur/dim 后再叠弹层过滤器和双材质层。|S5 Principles、S6 Structure：多次背景采样加深复杂度，阅读与功能层界线不清。|通知改为简单背景暗化＋单个功能材质面板；普通填充条目承载内容。|原型待 Safari 真实截图和合成层诊断；其他弹层暂保留。|
|H12 菜单与浮控件|消息菜单9247/9285、Reaction8879/8902、表情10237/10251；多个关闭直接 hidden。|S6、S7：来源、退出及键盘关系不完整；不能用更多装饰代替交互。|通知证明行为后再复用；不一次重写全部菜单。|本批静态记录，消息业务、菜单键盘与触摸验收待后续。|
|H13 减少透明度|原未发现 `prefers-reduced-transparency`；原玻璃滑块6230–6265并不等于非透明模式。|S1、S5 Adaptivity：需尊重减少透明度且保持可阅读。|新增独立 auto/reduced 偏好，与原玻璃强度分别存储；媒体查询可用时跟随系统，减少透明度时停止光学绘制并用稳定底色。|实现待验证；覆盖重载、原强度0、主题、字段和系统偏好模拟。|
|H14 对比度|已有 high contrast／forced colors（transparency202–210）与 WebGL 局部亮度保护；只覆盖测得的区域。|S2 Inclusive color、S1：当前首页测量不能代表全站所有背景及控件。|保留保护；单独检查新通知正文、次级字、未读标识与焦点。|待验证；不得据单个比值宣称全站 WCAG 合规。|
|H15 动效|`napa-optics.css:23–29` 是内部 token；共享指针插值有停止机制；CSS 悬停变换期间壁纸缓存稍后重新配准。|S5 Dynamics、S7：关系和反馈有依据，具体数值不是官方参数；缓存更新不等于原生同步光学。|本批只新增通知来源关联、可中断和 reduced-motion 路径；保留现有登录／导航。|状态与中间帧待验证；任意运动下的原生同步光学仍是限制。|
|H16 移动端|U19 visualViewport及缩放保护（index8765–8808）、safe-area与底部导航4265–4334、弹层4844–4854。|S4 Platform considerations、S6 Continuity：尺寸变化不应破坏内容与交互结构。|保留既有布局；通知适配动态视口与安全区。|390/430/768及横屏模拟待验证；真实 iPhone 键盘、PWA 不可由模拟替代。|
|H17 光学引擎|`napa-crystal.js` 仅采样同源已知壁纸，单共享 WebGL1、受限纹理／像素，滚动期间 CSS 回退。|S3、S5：Web 可以表达 lensing，但不具有原生任意背后内容或系统材质管线。|保留已验证采样位移；约束绘制预算，明确回退；减少透明度时停止绘制。|真实渲染路径、DPR、坐标、context loss、滚动与闲置待验证。|
|H18 模态可访问性|有 dialog/aria-modal与Escape，但原背景 Tab 隔离和返回焦点缺失。|S4 Controls/Windows and modals、S7：可操作性是材料和动态效果成立的前提。焦点细节属于 W 实现责任。|通知作为显式 opt-in 原型；同步 expanded/controls、隔离背景、返回来源，避免陈旧关闭任务误隐藏重开面板。|待 Tab/Shift+Tab/Escape、程序打开、快速重开、外部隐藏和切页面验证。|

## 本轮原型与有意保留的差异

### 首页

保留三张原生导航按钮及既有目的地，不将导航卡片改为纯展示内容。外层窗口减少重复的镜面、过渡与核心采样，首页光学重点集中到已有三卡片。卡片的背景位移能力保留，减少静态浮雕与色散的竞争，继续用局部亮度保护阅读区。这是遵循层级与克制使用原则的 **W/U 折中**，不是对三个大型玻璃入口的官方认可。

Sonoma 原图、蓝色入口、空间登录、原圆角与布局体系属于明确保留的品牌差异。未以 2025 或 2026 原生系统截图反推 Web 数值规范。调试档仅用于校准，不作为默认审美目标。

### 通知中心

通知面板使用一个较稳定的功能材质，内部条目使用普通填充，正文与次级文字有独立颜色。呈现原点参考通知入口的位置；进入、关闭、Escape、背景点击、快速重开以及焦点返回需要作为一个生命周期检查。现有筛选、已读、全部已读、通知目标和权限仍由原业务逻辑处理。

原型采用 Web Animations 与 DOM 焦点管理。源码中的动画时长、缩放和缓动均是 Uni 工程参数；来源关联只表达操作因果，不声称与原生 Action Sheet 的路径、弹性或材料变形完全一致。

### 无障碍与偏好

减少透明度与原有玻璃强度分别保存；开启辅助模式不应覆盖原强度。支持媒体查询的浏览器跟随系统，不支持时提供应用内设置。高对比度、强制颜色和减少动态效果继续保留。该应用内模式不是修改 macOS 系统设置，也不能保证所有浏览器将系统偏好暴露给网页。

## 当前文件边界

|文件|本轮职责|
|---|---|
|`public/styles/napa-fidelity.css`|首页重复材质收敛、通知内容／功能层、辅助模式和回退|
|`public/scripts/napa-presentation.js`|通知呈现与焦点生命周期、减少透明度偏好；不拥有登录、消息或通知业务数据|
|`public/index.html`|样式脚本接入、辅助设置、通知原函数的显式接入|
|`public/scripts/napa-crystal.js`|减少透明度状态进入原渲染停止／回退路径|
|`scripts/preview-napa.cjs`|隔离预览和合成数据；不启动生产服务或数据库|
|`test/browser/napa-fidelity.cjs`|定向原型检查；必须先核对 fixture 和实际函数契约|
|`docs/NAPA-APPLE-FIDELITY.md`|官方原则、审查矩阵、实现和验收边界|

## 2026-11-17 工程验收

本轮由主代理顺序执行，复用已保存来源账本与审查资料。未调用子代理、重新研究官方资料或扩展至全站改造；未操作生产服务、用户数据或 Git 历史。

恢复核查发现上轮实际记录为 14/15 通过，浅色首页曾在等待条件超时。此次先核对 fixture：3 条合成通知、2 条未读、帖子和用户目标齐全；认证成功本身会拉取通知。页面的 fidelity 样式、presentation 脚本与预览白名单均已接入。

原 15 项测试本轮完整运行 **15/15 通过**。随后补查并修复了三个通知边界问题：

1. **短横屏溢出**：原列表 `min-height:240px` 使 390px 高窗口中的列表底部达到 453px，越过面板底部 368px。只在通知样式将最小高度改为 0，让既有 grid 分配剩余高度并滚动。
2. **窗口缩放释放背景隔离**：从聊天打开通知后，原导航 resize 回调会将背景 `.app.inert` 改回 false。通知呈现层现在只在打开期间观察被隔离节点的 inert 属性，维护模态隔离；关闭时断开观察并恢复当前页面语义。没有修改光学核心。
3. **背景点击关闭后丢失返回焦点**：非焦点背景的鼠标点击可先将焦点移到 body，原 `ownedFocus` 判断因此跳过返回。body 现被纳入此关闭流程的所有权判断；目标跳转继续通过 `restoreFocus:false` 选择不返回。

新增断言并入原 15 项，没有删减断言或增加虚假的通过项。首次补强复测 8 项中 7 项通过，1 项因错误假设“登录后总请求应为一次”失败；检查实际认证逻辑后改为“每次点击仅增加一次请求”，并验证反复打开不会重复请求。该流程与错误收集的 2 项复测通过；最终焦点／竞态／减少动态等 5 项复测通过。**受修改影响的 8 项最终均有通过记录，其余 7 项沿用本轮完整运行结果；不是修复后再次全量重跑。** 所有中间失败记录保留。

|验证项目|实际结果与边界|
|---|---|
|Chromium|Microsoft Edge 157.0.4341.46 无头浏览器实际渲染；原 15 项通过，相关补强项通过。不是图像生成或静态效果图。|
|首页|1440×960 浅深主题和 390×844、768×844 的三卡片前后几何保持一致；Sonoma 壁纸与入口保留。|
|通知|筛选、全部已读、帖子与用户目标、Tab/Shift+Tab、Escape、关闭重开竞态、减少动态中途切换通过；补充背景点击返回、聊天窗口缩放隔离、844×390 横屏列表滚动通过。仅验证合成传输下的真实前端，不替代生产后端验证。|
|减少透明度|偏好重载、玻璃强度 0 的保留、停止 WebGL 和恢复通过。未修改系统设置。|
|阅读保护|浅／深主题各 12 个首页文字区域，按画布及局部填充合成采样最低 5.337:1；不是全站 WCAG 认证，也未涵盖所有字号、显示器或动态背景。|
|光学|实际路径 webgl1-to-2d；22 CSS px 折射带、直边峰值 6px、圆角 12px、R/B 峰值分离 1.4px、浮雕 .52。校准开启／零位移的边缘平均最大通道差 27.293/255，中心最大差 0；通道差不是位移像素数。|
|静止预算|DPR1 单卡最大 232152 像素，闲置 draw 计数 24→24，通知展开没有引发持续卡片重绘。该短采样不等于 GPU 能耗／内存分析。|
|Safari|本机安装版本 27.2。控制接口在调用间切回既有标签，无法稳定保持独立预览窗口与截图；停止重试以免干扰用户。仅观察到合成首页加载，不认定本轮 Safari 视觉、交互、控制台、移动或无障碍验收通过。未将其他窗口或 Chromium 截图当作 Safari 证据。|
|动效证据|保存 Chromium 修改前后进入、打开、退出关键帧及可交互预览；现有环境缺少录制所需 FFmpeg，未安装依赖，未产出视频。关键帧不是精确时序或原生动画等效证明。|
|语法／保护|presentation、crystal、预览与测试脚本语法、HTML 中 2 个内联脚本解析、Git 空白检查通过。index 与 optical core 本轮内容未修改；生产数据与之前 stash 保留。|
|未执行|真实 iPhone、PWA、软键盘、Safari 完整验收、全站业务测试、真实网络／数据库和长期 GPU／功耗检查。|

完整执行记录、原始 JSON、补强失败与复测、截图索引见：

`/Users/mushin/Documents/Codex/2026-11-06/uni-5-sonoma-uni-5-sonoma/outputs/apple-fidelity-acceptance-2026-11-17/ACCEPTANCE.md`

只在合成数据预览中检验原前端。原型具备继续进行人工视觉审阅的条件；**不等于 Safari 全面通过、全站设计符合或公开发布就绪**。

## 性能与降级方案

保留既有共享 WebGL 上下文、有限纹理和画布预算、按需绘制与滚动期间回退。通知原型使用有限的 transform/opacity 动画，主要面板一个背景采样层，内部列表不再逐条叠滤镜。减少透明度时应停止首页 WebGL 更新；减少动态时应直接达到可操作状态。

需要明确的技术限制：

- 引擎只对已知 Sonoma 壁纸重采样，不能折射任意后方 DOM、用户图片或视频；没有物理光线追踪。
- WebGL 的帧提交耗时和 draw 计数不等于 GPU 总耗时、显存峰值或电池功耗。需设备级分析才可给出结论。
- 悬停或页面 CSS 变换过程中，缓存画布与背景可能短暂不能逐帧配准；本批未宣称已实现原生同步材料变形。
- 浏览器无法自动复用 SwiftUI/AppKit 的材质合并、前景 vibrancy、系统显示管理和触觉行为。
- CSS/backdrop/WebGL 不支持、context loss、低内存及节流条件下，应保留可读普通材质和全部业务入口。

## 后续处理顺序与完成边界

先完成本批首页和通知原型的实际验收，再按内容角色处理论坛正文／编辑器、用户资料与设置，最后统一其他菜单的来源与焦点生命周期。每一批保留现有安全、持久化、草稿、IME 和 U19 行为；不因本批视觉或自动化检查通过就认定全站符合或适合公开发布。

尚未关闭：全站内容玻璃叠层、其他弹层／菜单的完整焦点生命周期、动态背景配准限制、实际 iPhone/PWA与GPU功耗验证，以及 U11 历史隐私风险。不得为达到全项完成而更改这些状态。

## 证据索引

任务输出根目录：

`/Users/mushin/Documents/Codex/2026-11-06/uni-5-sonoma-uni-5-sonoma/outputs/apple-fidelity-2026-11-15/`

- `research/OFFICIAL-SOURCE-LEDGER.md`：官方来源、章节、实际含义及 A/O/W/U 分类。
- `research/source-manifest.json`：已保存来源及校验信息；同目录为官方正文和 WWDC 字幕。
- `research/ui-audit.md`：18 项实施前只读审查，保留起点行号。
- `before/`、`baseline.json`：本轮开始前的文件快照与工作区保护记录。
- `../apple-fidelity-acceptance-2026-11-17/`：本轮独立验收目录；`ACCEPTANCE.md`、`gallery.html`、`chromium/`、`targeted/`、`flow-recheck/`、`focus-recheck/`、`runtime-review.json` 与 `final-state.json` 记录最终证据及局限。旧 Safari 图像不作为本轮证据。
