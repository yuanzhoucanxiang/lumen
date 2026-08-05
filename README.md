# LUMEN

> 类 Eagle 的本地素材管理桌面应用：收集、整理、检索你的图片 / 视频 / 音频 / 字体 / PSD 素材。
> 数据全部存在本地，无需注册、无需联网（联网仅用于自动更新）。

当前版本 **v0.5.4**。安装包下载：<https://github.com/yuanzhoucanxiang/shiguang-materials/releases/latest>

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
│   ├── clipServer.ts      # 浏览器剪藏 HTTP 服务（127.0.0.1:45678）
│   ├── watcher.ts         # 监控文件夹自动导入（递归）
│   ├── updater.ts         # electron-updater 状态机
│   └── ipc.ts             # IPC 通道注册
├── preload/index.ts       # contextBridge 暴露 window.api
└── renderer/src/
    ├── App.tsx            # 布局 / 快捷键 / 粘贴导入
    ├── stores/libraryStore.ts
    └── components/        # Sidebar / Toolbar / Gallery / Inspector / Preview / Editor ...
```

## 开发

```bash
npm install              # postinstall 会自动 electron-rebuild better-sqlite3
npm run dev              # 开发模式（主进程重启 + 渲染 HMR）
npm run typecheck        # 类型检查（node + web）
npm run build:win        # typecheck + 构建 + electron-builder 打包
```

### 国内网络环境

`.npmrc` 已配置 electron / sharp 镜像。ffmpeg-static 安装前需：

```bash
export FFMPEG_BINARY_HOST="https://npmmirror.com/mirrors/ffmpeg-static"
```

打包时建议：

```bash
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
```

## 功能概览

- 导入：拖拽 / 按钮 / Ctrl+V 粘贴 / 浏览器剪藏（LUMEN Clip 扩展）
- 浏览：瀑布流 / 网格 / 列表，虚拟滚动，悬停预览（GIF/视频/音频自动播放）
- 检索：搜索、格式 / 颜色色环 / 星级 / 未标注 / 导入日期筛选
- 整理：标签（颜色 + 分组）、多级文件夹、智能文件夹、批量打标签 / 评分
- 查重：dHash 汉明距离归组 + 以图搜图
- 编辑：画笔 / 矩形 / 箭头 / 文字批注 + 裁剪（15 步撤销）
- 导出：到文件夹 / 打包 ZIP
- 多库切换、监控文件夹自动导入、自动更新

## 发布流程

1. `package.json` 版本号 +1
2. `npm run build:win`
3. `gh release create vX.X.X dist/Lumen-X.X.X-setup.exe dist/Lumen-X.X.X-setup.exe.blockmap dist/latest.yml --title "LUMEN vX.X.X" --notes "..."`

> 安装包文件名必须用 ASCII（GitHub 附件名会剥掉非 ASCII 字符，中文名会导致 latest.yml 引用 404）。

## 许可证

MIT
