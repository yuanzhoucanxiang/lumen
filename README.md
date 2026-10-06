# LUMEN

> 类 Eagle 的本地素材管理桌面应用：收集、整理、检索你的图片 / 视频 / 音频 / 字体 / PSD 素材。
> 数据全部存在本地，无需注册、无需联网（联网仅用于自动更新）。

当前版本 **v0.8.31**。安装包下载：<https://github.com/yuanzhoucanxiang/shiguang-materials/releases/latest>

---

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面框架 | Electron 41（主进程 + preload + 渲染进程） |
| 构建 | electron-vite 3 + Vite 6 |
| 前端 | React 19 + TypeScript 5.9 + Tailwind CSS 4 |
| 状态管理 | zustand 5 |
| 数据库 | better-sqlite3（库目录内 `library.db`） |
| 图像处理 | sharp（缩略图 / 主色 / dHash 指纹） |
| 视频封面 | ffmpeg-static |
| PSD 解析 | ag-psd |
| 字体样张 | fontkit |
| 打包发布 | electron-builder + electron-updater（GitHub Releases） |

## 目录结构

```
src/
├── shared/types.ts        # 主/渲染进程共享类型
├── main/                  # 主进程
│   ├── index.ts           # 入口：窗口、asset:// 协议、剪藏服务、回收站清理
│   ├── db.ts              # SQLite 初始化与增量迁移
│   ├── library.ts         # 多库配置管理
│   ├── repository.ts      # 数据 CRUD / 查询引擎 / 重复检测
│   ├── importer.ts        # 导入管线：缩略图 / 主色 / dHash / 视频封面
│   ├── editor.ts          # 编辑器保存
│   ├── exporter.ts        # 导出文件夹 / ZIP
│   ├── clipServer.ts      # 本机接收 HTTP 服务（127.0.0.1:45678）：浏览器剪藏 /clip + Agent /import
│   ├── agentSkill.ts      # 「lumen」技能随包分发与一键安装到 agent 技能目录
│   ├── watcher.ts         # 监控文件夹自动导入（递归）
│   ├── updater.ts         # electron-updater 状态机
│   └── ipc.ts             # IPC 通道注册
├── preload/index.ts       # contextBridge 暴露 window.api
├── renderer/src/
│   ├── App.tsx            # 布局 / 快捷键 / 粘贴导入
│   ├── stores/libraryStore.ts
│   └── components/        # Sidebar / Toolbar / Gallery / Inspector / Preview / Editor ...
└── agent-skill/           # 「lumen」Agent 技能源文件（extraResources 打进 resources/skill）
```

## 开发

```bash
npm install              # postinstall 会自动 electron-rebuild better-sqlite3
npm run dev              # 开发模式（主进程重启 + 渲染 HMR）
npm run typecheck        # 类型检查（node + web）
npm run build:win        # typecheck + 构建 + electron-builder 打包（Windows）
npm run build:mac        # 同上（macOS，需在 Mac 上运行；首次需装 Xcode Command Line Tools）
```

## macOS 安装

macOS 安装包（Intel `x64` 与 Apple Silicon `arm64` 两种）由 GitHub Actions 在推送 `v*` tag 时自动构建，随 Windows 包一起发布到 <https://github.com/yuanzhoucanxiang/shiguang-materials/releases/latest>：

1. 下载 `Lumen-<版本>-x64.dmg`（Intel）或 `Lumen-<版本>-arm64.dmg`（Apple Silicon），打开后把 LUMEN 拖入 Applications。
2. **首次打开必须放行**（应用未签名、未公证，macOS Gatekeeper 会拦截）：
   - 方式一：在「访达」中 **右键 LUMEN.app → 打开**，在弹窗中点「打开」；
   - 方式二：系统设置 → 隐私与安全性 → 滚动到「安全性」→「仍要打开」。
3. 若提示「已损坏，无法打开」（浏览器下载附加的隔离属性所致），终端执行：

   ```bash
   xattr -cr /Applications/LUMEN.app
   ```

4. 自动更新在 macOS 走 zip 差分更新；每次更新后首次启动同样需要按第 2 步放行一次。

> 双架构自动更新元数据（latest-mac.yml）由 CI 的 `merge-update-metadata` 任务合并，
> 两个架构的更新互不覆盖。源码仓库的 Actions 需配置 `RELEASE_PAT` secret
> （**classic PAT**，勾 `repo` 或 `public_repo`；fine-grained token 无法上传 Release
> 资产，会 403）才会把产物上传到 Release；未配置时产物保留在 Actions Artifacts，
> 可手动下载上传。

### 国内网络环境

`.npmrc` 已配置 electron / sharp 镜像（旧式配置键，npm 10 有效但会告警；**npm 11+ 将不再转发未知配置键**，届时请改用下面的环境变量方式）。

