import { useDeferredValue, useMemo, useState } from 'react'
import Icon from './Icon'

type GuideBlock = {
  title: string
  body?: string
  steps?: string[]
  bullets?: string[]
  shortcuts?: Array<[string, string]>
  tip?: string
  warning?: string
}

type GuideSection = {
  id: string
  number: string
  title: string
  eyebrow: string
  summary: string
  keywords: string[]
  blocks: GuideBlock[]
}

const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'quick-start',
    number: '01',
    title: '第一次使用',
    eyebrow: 'QUICK START / 5 MIN',
    summary: '从建立素材库到完成第一次整理，用最短路径理解 LUMEN 的工作方式。',
    keywords: ['新手', '开始', '素材库', '导入', '整理', '备份'],
    blocks: [
      {
        title: '先理解三个层级',
        bullets: [
          '素材库是最上层的数据容器，保存数据库、原始文件、缩略图和编辑结果。不同项目建议使用不同素材库。',
          '文件夹负责固定归档；同一素材可被组织到文件夹中。标签、评分和颜色适合表达跨文件夹的属性。',
          '白板是独立的视觉工作区。放入白板的是素材引用，不会复制或移动素材库里的原文件。'
        ]
      },
      {
        title: '推荐的首次流程',
        steps: [
          '在左下角素材库区域创建或打开一个素材库，并确认库名称。',
          '进入“设置 → 偏好设置”，把导入方式设为“复制文件”。这样原位置仍保留一份文件。',
          '点击顶栏“导入”，选择一批图片或视频；也可以把文件拖进窗口，或粘贴剪贴板中的截图。',
          '新建一个项目文件夹，把素材拖到文件夹；再用标签记录人物、地点、用途或风格。',
          '给关键素材评 1–5 星，并尝试搜索名称、注释或标签。',
          '完成第一轮整理后，在设置中执行一次“导出完整库 ZIP”。'
        ],
        tip: '建议先导入 20–50 个文件熟悉流程，再迁移大体量素材。'
      },
      {
        title: '界面区域',
        bullets: [
          '左侧：素材库入口、文件夹、智能文件夹、白板和标签。',
          '顶部：导入、搜索、格式/颜色/星级/日期筛选、排序、查重、AI 处理与视图切换。',
          '中央：素材墙或白板工作区。',
          '右侧：当前选中素材的评分、标签、注释、主色调和文件信息；多选时显示批量操作。'
        ]
      }
    ]
  },
  {
    id: 'import-library',
    number: '02',
    title: '导入与素材库',
    eyebrow: 'INGEST / LIBRARY',
    summary: '选择合适的导入方式，掌握批量导入、自动监控和素材库边界。',
    keywords: ['导入', '拖拽', '粘贴', '复制', '移动', '监控文件夹', '格式', '视频', '截图'],
    blocks: [
      {
        title: '六种导入入口',
        bullets: [
          '按钮导入：点击顶栏“导入”，适合从多个目录精确选择文件。',
          '拖拽导入：从资源管理器把文件拖到 LUMEN 窗口，看到导入遮罩后松开。',
          '剪贴板导入：复制图片文件或截图后，在素材库界面按 Ctrl/Cmd+V。',
          '链接抓图：复制图片网址后按 Ctrl/Cmd+V，LUMEN 直接下载网页图片入库，一次可粘多条链接。',
          '监控文件夹：在设置中添加目录，之后该目录及子目录中的新文件会自动进入当前素材库。',
          '区域截图：点击顶栏“截图”，窗口自动隐藏后拖框选取屏幕任意区域，松开即入库（Esc 取消）。'
        ]
      },
      {
        title: '复制与移动怎么选',
        bullets: [
          '复制文件（推荐）：LUMEN 保存独立副本，原文件保持不变。适合正式项目、移动硬盘和多人交接。',
          '移动文件：导入成功后原位置不再保留该文件。适合把临时收件箱彻底归档，但操作前应确认已有备份。',
          '切换导入方式只影响之后的导入，不会改动已经入库的素材。'
        ],
        warning: '“移动文件”会改变原目录内容。首次使用、来源盘不稳定或文件只有一份时，请使用复制模式。'
      },
      {
        title: '导入后的检查',
        steps: [
          '观察顶部素材计数是否增长，并等待缩略图生成完成。',
          '用格式筛选确认图片、视频、音频或其他文件是否齐全。',
          '点击重复素材检查，处理内容相同或高度重复的文件。',
          '若某个文件失败，先导出运行日志，再检查源文件权限、路径长度和文件是否损坏。'
        ],
        tip: '监控文件夹适合“下载收件箱”或相机同步目录，不建议直接监控素材库自身目录，以免形成重复导入。'
      }
    ]
  },
  {
    id: 'organize',
    number: '03',
    title: '整理与分类',
    eyebrow: 'FOLDERS / TAGS / RULES',
    summary: '组合使用文件夹、标签、评分、颜色和智能文件夹，建立可持续的分类系统。',
    keywords: ['文件夹', '标签', '标签组', '智能文件夹', '评分', '颜色', '注释', 'markdown'],
    blocks: [
      {
        title: '文件夹：稳定的项目结构',
        steps: [
          '点击文件夹分区右侧“+”创建文件夹；可继续建立子文件夹。',
          '选中一个或多个素材，将素材卡片拖到目标文件夹。',
          '右键文件夹可重命名、调整结构或删除。删除文件夹前留意确认信息，避免把“删除容器”和“删除素材”混淆。',
          '白板模式下切换文件夹只会更换左侧参考来源，不会退出白板，也不会移除已经放入画布的内容。'
        ]
      },
      {
        title: '标签：跨项目维度',
        bullets: [
          '标签适合人物、地点、视觉风格、版权状态和使用阶段等可交叉属性。',
          '多选素材右键「批量重命名…」可套模板批量改名，支持 {原名}/{序号}/{日期} 占位符。',
          '在右侧详情栏添加标签；多选素材后可批量添加。标签可分组、改色、重命名和移动分组。',
          '“AI 优先”标签会被推荐给 AI；“AI 排除”标签不会被 AI 自动生成，适合保留人工专用词或敏感词。',
          '删除标签只删除分类关系，不会删除素材文件。'
        ]
      },
      {
        title: '智能文件夹：保存一组条件',
        steps: [
          '在智能文件夹分区新建规则，组合格式、评分、标签、颜色、日期或文本条件。',
          '保存后它会随素材属性自动更新，不需要手工拖入。',
          '右键智能文件夹可编辑条件或删除；删除规则不会影响素材。'
        ],
        tip: '一个实用组合：建立“未标注”“五星候选”“最近导入”和“待交付”四个智能文件夹，作为每日整理队列。'
      },
      {
        title: '评分、颜色与注释',
        bullets: [
          '1–5 星用于质量或优先级；选中素材后直接按数字键即可评分。',
          '颜色适合表达状态，例如红=待处理、黄=待确认、绿=已交付。颜色筛选位于顶栏。',
          '注释支持 Markdown，可记录来源、版权、镜头用途和修改意见；搜索会同时匹配名称与注释。'
        ]
      }
    ]
  },
  {
    id: 'browse-edit',
    number: '04',
    title: '查找、预览与编辑',
    eyebrow: 'FIND / INSPECT / EDIT',
    summary: '从几百到几万条素材中快速缩小范围，并完成查看、比较和非破坏编辑。',
    keywords: ['搜索', '筛选', '排序', '瀑布流', '列表', '预览', '1:1', '相似图片', '编辑', '裁剪'],
    blocks: [
      {
        title: '逐层缩小结果',
        steps: [
          '先选择左侧文件夹、标签或智能文件夹，确定数据范围。',
          '在搜索框输入名称、标签或注释关键词。',
          '继续叠加格式、颜色、星级、标记和日期条件。',
          '最后按导入时间等字段排序，并切换网格、瀑布流或列表视图。',
          '要恢复全部结果，逐项清除搜索词和已启用的筛选条件。'
        ]
      },
      {
        title: '选择与批量操作',
        bullets: [
          '单击选择；Ctrl/Cmd+单击追加或取消；Shift+单击选择连续区间；图库空白处按住拖拽可橡皮筋框选。',
          '多选后，右侧会出现批量评分、批量标签和 AI 处理。右键操作会以当前选中组为范围。',
          '方向键在当前结果中前后移动选择；Escape 清除选择并关闭预览或编辑器。'
        ],
        shortcuts: [
          ['Ctrl/Cmd+A', '全选当前结果'],
          ['1–5', '为当前素材评分'],
          ['Delete', '移入回收站'],
          ['Ctrl/Cmd+Z', '撤销最近一次删除']
        ]
      },
      {
        title: '预览与相似搜索',
        bullets: [
          '选中单个素材后按空格打开预览；左右方向键浏览相邻素材。再次按空格或 Escape 关闭。',
          '图片预览支持缩放、拖动和 1:1 实际像素查看；视频在预览中直接播放。',
          '右键图片选择“搜索相似图片”，可按视觉特征寻找近似构图或重复版本。',
          '“在资源管理器中显示”用于定位 LUMEN 实际保存的文件。'
        ]
      },
      {
        title: '图片编辑的安全边界',
        bullets: [
          '支持的图片可进入编辑器完成裁剪和调整。编辑结果与原图分开保存。',
          '右键“恢复原图”会丢弃当前编辑结果，恢复为导入时的原始图片。',
          '恢复原图不可撤销；重要版本应先导出一份。'
        ]
      }
    ]
  },
  {
    id: 'ai',
    number: '05',
    title: 'AI 智能处理',
    eyebrow: 'RENAME / TAG / SEARCH',
    summary: '连接兼容模型，让 AI 批量建议名称和标签，同时保留人工审核与词表控制。',
    keywords: ['AI', 'API Key', '模型', '智谱', '通义', 'Ollama', '重命名', '自动标签', '语义搜索', '找图助手', '对话找图'],
    blocks: [
      {
        title: '完成模型配置',
        steps: [
          '进入“设置 → 偏好设置 → AI 智能处理”。',
          '填写服务商提供的 Base URL、支持视觉输入的模型名称和 API Key。',
          '先点击“测试连接”，确认返回连接成功，再开始批量任务。',
          '若使用本地 Ollama，需先保证模型服务已启动且 Base URL 可从本机访问。配置好的服务商可点「保存当前配置」存为档案，之后在「已保存的服务商」里一键互切，不用重新填写 API Key。'
        ],
        warning: 'API Key 保存在本机配置中。使用云端模型时，缩略图和必要元数据会发送给所选服务商，请自行确认隐私与费用政策。'
      },
      {
        title: '对话式找图（助手）',
        steps: [
          '点左侧栏的「助手」打开右侧助手面板，也可以直接点面板里的示例开始。',
          '用一句话描述想找的素材，比如“最近一周导入的竖构图”“还没打过标签的图”“AI 助手导入的横图”。',
          '助手会把描述转成检索条件（关键词 / 标签 / 时间 / 构图 / 星级 / 导入来源等）并直接列出结果缩略图，点击即可预览。',
          '接着追问收窄，比如“再换成竖图的”“把时间改成一个月内”——助手会基于上一轮条件继续调整。'
        ],
        tip: '助手只读：它只帮你找、不会改动素材库；面板对话可以随时清空重开。'
      },
      {
        title: '运行一次可控的批处理',
        steps: [
          '先选中少量素材，点击顶栏“AI 处理”或右侧批量入口。',
          '选择处理范围、要生成的内容以及每张最多标签数。',
          '检查建议结果；需要时修改名称、取消不合适的标签，再应用。',
          '确认风格稳定后再扩大批次，避免一次性产生大量同义标签。'
        ]
      },
      {
        title: '维护标签词表',
        bullets: [
          '把规范词设为“AI 优先”，让模型尽量复用现有标签；可在 设置 → AI 智能处理 → AI 优先标签 里集中挑选几个大标签。',
          '把不希望自动出现的词设为“AI 排除”。',
          '定期合并同义标签，例如“夜景/夜晚”“人物/人像”，保持检索一致。',
          '“导入后自动 AI”适合已经稳定的模型与标签体系；刚开始使用时建议关闭，先人工抽检。'
        ]
      }
    ]
  },
  {
    id: 'agent',
    number: '06',
    title: 'Agent 接入',
    eyebrow: 'AI AGENT / LOCAL API',
    summary: '让电脑上的 AI 助手（ZCode、Claude Code 等）把散落各处的图片批量收进素材库，自动打标签、归文件夹。',
    keywords: ['Agent', 'AI 助手', '技能', '整理图片', '批量导入', '本地接口', 'ZCode', 'Claude', 'HTTP'],
    blocks: [
      {
        title: '安装技能（使用 AI 助手才需要）',
        steps: [
          '进入“设置 → 偏好设置 → Agent 接入”，点击“安装技能到本机 Agent”。',
          '技能会装到 ~/.agents/skills/lumen（检测到 Claude Code 时同步一份到 ~/.claude/skills/lumen）。',
          '使用其他 AI 工具时，点“打开技能文件夹”把文件手动复制过去。',
          '不使用 AI 助手可忽略本章，LUMEN 不会写入任何技能文件。'
        ],
        tip: 'LUMEN 更新后可在同一位置重新安装，获取最新版技能。'
      },
      {
        title: '让助手替你收图',
        steps: [
          '保持 LUMEN 在运行，然后对 AI 助手说“帮我把 XX 文件夹里的图整理进 LUMEN”。',
          '助手会按路径批量导入（目录连同子目录一起处理），并可顺带打标签、归入文件夹（支持 A/B 多级，缺失层级自动创建）。'
        ],
        bullets: [
          '默认复制导入，原文件保留；确需移动导入时由助手显式指定。',
          '同一批文件重复导入会自动跳过（与手动导入共用查重管线），不必担心重复入库。',
          'Agent 自己导入的图片默认归入「Agent 导入」专属文件夹，与您手动导入的素材分开，不会混淆。',
          '导入接口只监听本机 127.0.0.1，且要求携带客户端鉴权头，外部设备无法访问。'
        ],
        warning: '若助手提示连不上，先确认 LUMEN 正在运行；提示 /import 不存在说明 LUMEN 版本过旧，更新后即可。'
      }
    ]
  },
  {
    id: 'whiteboard',
    number: '07',
    title: '白板工作区',
    eyebrow: 'REFERENCE BOARD / CANVAS',
    summary: '把素材组织成视觉关系、情绪板或分镜参考，并使用标注工具完成表达。',
    keywords: ['白板', '画布', '参考素材架', '拖拽', '平移', '缩放', '文字', '形状', 'SVG', 'lumenboard'],
    blocks: [
      {
        title: '进入白板并添加参考',
        steps: [
          '点击左侧“白板工作台”；如果还没有白板，系统会创建默认白板。也可以用白板分区右侧“+”新建并命名。',
          '切换左侧文件夹或标签，筛选想要的参考素材；白板会保持在中央，不会退回素材库模式。',
          '把素材卡片拖到画布，或点击卡片上的“发送到白板”。',
          '已加入的素材会出现在专用参考素材架中。素材库列表和参考素材架均可独立收起，扩大画布。'
        ]
      },
      {
        title: '导航与选择',
        bullets: [
          '按住空格拖动画布；滚轮缩放；F 或双击空白处适配全部内容；0 或顶栏「1:1」回到 100%。',
          '选择工具下拖动空白可框选；Shift 可追加选择。拖动素材只移动素材，拖动画布不会改写素材坐标。',
          '方向键微调 1px，Shift+方向键微调 10px。右键图片可水平/垂直翻转（对标 PureRef，画师对照检查形准）。',
          '素材按原始比例上板：拖入的图片一开始就是清晰大图，渲染尺寸超过缩略图分辨率时自动切换原图，无需反复放大。',
          '白板会记住你上次的缩放与位置，重新打开或切换回来自动恢复，不用每次重新定位。',
          '右键素材或空白区域可复制、粘贴、排列、添加文字和移除画布元素。移除白板元素不会删除素材库原文件。'
        ],
        shortcuts: [
          ['Space+拖动', '平移画布'],
          ['F / 双击空白', '适配全部内容'],
          ['0 / + / −', '复位与缩放'],
          ['Ctrl/Cmd+D', '复制选中元素'],
          ['Ctrl/Cmd+Z / Y', '撤销与重做']
        ]
      },
      {
        title: '对齐、吸附与成组',
        bullets: [
          '多选后右键可**对齐**六向（左 / 水平居中 / 右、顶 / 垂直居中 / 底）、等距分布，以及网格 / 横向 / 纵向排列。',
          '拖动元素时会自动**吸附**到邻近元素的边与中心线、以及你添加的参考线上（命中时显示红色吸附线）；需要精确错位时**按住 Alt 拖动**临时关闭吸附。',
          '**按住 Shift 拖角**等比缩放，图片不会被拉变形。',
          '**Ctrl+G** 把选中元素成组：点中组内任意一个即选中整组、拖动即整组移动；**Ctrl+Shift+G** 解组。成组关系会随 .lumenboard 一起导出。',
          '图层顺序：右键「图层」四向按钮，或 **Ctrl+]** / **Ctrl+[** 上移下移一层，加 **Shift** 为置顶 / 置底。',
          '**锁定**（右键或 **Ctrl+L**）后元素不会被拖动、缩放或误删，左上角显示锁标记；仍可选中它以便随时解锁。'
        ],
        shortcuts: [
          ['Ctrl/Cmd+G', '成组'],
          ['Ctrl/Cmd+Shift+G', '解组'],
          ['Ctrl/Cmd+L', '锁定 / 解锁'],
          ['Ctrl/Cmd+] 或 [', '上移 / 下移一层（Shift 为置顶 / 置底）'],
          ['Alt+拖动', '临时关闭吸附']
        ]
      },
      {
        title: '浮动置顶窗口',
        bullets: [
          '点击工具栏「白板浮动置顶」，把当前白板作为独立小窗贴在屏幕最上层——参考作画时放在绘图软件旁边。',
          '浮动窗标题条可拖动移动；「最小化」折叠为仅标题条的窄条（仍置顶、可拖拽），「展开」还原画布。',
          '「归位」把浮动窗贴回所在屏幕右上角。',
          '浮动窗会记住上次的位置、尺寸与折叠/展开状态，重开后与上次一致。'
        ]
      },
      {
        title: '文字与绘图工具',
        bullets: [
          '顶部工具栏提供选择、手绘、箭头、直线、矩形、椭圆和文字。绘图完成后可右键调整颜色、线宽或透明度，图片可右键翻转；画布可导出 SVG、PNG 或 .lumenboard。',
          '文字是单次放置工具：点击画布后立即输入，完成后自动回到选择模式，不会连续生成空文本框。',
          '双击已有文字重新编辑；顶部属性栏可调整字体、字号和颜色。Ctrl/Cmd+Enter 或点击外部完成，空文字会自动删除。',
          '画布外观位于工具栏下方的内联抽屉，可切换背景色、网格和密度，不会遮挡画布。'
        ]
      },
      {
        title: '交换与交付',
        bullets: [
          '导出 .lumenboard：打包白板结构及引用素材，适合跨设备交换或归档可编辑版本。',
          '导入 .lumenboard：重建白板和元素，包内素材会去重后加入素材库。',
          '导出 SVG：生成可交付的矢量画布，图片会内嵌，适合放入设计文档或继续排版。'
        ],
        tip: '交付前同时保存 .lumenboard 和 SVG：前者用于继续编辑，后者用于稳定预览。'
      }
    ]
  },
  {
    id: 'export-backup',
    number: '08',
    title: '导出、备份与回收站',
    eyebrow: 'DELIVERY / SAFETY',
    summary: '区分素材导出、完整库备份和数据库备份，降低误删与设备故障风险。',
    keywords: ['导出', 'ZIP', '备份', '数据库', '日志', '回收站', '恢复', '删除'],
    blocks: [
      {
        title: '导出素材',
        steps: [
          '选中一个或多个素材，右键选择“导出…”。',
          '选择导出到文件夹或 ZIP。',
          '选择命名模板：原名、标签+原名、标签+序号或原名+序号。',
          '需要时启用“按标签分文件夹”；确认目标位置后执行导出。',
          '快捷方式：按住 Alt 把图片直接从图库拖到资源管理器或其他程序（可多选）。'
        ],
        tip: '交付给他人前先用少量素材测试命名模板，尤其注意没有标签的文件会采用兜底名称。'
      },
      {
        title: '三种安全产物',
        bullets: [
          '数据库备份：体积小，保存素材索引、标签、评分、注释和白板结构，不包含全部原文件。',
          '完整库 ZIP：包含数据库、原图和缩略图，适合迁移、长期归档和灾难恢复。',
          '运行日志：用于排查导入、AI、更新或文件权限问题，不是数据备份。'
        ],
        warning: '完整库 ZIP 完成前不要关机或拔出目标磁盘。备份完成后应在另一块磁盘上保留至少一份副本。'
      },
      {
        title: '从备份恢复',
        bullets: [
          '数据库出问题想回滚时，进入「设置 → 备份」：列表显示最近 3 代数据库快照，选一个一键恢复。',
          '恢复前 LUMEN 会自动把当前库保存为现场文件（pre-restore），防止误操作或恢复失败丢失现状。',
          '恢复需要当前素材库未被其他实例占用；若提示占用，关闭另一份 LUMEN 后重试。'
        ]
      },
      {
        title: '回收站与删除',
        bullets: [
          '素材库中的 Delete 默认把素材移入回收站，可在回收站恢复。',
          '清空或永久删除后无法通过普通撤销恢复。执行前先确认完整库备份。',
          '删除文件夹、标签、智能文件夹和删除素材是不同操作，请以确认框中的对象类型为准。'
        ]
      },
      {
        title: '建议的备份节奏',
        bullets: [
          '每天：依赖应用启动时的数据库自动备份；需要回滚时到「设置 → 备份」一键恢复。',
          '每周或重要整理后：手动导出完整库 ZIP。',
          '迁移设备或大批量删除前：额外生成一次完整库 ZIP，并验证文件可读取。'
        ]
      }
    ]
  },
  {
    id: 'preferences',
    number: '09',
    title: '主题、快捷键与更新',
    eyebrow: 'PREFERENCES / UPDATE',
    summary: '根据工作环境调整视觉语言和操作方式，并保持应用版本更新。',
    keywords: ['设置', '主题', '银盐鸦影', '像素故障', '信号故障', '快捷键', '更新', '版本', 'Agent 接入'],
    blocks: [
      {
        title: '主题不是简单换色',
        bullets: [
          '银盐鸦影是默认标准：较低干扰、强调素材与长时间整理，白板收起侧栏使用暗房接触印样语义。',
          '像素故障 PX–03.1 定义为“复古科幻终端美学 / 伪档案系统风”：继承原有素材库布局，以索引编号、点阵反馈、早期窗口层级和克制的蓝红状态位建立身份；不会给素材原图持续叠加扫描线、灰阶或色偏。',
          '信号故障 PX–02R 使用海军黑信号台、磷光青通道和洋红校验位，反馈更主动；故障校准只发生在真实交互瞬间，不持续闪烁，也不改变素材原图。',
          '主题切换立即生效并保存在本机，主素材库、设置和白板会保持同一套视觉语言。'
        ]
      },
      {
        title: '自定义快捷键',
        steps: [
          '进入“设置 → 偏好设置 → 快捷键”。',
          '点击要修改的键位按钮，再按下新的组合键。',
          '按 Escape 取消录制。Ctrl 绑定在 macOS 上同时匹配 Cmd。',
          '当前可自定义预览、全选素材和撤销删除；白板专用快捷键保持固定。'
        ]
      },
      {
        title: 'Agent 接入（可选）',
        bullets: [
          '设置页的「Agent 接入」卡片用于把 LUMEN 自带的「lumen」技能安装到本机 AI 助手（ZCode、Claude Code 等）。',
          '安装后，助手即可把散落在各文件夹的图片批量收进素材库并自动打标签、归文件夹；详见「Agent 接入」一章。',
          '不使用 AI 助手无需理会，LUMEN 不会写入任何技能文件。'
        ]
      },
      {
        title: '检查更新',
        bullets: [
          '应用启动后会静默检查一次更新，不会反复打扰。',
          '也可在设置底部查看当前版本并手动“检查更新”。',
          '下载完成后会出现“新版本已就绪”入口；保存正在进行的编辑与白板操作后再重启安装。'
        ]
      }
    ]
  },
  {
    id: 'troubleshooting',
    number: '10',
    title: '常见问题排查',
    eyebrow: 'TROUBLESHOOTING',
    summary: '遇到导入、滚动、预览、AI 或白板问题时，按低风险顺序定位原因。',
    keywords: ['问题', '失败', '卡住', '日志', '缩略图', '找不到', '白板', 'AI', '更新'],
    blocks: [
      {
        title: '素材导入后找不到',
        steps: [
          '回到“全部素材”，清除搜索词和所有筛选条件。',
          '按“导入时间”降序排列，查看最前面的素材。',
          '检查是否正在浏览某个文件夹、标签、智能文件夹或回收站。',
          '仍未出现时导出运行日志，检查是否有不支持格式、权限或路径错误。'
        ]
      },
      {
        title: '缩略图或预览异常',
        bullets: [
          '先确认原文件仍存在且可被系统打开。视频和特殊格式生成预览可能需要更长时间。',
          '切换到其他文件夹再返回，或重启应用触发重新读取。',
          '若只有单个文件异常，优先判断源文件损坏；若大批量异常，导出日志后再操作，不要立即删除素材库。'
        ]
      },
      {
        title: 'AI 连接失败',
        steps: [
          '核对 Base URL 是否包含服务商要求的版本路径。',
          '确认模型名称准确，并且该模型支持图片输入。',
          '重新粘贴 API Key 并保存，然后执行“测试连接”。',
          '检查账户余额、网络代理、服务商限流；本地模型还需确认服务进程和端口。'
        ]
      },
      {
        title: '白板操作不符合预期',
        bullets: [
          '素材跟着鼠标移动：先按 Escape 取消当前工具，切回选择；平移画布时按住空格再拖动。',
          '看不到内容：按 F 或双击空白适配全部；按 0 可回到初始缩放。',
          '文字不断出现：完成输入后应自动回到选择；若仍处于文字工具，按 Escape 并重新选择。',
          '准备反馈问题时，记录复现步骤、当前主题和素材类型，并在设置中导出运行日志。'
        ]
      },
      {
        title: '提交问题前保留证据',
        bullets: [
          '不要先清空回收站或手工改动素材库目录。',
          '截取完整窗口，注明问题发生前的最后三步操作。',
          '导出运行日志并记录 LUMEN 版本号；涉及数据异常时先生成完整库 ZIP。'
        ]
      }
    ]
  }
]

