# PX–03.1 参考项目研究：复古科幻终端 / 伪档案系统

状态：`research complete / calibration input`
日期：`2026-08-21`

## 研究目标

不是寻找可以照搬的界面，而是回答：成熟项目如何让复古科幻界面具有可信的机构身份、设备逻辑和信息秩序，同时仍然可用。研究结论只服务于 LUMEN 既有素材库与白板拓扑。

## 项目拆解

### 1. Alien: Isolation

来源：[Art of the Title — Alien: Isolation](https://www.artofthetitle.com/title/alien-isolation/)

- 核心机制：所有 UI 共享“黑匣子 / 有限数据恢复”的叙事依据；年代感来自旧技术对原始信号的处理，而不是任意叠加复古滤镜。
- 功能分层：角色内部信息使用清晰、抽象、极简的功能层；角色实际接触的设备才允许笨重、过时、低保真。
- 对 LUMEN 的转译：素材、搜索和关键操作属于清晰功能层；登记、索引、扫描和窗口入场属于系统反馈层。素材图像本身不得被持续失真。
- 禁止照搬：VHS 噪声、故意难用、黄绿单色终端和游戏内世界交互。

### 2. Observation

来源：[Observation — Steam](https://store.steampowered.com/app/906100/Observation/)

- 核心机制：玩家不是观看一个终端，而是“成为”空间站系统；位置、角度、摄像机、链接和系统状态共同构成持续一致的视角。
- 对 LUMEN 的转译：把顶栏和详情栏解释为真实的索引通道与记录视角，显示来源、媒体类型、访问状态、尺寸和文件体积等真实遥测。
- 禁止照搬：全屏摄像机 HUD、空间站舱段导航和覆盖内容的瞄准框。

### 3. SIGNALIS

来源：[rose-engine — SIGNALIS](https://rose-engine.org/signalis/)

- 核心机制：高对比模块舱、固定信息槽、有限状态色和明确的当前对象焦点；每一块信息都对应物品、诊断或动作。
- 对 LUMEN 的转译：详情栏顶部使用 TYPE / FRAME / SIZE 摘要舱；设置页使用固定编号模块，而不是散落的普通表单段落。
- 禁止照搬：橙红主色、像素字体正文、CRT 全屏遮罩和生存恐怖库存布局。

### 4. Control / FBC Firebreak UI explorations

来源：[FBC Firebreak — Early UI Concepts](https://www.behance.net/gallery/231644319/FBC-FIREBREAK-EARLY-UI-CONCEPTS)

- 核心机制：先尊重已经成立的 Control 导航与品牌蓝图，再测试 clean/minimal、CRT/retro、dot matrix/continuous feed 等表面系统；制度感来自分类、记录、删节和机构术语。
- 对 LUMEN 的转译：继续保持 LUMEN 原布局，用编号、权限、记录表和连续登记线深化内部层级；主题不能另建启动页、模式轨道或底部任务栏。
- 禁止照搬：FBC 品牌、档案红的大面积占用、删节条装饰泛滥和游戏任务层级。

### 5. NASA Graphics Standards Manual (1976)

来源：[NASA Graphics Standards Manual PDF](https://www.nasa.gov/wp-content/uploads/2015/01/nasa_graphics_manual_nhb_1430-2_jan_1976.pdf)

- 核心机制：网格不是背景纹理，而是组织标题、正文、图像、说明和编号的共同底层；技术图使用明确边框，规则线负责区分信息，开放空间同样是系统的一部分。
- 对 LUMEN 的转译：设置页建立 00—06 纵向模块网格；顶栏遥测、白板工具通道、详情摘要使用一致列宽、基线和边界。
- 禁止照搬：NASA 标志、具体字体规范、出版物页面比例和大面积白底。

## 合并后的设计公式

`NASA 的机构网格 + Alien: Isolation 的功能/设备分层 + Observation 的真实遥测 + SIGNALIS 的模块舱 + Control 的档案制度叙事`

## 本轮落地

1. 顶栏新增 CHANNEL / MEDIA / ACCESS 三列真实遥测；窄屏自动隐藏，不挤压关键操作。
2. 详情预览下增加 TYPE / FRAME / SIZE 摘要舱，数据来自当前素材，不使用随机伪代码。
3. 设置页按 00 INTERFACE、01 INGEST、02 WATCH、03 ARCHIVE、04 MODEL、05 INPUT、06 SYSTEM 建立统一模块网格。
4. 保留素材无损、原导航拓扑和既有白板工作区；本轮不追加持续噪声、全屏 HUD 或新导航。

## 验收条件

- 微型信息必须对应真实状态或明确的系统职责，不得只有装饰作用。
- 1366px 级中等窗口下遥测可降级隐藏，顶栏、工具栏和 AI 处理不可被挤出。
- 设置长内容继续独立滚动，标题与完成按钮固定。
- 素材图像最终保持 `filter:none`，系统网格不进入素材内容层。
- 两主题仍共享同一功能路径，切换后不改变导航位置和任务流程。