完整环境变量方案（Windows PowerShell，可替代 `.npmrc`，未来 npm 大版本升级后的推荐方式）：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
$env:SHARP_BINARY_HOST="https://npmmirror.com/mirrors/sharp"
$env:SHARP_LIBVIPS_BINARY_HOST="https://npmmirror.com/mirrors/sharp-libvips"
$env:FFMPEG_BINARY_HOST="https://npmmirror.com/mirrors/ffmpeg-static"
```

macOS / Linux（bash）等价形式：

```bash
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
export SHARP_BINARY_HOST="https://npmmirror.com/mirrors/sharp"
export SHARP_LIBVIPS_BINARY_HOST="https://npmmirror.com/mirrors/sharp-libvips"
export FFMPEG_BINARY_HOST="https://npmmirror.com/mirrors/ffmpeg-static"
```

## 功能概览

- 导入：拖拽 / 按钮 / Ctrl+V 粘贴 / 浏览器剪藏（LUMEN Clip 扩展）/ AI Agent 按路径批量导入
- 浏览：瀑布流 / 网格 / 列表，虚拟滚动，悬停预览（GIF/视频/音频自动播放）
- 检索：搜索、格式 / 颜色色环 / 星级 / 未标注 / 导入日期筛选
- 整理：标签（颜色 + 分组）、多级文件夹、智能文件夹、批量打标签 / 评分
- 查重：dHash 汉明距离归组 + 以图搜图
- 编辑：画笔 / 矩形 / 箭头 / 文字批注 + 裁剪（15 步撤销）
- 导出：到文件夹 / 打包 ZIP
- 多库切换、监控文件夹自动导入、自动更新
- Agent 接入：内置「lumen」技能，设置页一键安装，AI 助手可整理散落图片并自动打标签归档

## Agent 接入（本地 API）

LUMEN 运行时在本机 `127.0.0.1:45678` 提供 HTTP 接口（仅监听回环地址，需携带请求头 `x-lumen-client: lumen-clip/1`），供浏览器剪藏扩展与本机 AI Agent 调用：

| 端点 | 说明 |
|------|------|
| `POST /import` | 按路径批量导入（支持目录递归、查重跳过），可选 `tags` 打标签、`folder` 归文件夹（支持 `A/B` 多级自动创建）、`move` 移动导入、`note` 把 prompt/生成信息写入素材备注（可被搜索）、`checkSimilar` 相似检测（回传库内近似素材，防近重复图入库）、`validate` 试运行（只预估不导入）；未指定 `folder` 时新素材自动归入「Agent 导入」专属文件夹，与用户素材区分；返回逐文件明细 `files`，跳过的重复文件回传命中的库内素材 `matchedIds` 并照常补标签/归档（幂等重跑安全） |
| `GET /assets` | 查询素材（只读）：`q` 关键词（搜名称+备注+拼音）、`ext` 扩展名、`tag` 标签名、`limit`≤500，返回窄列字段 |
| `GET /stats` | 库汇总（只读）：素材总数、回收站数、标签/文件夹数、Agent 导入文件夹张数 |
| `GET /tags` / `GET /folders` | 列出现有标签 / 文件夹 |
| `GET /status` | 服务探测，返回版本号与素材库路径 |
| `POST /clip` | 单图导入（dataUrl / imageUrl），浏览器剪藏扩展使用 |

技能文件随安装包内置（`resources/skill/`），用户在「设置 → Agent 接入」一键安装到 `~/.agents/skills/lumen`（检测到 Claude Code 时同步 `~/.claude/skills/lumen`），无 agent 的用户不受影响。源文件位于仓库 `agent-skill/`。

## 发布流程

**一键发布**（自动版本号 +1、生成分点 notes、打包、创建 Release、git tag + push）：

```bash
node scripts/release.cjs                # 发布（patch 版本 +1）
node scripts/release.cjs --bump minor   # 次版本号 +1
node scripts/release.cjs --dry-run      # 预览：生成 notes 草稿 + 校验格式，不打包不发布
node scripts/release.cjs --notes my.md  # 使用指定 notes 文件
node scripts/release.cjs --no-git       # 不执行 git tag/push
```

流程：版本 bump → notes 生成/校验 → `npm run build:win` → `gh release create` → git tag + push。

- **notes 来源**：优先读 `notes.md`（存在则直接使用）；不存在则从 `工作日志.md` 最后一条里程碑**自动生成分点草稿**写入 `notes.md`，编辑后再次运行即可发布。
- **格式校验**：发布前校验 notes 必须是「分类标题 + `·` 条目」格式，不合规会中止。

> 安装包文件名必须用 ASCII（GitHub 附件名会剥掉非 ASCII 字符，中文名会导致 latest.yml 引用 404）。

### Release Notes 格式约定（应用内分类分点展示）

应用内更新卡片会按以下格式解析并渲染为「分类标题 + 圆点条目」：

```
✨ 新功能
· 侧栏分区折叠
· 支持格式筛选

🐛 修复
· 修复导出覆盖同名文件

⚙️ 优化
· 导入速度提升
```

- 空行分隔分类区块
- 非 `·` 开头的行 = 分类标题（加粗显示）
- `·` 开头的行 = 条目（圆点缩进）
- 纯文本（无分类）也能正常显示

建议分类：`✨ 新功能` / `🐛 修复` / `⚙️ 优化` / `🔧 技术`

## 许可证

MIT