function sectionSearchText(section: GuideSection): string {
  return [
    section.title,
    section.eyebrow,
    section.summary,
    ...section.keywords,
    ...section.blocks.flatMap((block) => [
      block.title,
      block.body ?? '',
      ...(block.steps ?? []),
      ...(block.bullets ?? []),
      ...(block.shortcuts ?? []).flat(),
      block.tip ?? '',
      block.warning ?? ''
    ])
  ]
    .join(' ')
    .toLocaleLowerCase()
}

const GUIDE_SEARCH_INDEX = new Map(GUIDE_SECTIONS.map((section) => [section.id, sectionSearchText(section)]))

export default function UserGuide() {
  const [activeId, setActiveId] = useState(GUIDE_SECTIONS[0].id)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase())

  const matches = useMemo(() => {
    if (!deferredQuery) return GUIDE_SECTIONS
    const terms = deferredQuery.split(/\s+/).filter(Boolean)
    return GUIDE_SECTIONS.filter((section) => {
      const text = GUIDE_SEARCH_INDEX.get(section.id) ?? ''
      return terms.every((term) => text.includes(term))
    })
  }, [deferredQuery])

  const activeSection = matches.find((section) => section.id === activeId) ?? matches[0] ?? null

  return (
    <div className="guide-layout">
      <aside className="guide-index" aria-label="使用说明章节">
        <label className="guide-search">
          <Icon name="search" size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索教程…"
            aria-label="搜索使用说明"
          />
          {query ? (
            <button aria-label="清除教程搜索" onClick={() => setQuery('')}>
              <Icon name="close" size={11} />
            </button>
          ) : null}
        </label>

        <div className="guide-index__meta mono">
          {deferredQuery ? `${matches.length} CHAPTERS FOUND` : `${GUIDE_SECTIONS.length} CHAPTERS / BUILT-IN`}
        </div>

        <nav className="guide-index__nav modal-scroll">
          {matches.map((section) => (
            <button
              key={section.id}
              className={activeSection?.id === section.id ? 'is-active' : ''}
              aria-current={activeSection?.id === section.id ? 'page' : undefined}
              onClick={() => setActiveId(section.id)}
            >
              <span className="guide-index__number mono">{section.number}</span>
              <span>
                <strong>{section.title}</strong>
                <small>{section.eyebrow.split(' / ')[0]}</small>
              </span>
            </button>
          ))}
        </nav>

        <div className="guide-index__foot">
          <span className="guide-index__signal" aria-hidden="true" />
          <span>教程随当前版本内置，无需联网</span>
        </div>
      </aside>

      <main className="guide-reader modal-scroll" aria-live="polite">
        {activeSection ? (
          <article key={activeSection.id}>
            <header className="guide-article__header">
              <div>
                <div className="guide-article__eyebrow mono">CHAPTER {activeSection.number} · {activeSection.eyebrow}</div>
                <h3>{activeSection.title}</h3>
                <p>{activeSection.summary}</p>
              </div>
              <span className="guide-article__folio mono">LUMEN / MANUAL</span>
            </header>

            <div className="guide-article__blocks">
              {activeSection.blocks.map((block, blockIndex) => (
                <section key={block.title} className="guide-block">
                  <div className="guide-block__heading">
                    <span className="mono">{activeSection.number}.{String(blockIndex + 1).padStart(2, '0')}</span>
                    <h4>{block.title}</h4>
                  </div>

                  {block.body ? <p className="guide-block__body">{block.body}</p> : null}

                  {block.steps ? (
                    <ol className="guide-steps">
                      {block.steps.map((step, index) => (
                        <li key={step}>
                          <span className="mono">{String(index + 1).padStart(2, '0')}</span>
                          <p>{step}</p>
                        </li>
                      ))}
                    </ol>
                  ) : null}

                  {block.bullets ? (
                    <ul className="guide-bullets">
                      {block.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
                    </ul>
                  ) : null}

                  {block.shortcuts ? (
                    <div className="guide-shortcuts" aria-label="快捷键">
                      {block.shortcuts.map(([keys, description]) => (
                        <div key={keys}>
                          <kbd>{keys}</kbd>
                          <span>{description}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {block.tip ? (
                    <div className="guide-callout guide-callout--tip">
                      <strong className="mono">DARKROOM NOTE</strong>
                      <p>{block.tip}</p>
                    </div>
                  ) : null}

                  {block.warning ? (
                    <div className="guide-callout guide-callout--warning">
                      <strong className="mono">注意</strong>
                      <p>{block.warning}</p>
                    </div>
                  ) : null}
                </section>
              ))}
            </div>

            <footer className="guide-article__footer mono">
              <span>END OF CHAPTER {activeSection.number}</span>
              <span>{activeSection.blocks.length} SECTIONS</span>
            </footer>
          </article>
        ) : (
          <div className="guide-empty">
            <Icon name="search" size={24} />
            <strong>没有找到相关教程</strong>
            <p>尝试搜索“导入”“白板”“AI”“备份”或“快捷键”。</p>
            <button className="btn-ghost" onClick={() => setQuery('')}>清除搜索</button>
          </div>
        )}
      </main>
    </div>
  )
}
