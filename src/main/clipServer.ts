import { createServer, IncomingMessage, ServerResponse } from 'http'
import { mkdtempSync, rmSync } from 'fs'
import { writeFile, rm, stat } from 'fs/promises'
import { basename, join, isAbsolute } from 'path'
import { tmpdir } from 'os'
import { app } from 'electron'
import { collectFiles, importFiles, isKnownAssetByNameSize } from './importer'
import { getLibraryPath, loadConfig } from './library'
import {
  addBoardItems,
  addTagToAssets,
  addToFolder,
  assetsHavingTag,
  assetsInFolder,
  createFolder,
  findSimilar,
  getAssetById,
  libraryStats,
  listBoards,
  listFolders,
  listTags,
  queryAssets,
  removeTagFromAssets,
  updateAsset
} from './repository'
import { aiProcessBatch } from './aiRename'
import { agentFindSimilar, agentMatchedIds } from './aiAgent'
import { itemsFromAssetIds, listAgentOps, logAgentOp, newGroupKey, undoAgentOp } from './agentOps'
import type { AgentOpItem } from './agentOps'
import { logger } from './logger'
import { guardedFetch, readBodyCapped } from './netGuard'
import type { ImportFileDetail, NewBoardItem } from '../shared/types'

/** 端口可配置(里程碑 169):默认 45678(浏览器剪藏扩展硬编码);测试场景经 LUMEN_CLIP_PORT
 *  换端口,避开用户正在运行的正式版(否则 dev 绑定失败,HTTP 测试全打到正式版上) */
const PORT = Number(process.env.LUMEN_CLIP_PORT) || 45678
const MAX_BODY = 80 * 1024 * 1024 // 80MB
const MAX_IMAGE_BYTES = 80 * 1024 * 1024 // imageUrl 下载上限,与请求体一致

/**
 * 鉴权头:只接受可信本机客户端(剪藏扩展 / AI Agent)的请求。
 * 网页 JS 跨域 fetch 无法携带自定义头(预检会被拒绝),而 MV3 扩展持有 host_permissions
 * 可绕过 CORS 携带该头,从而阻止任意本地网页向素材库注入图片(本机原生程序不在威胁模型内)。
 */
const CLIENT_HEADER = 'x-lumen-client'
const CLIENT_TOKEN = 'lumen-clip/1'

export const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg'
}

/** 校验请求来源：Host 必须指向本机服务 + 客户端头匹配。
 *  Host 校验防 DNS rebinding——恶意页面把自己的域名解析到 127.0.0.1 后浏览器视为同源，
 *  可自由携带自定义鉴权头并读取响应，仅靠回环绑定与自定义头挡不住这一手。 */
function isAuthorized(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? '').toLowerCase()
  if (host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) return false
  return req.headers[CLIENT_HEADER] === CLIENT_TOKEN
}

function json(res: ServerResponse, code: number, data: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function readBody(req: IncomingMessage, res: ServerResponse): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        // 先回 413 再断开:客户端收到明确状态码,而非连接被重置
        try {
          json(res, 413, { ok: false, error: 'body too large' })
        } catch {
          /* socket 已关闭则忽略 */
        }
        req.destroy()
        reject(new Error('body too large'))
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

interface ClipPayload {
  dataUrl?: string
  imageUrl?: string
  filename?: string
  pageUrl?: string
  title?: string
}

async function saveClip(payload: ClipPayload): Promise<number> {
  let buffer: Buffer | null = null
  let ext = 'jpg'

  if (payload.dataUrl) {
    const m = payload.dataUrl.match(/^data:([^;]+);base64,(.+)$/s)
    if (!m) throw new Error('invalid dataUrl')
    ext = MIME_EXT[m[1]] ?? 'jpg'
    buffer = Buffer.from(m[2], 'base64')
  } else if (payload.imageUrl) {
    // 出网防护：协议白名单 + 拒绝回环/链路本地地址 + 重定向逐跳复检 + 30s 超时 + 大小上限
    const resp = await guardedFetch(payload.imageUrl)
    if (!resp.ok) throw new Error(`download failed: ${resp.status}`)
    const contentType = resp.headers.get('content-type')?.split(';')[0] ?? ''
    if (MIME_EXT[contentType]) ext = MIME_EXT[contentType]
    buffer = await readBodyCapped(resp, MAX_IMAGE_BYTES)
  }
  if (!buffer || buffer.length === 0) throw new Error('empty image')

  const name =
    payload.filename
      ?.replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .slice(0, 120) || `clip_${new Date().toISOString().replace(/[:.]/g, '-')}`
  // 随机临时子目录:路径不可预测,且写入不会命中同目录下可能存在的符号链接
  const tmpDir = mkdtempSync(join(tmpdir(), 'lumen-clip-'))
  const tmpFile = join(tmpDir, `${name.replace(/\.[^.]+$/, '')}_${Date.now()}.${ext}`)
  await writeFile(tmpFile, buffer)
  const result = await importFiles([tmpFile], { sourceUrl: payload.pageUrl ?? payload.imageUrl })
  rm(tmpDir, { recursive: true, force: true }).catch(() => undefined) // 剪藏临时目录入库后清理
  return result.imported
}

/** Agent 通知事件(autoTag 进度/完成经渲染层 toast 呈现) */
type AgentNotify = (event: Record<string, unknown>) => void

/** AI Agent 本地导入请求：按磁盘路径导入(支持目录递归)，可选打标签/归文件夹 */
interface AgentImportPayload {
  paths?: string | string[]
  tags?: string[] | string
  folder?: string
  /** true = 导入后删除源文件(默认 false,复制导入) */
  move?: boolean
  /** 生成信息(prompt/模型/参数等),写入素材备注(仅本次新导入,可被关键词搜索命中) */
  note?: string
  /** true = 对新导入素材做相似检测,响应回传库内近似项(防近重复生成图淹没图库) */
  checkSimilar?: boolean
  /** true = 试运行(dry-run):只做路径展开与 name+size 查重预估,不导入不写库 */
  validate?: boolean
  /** 导入完成后把这些新素材直接放上指定白板(画布内流式排布) */
  boardId?: number
  /** true = 导入完成后在后台跑 AI 自动打标签(不阻塞本次响应,完成经 agent:notify 推送) */
  autoTag?: boolean
}

/** 标签名/文件夹名上限:防 agent 批量生成超长或超量名称污染库 */
const MAX_TAGS_PER_CALL = 32
const MAX_NAME_LEN = 120
/** /assets source 筛选的合法值('' = 手动导入) */
const SOURCES_HTTP = new Set(['manual', 'agent', 'clip', 'watcher', 'screenshot', 'startup'])
/** Agent 导入专属文件夹:未显式指定 folder 时,新导入素材自动归入,与用户自己的素材区分 */
const AGENT_DEFAULT_FOLDER = 'Agent 导入'

/** 控制字符/Windows 保留字符消毒 + 截断;入参可能是 agent 传来的任意 JSON 值,先 String 化防 TypeError */
function sanitizeName(name: unknown): string {
  return String(name)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .slice(0, MAX_NAME_LEN)
}

/** 按名解析文件夹(预校验过的多级段名,缺失层级自动逐级创建),返回最深一级的 id。
 *  匹配时排除智能文件夹(智能文件夹由条件定义,不应作为落位目标)。 */
function resolveFolderId(segments: string[]): number {
  const folders = listFolders()
  let parentId: number | null = null
  let id = 0
  for (const seg of segments) {
    const found = folders.find((f) => f.parentId === parentId && !f.isSmart && f.name === seg)
    if (found) {
      id = found.id
    } else {
      const created = createFolder(seg, parentId)
      id = created.id
      folders.push(created) // 后续层级基于新建节点继续匹配
    }
    parentId = id
  }
  return id
}

/** Agent 自动打标签后台队列:AI 打标签耗时分钟级,不阻塞导入响应,完成经 notify 推送 */
let autoTagQueue: Promise<unknown> = Promise.resolve()

function queueAutoTag(ids: string[], notify?: AgentNotify): void {
  autoTagQueue = autoTagQueue
    .then(async () => {
      const cfg = loadConfig()
      if (!cfg.aiApiKey) {
        notify?.({ type: 'autoTagSkipped', reason: '未配置 AI API Key' })
        logger.info('[agent-autoTag]', 'AI 未配置,跳过自动打标签')
        return
      }
      const r = await aiProcessBatch(
        ids,
        { baseUrl: cfg.aiBaseUrl ?? 'https://open.bigmodel.cn/api/paas/v4', apiKey: cfg.aiApiKey, model: cfg.aiModel ?? 'glm-4v' },
        { rename: false, tag: true },
        (done, total, failed) => notify?.({ type: 'autoTagProgress', done, total, failed })
      )
      notify?.({ type: 'autoTagDone', tagged: r.processed, failed: r.failed })
      logger.info('[agent-autoTag]', `AI 打标签完成 ${r.processed}/${ids.length},失败 ${r.failed}`)
    })
    .catch((e: unknown) => {
      notify?.({ type: 'autoTagError', message: (e as Error).message })
      logger.warn('[agent-autoTag]', `自动打标签失败: ${(e as Error).message}`)
    })
}

/** 把素材放上白板:原比例、长边封顶 1280 不放大,按 1600 逻辑宽度流式换行排布。
 *  返回创建的画布元素 id(供操作记录回退时移除)。 */
function placeAssetsOnBoard(boardId: number, ids: string[]): string[] {
  const items: NewBoardItem[] = []
  const GAP = 40
  let x = 60
  let y = 60
  let rowMaxH = 0
  for (const id of ids) {
    const a = getAssetById(id)
    if (!a) continue
    let w = a.width > 0 ? a.width : 400
    let h = a.height > 0 ? a.height : 300
    const shrink = 1280 / Math.max(w, h)
    if (shrink < 1) {
      w = Math.round(w * shrink)
      h = Math.round(h * shrink)
    }
    if (x + w > 1660 && x > 60) {
      x = 60
      y += rowMaxH + GAP
      rowMaxH = 0
    }
    items.push({ assetId: id, type: 'asset', x, y, width: w, height: h })
    x += w + GAP
    rowMaxH = Math.max(rowMaxH, h)
  }
  return addBoardItems(boardId, items).map((it) => it.id)
}

/**
 * Agent 按路径导入：与剪藏共用 importFiles 管线(查重/缩略图/主色/哈希一致)。
 * paths 支持文件或目录(目录递归展开)；标签与文件夹作用于「本次调用涉及的全部素材」——
 * 新导入的 + 跳过的重复文件命中的库内已有素材(幂等重跑不会漏掉已入库文件的标签/归档)。
 */
async function importFromPaths(
  payload: AgentImportPayload,
  sendProgress?: (phase: 'prepare' | 'commit', done: number, total: number) => void,
  notify?: AgentNotify
): Promise<{
  validate?: boolean
  fileCount?: number
  wouldImport?: number
  wouldSkip?: number
  imported: number
  skipped: number
  failed: number
  failedFiles: string[]
  importedIds: string[]
  matchedIds: string[]
  files: ImportFileDetail[]
  missing: string[]
  folderId: number | null
  boardId: number | null
  autoTagStarted: boolean
  similar: { id: string; name: string; matches: { id: string; name: string }[] }[]
}> {
  const raw = payload.paths == null ? [] : Array.isArray(payload.paths) ? payload.paths : [payload.paths]
  const paths = raw.map((p) => String(p).trim()).filter(Boolean)
  if (paths.length === 0) throw new Error('paths required (string or string[])')
  if (paths.length > 1000) throw new Error('too many paths (max 1000)')
  // 相对路径按 LUMEN 主进程 CWD 解析,dev 与打包版语义不同 —— 明确拒绝,避免导入到不可预期的位置
  const relativePaths = paths.filter((p) => !isAbsolute(p))
  if (relativePaths.length > 0) {
    throw new Error(`paths must be absolute: ${relativePaths.slice(0, 3).join(', ')}`)
  }

  // folder 校验提前到导入之前:空名/层级过深在未动库前就报清,避免"已导入但响应 400"的半完成状态
  const folderRaw = payload.folder == null ? '' : String(payload.folder)
  const folderSegments = folderRaw.split(/[\\/]+/).map(sanitizeName).filter(Boolean)
  if (folderRaw.trim() && folderSegments.length === 0) throw new Error('folder 名称为空')
  if (folderSegments.length > 5) throw new Error('folder 层级过深(最多 5 级)')

  // boardId 校验同样提前:白板不存在立刻报错,不做半截导入
  const boardId = typeof payload.boardId === 'number' && Number.isInteger(payload.boardId) ? payload.boardId : null
  if (payload.boardId != null && boardId === null) throw new Error('boardId must be an integer')
  if (boardId !== null && !listBoards().some((b) => b.id === boardId)) throw new Error(`board ${boardId} not found`)

  // collectFiles 会静默跳过不存在的路径,这里预检把缺失路径回传给 agent(便于发现路径写错)
  const missing: string[] = []
  const exists: string[] = []
  for (const p of paths) {
    try {
      await stat(p)
      exists.push(p)
    } catch {
      missing.push(p)
    }
  }

  // 试运行(dry-run):只展开路径 + name+size 查重预估,不导入不写库不建文件夹。
  // 注意 name+size 查不到的"同内容不同名"重复要解码算哈希才能发现,真实导入时仍会被拦。
  if (payload.validate === true) {
    const walked = await collectFiles(exists)
    let wouldSkip = 0
    for (const f of walked) {
      try {
        const st = await stat(f)
        if (isKnownAssetByNameSize(basename(f), st.size)) wouldSkip++
      } catch {
        /* stat 失败的文件真实导入时同样会失败,这里仍计入 wouldImport 让 agent 看到规模 */
      }
    }
    return {
      validate: true,
      fileCount: walked.length,
      wouldImport: walked.length - wouldSkip,
      wouldSkip,
      missing,
      imported: 0,
      skipped: 0,
      failed: 0,
      failedFiles: [],
      importedIds: [],
      matchedIds: [],
      files: [],
      folderId: null,
      boardId: null,
      autoTagStarted: false,
      similar: []
    }
  }

  const result = await importFiles(exists, {
    move: payload.move === true,
    detail: true,
    source: 'agent',
    onProgress: sendProgress
  })
  const importedIds = result.importedIds ?? []

  // 幂等应用标签:新导入 + 命中的库内已有素材(显式标签是 agent 的指令,作用于涉及的全部素材)
  const applyIds = [...new Set([...importedIds, ...(result.matchedIds ?? [])])]
  // 变更前的状态快照——必须在下面 addTagToAssets/addToFolder **之前**取,
  // 否则"哪些是本次新加的"就看不出来了(里程碑 182:只记本次真正改动的项)
  const tagPre = new Map<string, Set<string>>()
  let folderPre = new Set<string>()
  const tags = Array.isArray(payload.tags)
    ? payload.tags
    : payload.tags == null
      ? []
      : [payload.tags]
  const tagNames = (tags as unknown[]).slice(0, MAX_TAGS_PER_CALL).map(sanitizeName).filter(Boolean)
  if (applyIds.length > 0) {
    for (const t of tagNames) tagPre.set(t, assetsHavingTag(applyIds, t))
    for (const t of tagNames) addTagToAssets(applyIds, t)
  }

  // 归档:显式 folder 优先(作用于涉及的全部素材,幂等);
  // 未指定时新导入素材自动归入专属文件夹「Agent 导入」,与用户自己的素材区分开。
  // 专属文件夹只作用于新导入——matched 的库内已有素材可能是用户自己导入的,不应被挪进 agent 专属文件夹。
  let folderId: number | null = null
  if (applyIds.length > 0 && folderSegments.length > 0) {
    folderId = resolveFolderId(folderSegments)
    folderPre = assetsInFolder(applyIds, folderId)
    addToFolder(applyIds, folderId)
  } else if (importedIds.length > 0) {
    folderId = resolveFolderId([AGENT_DEFAULT_FOLDER])
    addToFolder(importedIds, folderId)
  }

  // 备注存档:agent 的生成信息(prompt/模型/参数)写入新素材备注,可被关键词搜索命中;
  // matched 的用户素材绝不改备注(那是用户自己的数据)
  if (payload.note && importedIds.length > 0) {
    const note = String(payload.note).trim().slice(0, 2000)
    if (note) for (const id of importedIds) updateAsset(id, { comment: note })
  }

  // 直送白板:新素材放上指定画布(仅新导入;流式排布)
  let boardItemIds: string[] = []
  if (boardId !== null && importedIds.length > 0) {
    boardItemIds = placeAssetsOnBoard(boardId, importedIds)
  }

  // 操作记录(里程碑 171):每种副作用独立成一条,各自可独立回退;
  // 同一请求共享批次键(里程碑 174),面板按批次归纳成组
  const gk = newGroupKey()
  // ①导入(移动导入的源文件已删 → 标记不可回退);默认「Agent 导入」归档随之撤销(删除会连归属一起清)
  if (importedIds.length > 0) {
    const summary =
      folderSegments.length > 0
        ? `导入 ${importedIds.length} 个素材`
        : `导入 ${importedIds.length} 个素材，归入「${AGENT_DEFAULT_FOLDER}」`
    logAgentOp('import', summary, { items: itemsFromAssetIds(importedIds), undoable: payload.move !== true }, importedIds.length, gk)
  }
  // ②显式 folder(作用于新导入 + 命中的库内已有素材)
  //   只记"本次真正新归档进去的"：已经在目标文件夹里的素材不入记录，回退时不会把用户原有归属移出去(里程碑 182)
  if (applyIds.length > 0 && folderSegments.length > 0 && folderId !== null) {
    const changedFolderIds = applyIds.filter((id) => !folderPre.has(id))
    if (changedFolderIds.length > 0) {
      logAgentOp(
        'folder',
        `把 ${changedFolderIds.length} 个素材归入文件夹「${folderSegments.join('/')}」`,
        { items: itemsFromAssetIds(changedFolderIds), folderId, folderName: folderSegments.join('/') },
        changedFolderIds.length,
        gk
      )
    }
  }
  // ③标签(每个标签一条;同样只记本次真正新加上的——快照在应用之前取,见上文 tagPre)
  if (applyIds.length > 0) {
    for (const t of tagNames) {
      const already = tagPre.get(t) ?? new Set<string>()
      const changedTagIds = applyIds.filter((id) => !already.has(id))
      if (changedTagIds.length === 0) continue
      logAgentOp('tag', `给 ${changedTagIds.length} 个素材打标签「${t}」`, { items: itemsFromAssetIds(changedTagIds), tag: t }, changedTagIds.length, gk)
    }
  }
  // ④上板
  if (boardItemIds.length > 0 && boardId !== null) {
    const bn = listBoards().find((b) => b.id === boardId)?.name ?? `#${boardId}`
    // 画布元素 id 与素材一一对应(placeAssetsOnBoard 同步生成),逐项记录供面板展示与逐项回退
    const boardItems = boardItemIds.map((itemId, i) => ({
      id: itemId,
      name: getAssetById(importedIds[i])?.name ?? itemId,
      assetId: importedIds[i]
    }))
    logAgentOp('board', `把 ${boardItemIds.length} 个素材放上白板「${bn}」`, { items: boardItems, boardId }, boardItemIds.length, gk)
  }

  // AI 自动打标签:后台队列执行,不阻塞响应;完成/跳过/失败经 agent:notify 推送
  let autoTagStarted = false
  if (payload.autoTag === true && importedIds.length > 0) {
    autoTagStarted = true
    queueAutoTag([...importedIds], notify)
  }

  // 相似检测(默认关):对每个新导入素材查库内近似项(dHash 汉明距离≤10,每张最多 3 条),
  // agent 可据此决定跳过重复生成或提醒用户
  const similar: { id: string; name: string; matches: { id: string; name: string }[] }[] = []
  if (payload.checkSimilar === true && importedIds.length > 0) {
    for (const id of importedIds) {
      const matches = (await findSimilar(id, 10, 3)).map((a) => ({ id: a.id, name: a.name }))
      const self = result.files?.find((f) => f.id === id)
      if (matches.length > 0) similar.push({ id, name: self?.name ?? id, matches })
    }
  }

  return {
    imported: result.imported,
    skipped: result.skipped,
    failed: result.failed,
    failedFiles: result.failedFiles ?? [],
    importedIds: result.importedIds ?? [],
    matchedIds: result.matchedIds ?? [],
    files: result.files ?? [],
    missing,
    folderId,
    boardId,
    autoTagStarted,
    similar
  }
}

// 串行化 /import:并发批次的 prepare 阶段互相不可见(尚未提交),重叠文件会双导入。
// 排队执行保证任意时刻只有一个导入批次在跑(单个失败不阻断后续)。
let importQueue: Promise<unknown> = Promise.resolve()

/** /tag /untag 的目标素材解析:优先 ids(≤1000),否则 conditions 条件命中(agentMatchedIds 含全部守卫) */
async function resolveAgentIds(payload: { ids?: unknown; conditions?: unknown }): Promise<string[]> {
  if (Array.isArray(payload.ids)) {
    const ids = payload.ids.filter((x): x is string => typeof x === 'string' && /^[0-9a-f]{16}$/i.test(x))
    return [...new Set(ids)].slice(0, 1000)
  }
  if (payload.conditions && typeof payload.conditions === 'object') {
    return agentMatchedIds(payload.conditions)
  }
  return []
}

/** 启动本机接收服务（仅监听本机回环地址，需携带客户端鉴权头）。
 *  服务对象:①浏览器剪藏扩展(/clip) ②本机 AI Agent(/import /tags /folders /assets /stats)——
 *  鉴权模型一致:网页 JS 无法携带自定义头,本机原生程序不在威胁模型内。
 *  onImported 的 source 区分导入来源(渲染层据此分流提示文案);
 *  sendProgress 把导入进度推给渲染层(与手动导入共用 import:progress 通道);
 *  notify 推送 Agent 后台任务事件(autoTag 完成/跳过/失败)。 */
export function startClipServer(
  onImported?: (count: number, source: 'clip' | 'agent') => void,
  sendProgress?: (phase: 'prepare' | 'commit', done: number, total: number) => void,
  notify?: AgentNotify
): void {
  const server = createServer((req, res) => {
    // 未携带鉴权头的请求直接拒绝(含网页跨域预检 OPTIONS:浏览器不会放行自定义头)
    if (!isAuthorized(req)) {
      json(res, 403, { ok: false, error: 'forbidden' })
      return
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)

    if (req.method === 'GET' && url.pathname === '/status') {
      json(res, 200, { ok: true, name: 'LUMEN', version: app.getVersion(), library: getLibraryPath() })
      return
    }

    if (req.method === 'GET' && url.pathname === '/tags') {
      json(res, 200, { ok: true, tags: listTags() })
      return
    }

    if (req.method === 'GET' && url.pathname === '/folders') {
      json(res, 200, { ok: true, folders: listFolders() })
      return
    }

    if (req.method === 'GET' && url.pathname === '/boards') {
      json(res, 200, { ok: true, boards: listBoards().map((b) => ({ id: b.id, name: b.name })) })
      return
    }

    // Agent 查询素材(只读):q=关键词(搜名称+备注,含拼音) / ext=逗号分隔扩展名 / tag=标签名 / source=来源 / limit≤500 / offset 分页
    if (req.method === 'GET' && url.pathname === '/assets') {
      const q = url.searchParams
      const keyword = (q.get('q') ?? '').trim().slice(0, 100)
      const limitRaw = Number(q.get('limit') ?? 50)
      const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 50, 1), 500)
      const offsetRaw = Number(q.get('offset') ?? 0)
      const offset = Math.min(Math.max(Number.isFinite(offsetRaw) ? Math.floor(offsetRaw) : 0, 0), 100000)
      const exts = (q.get('ext') ?? '').split(',').map((s) => s.trim().toLowerCase().replace(/^\./, '')).filter(Boolean)
      const tagName = (q.get('tag') ?? '').trim()
      // source 参数归一：'' 与 'manual' 都表示手动导入（列值为 ''）；其余白名单直通；非法值忽略
      const sourceRaw = q.get('source')
      const source = sourceRaw === null ? undefined : sourceRaw === '' || sourceRaw === 'manual' ? '' : SOURCES_HTTP.has(sourceRaw) ? sourceRaw : undefined
      const tagRow = tagName ? listTags().find((x) => x.name.toLowerCase() === tagName.toLowerCase()) : undefined
      if (tagName && !tagRow) {
        // 指定的标签不存在:直接回空结果(避免空 tagIds 的语义歧义)
        json(res, 200, { ok: true, count: 0, truncated: false, assets: [] })
        return
      }
      const rows = queryAssets({
        keyword: keyword || undefined,
        exts: exts.length > 0 ? exts : undefined,
        tagIds: tagRow ? [tagRow.id] : undefined,
        source,
        limit: limit + 1,
        offset
      })
      const truncated = rows.length > limit
      const assets = rows.slice(0, limit).map((a) => ({
        id: a.id,
        name: a.name,
        ext: a.ext,
        width: a.width,
        height: a.height,
        size: a.size,
        star: a.star,
        importedAt: a.importedAt,
        source: a.source,
        tags: a.tagNames ?? []
      }))
      json(res, 200, { ok: true, count: assets.length, truncated, assets })
      return
    }

    // 单素材详情(只读):含备注(生成信息存档在这里)/来源/标签,供 agent 读回 prompt 等
    if (req.method === 'GET' && url.pathname === '/asset') {
      const id = (url.searchParams.get('id') ?? '').trim()
      const a = /^[0-9a-f]{16}$/i.test(id) ? getAssetById(id) : null
      if (!a || a.deletedAt != null) {
        json(res, 404, { ok: false, error: 'asset not found' })
        return
      }
      json(res, 200, {
        ok: true,
        asset: {
          id: a.id,
          name: a.name,
          ext: a.ext,
          width: a.width,
          height: a.height,
          size: a.size,
          star: a.star,
          importedAt: a.importedAt,
          source: a.source,
          comment: a.comment,
          url: a.url,
          tags: a.tagNames ?? []
        }
      })
      return
    }

    // 以图搜图(只读,确定性):GET /similar?id=<素材id>&maxDistance=12&limit=60 —— dHash 感知哈希检索
    if (req.method === 'GET' && url.pathname === '/similar') {
      const id = (url.searchParams.get('id') ?? '').trim()
      if (!/^[0-9a-f]{16}$/i.test(id)) {
        json(res, 400, { ok: false, error: 'id required (16-hex asset id)' })
        return
      }
      const maxDistanceRaw = Number(url.searchParams.get('maxDistance') ?? 12)
      const maxDistance = Math.min(Math.max(Number.isFinite(maxDistanceRaw) ? Math.floor(maxDistanceRaw) : 12, 0), 32)
      const limitRaw = Number(url.searchParams.get('limit') ?? 60)
      const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 60, 1), 200)
      agentFindSimilar({ assetId: id }, maxDistance, limit)
        .then((r) => json(res, 200, { ok: true, ...r }))
        .catch((err: Error) => {
          if (!res.headersSent) json(res, 400, { ok: false, error: err.message })
        })
      return
    }

    // 打标签:按 ids 或 conditions 给素材打标签(可撤销——/untag 摘除)
    if (req.method === 'POST' && url.pathname === '/tag') {
      readBody(req, res)
        .then(async (body) => {
          const payload = JSON.parse(body) as { ids?: string[]; conditions?: unknown; tag?: string }
          const tag = sanitizeName(String(payload.tag ?? ''))
          if (!tag) throw new Error('tag required')
          const ids = await resolveAgentIds(payload)
          if (ids.length === 0) {
            json(res, 200, { ok: true, tagged: 0 })
            return
          }
          // 只把"本次真正新加上该标签"的素材记进操作记录：原本就带这个标签的不记，
          // 回退时才不会摘掉用户原有的标签（里程碑 182）
          const already = assetsHavingTag(ids, tag)
          const changed = ids.filter((id) => !already.has(id))
          addTagToAssets(ids, tag)
          if (changed.length > 0) {
            logAgentOp('tag', `给 ${changed.length} 个素材打标签「${tag}」`, { items: itemsFromAssetIds(changed), tag }, changed.length)
          }
          if (ids.length > 0) onImported?.(0, 'agent')
          json(res, 200, { ok: true, tagged: ids.length, changed: changed.length })
        })
        .catch((err: Error) => {
          if (!res.headersSent) json(res, 400, { ok: false, error: err.message })
        })
      return
    }

    // 摘标签:按 ids 或 conditions 移除标签(可逆——重新 /tag 即可)
    if (req.method === 'POST' && url.pathname === '/untag') {
      readBody(req, res)
        .then(async (body) => {
          const payload = JSON.parse(body) as { ids?: string[]; conditions?: unknown; tag?: string }
          const tag = sanitizeName(String(payload.tag ?? ''))
          if (!tag) throw new Error('tag required')
          const ids = await resolveAgentIds(payload)
          const had = assetsHavingTag(ids, tag)
          const removed = ids.length > 0 ? removeTagFromAssets(ids, tag) : 0
          if (removed > 0) {
            // 只记"本次真正摘掉标签"的素材，回退时才对得上（里程碑 182）
            const changed = ids.filter((id) => had.has(id))
            logAgentOp('untag', `摘除 ${changed.length} 个素材的「${tag}」标签`, { items: itemsFromAssetIds(changed), tag }, changed.length)
            onImported?.(0, 'agent')
          }
          json(res, 200, { ok: true, removed })
        })
        .catch((err: Error) => {
          if (!res.headersSent) json(res, 400, { ok: false, error: err.message })
        })
      return
    }

    // 归档:把已有素材归入文件夹(按 ids 或 conditions;文件夹不存在自动创建)。里程碑 171
    if (req.method === 'POST' && url.pathname === '/folder') {
      readBody(req, res)
        .then(async (body) => {
          const payload = JSON.parse(body) as { ids?: string[]; conditions?: unknown; folder?: string }
          const segs = String(payload.folder ?? '').split(/[\\/]+/).map(sanitizeName).filter(Boolean)
          if (segs.length === 0) throw new Error('folder required')
          if (segs.length > 5) throw new Error('folder 层级过深(最多 5 级)')
          const ids = await resolveAgentIds(payload)
          if (ids.length === 0) {
            json(res, 200, { ok: true, moved: 0 })
            return
          }
          const fid = resolveFolderId(segs)
          const name = segs.join('/')
          // 只记"本次真正新归档进去"的素材（原本就在这个文件夹里的不记，回退才不会移走用户的原有归属）。里程碑 182
          const alreadyIn = assetsInFolder(ids, fid)
          const changed = ids.filter((id) => !alreadyIn.has(id))
          addToFolder(ids, fid)
          if (changed.length > 0) {
            logAgentOp('folder', `把 ${changed.length} 个素材归入文件夹「${name}」`, { items: itemsFromAssetIds(changed), folderId: fid, folderName: name }, changed.length)
          }
          onImported?.(0, 'agent')
          json(res, 200, { ok: true, moved: ids.length, changed: changed.length, folderId: fid })
        })
        .catch((err: Error) => {
          if (!res.headersSent) json(res, 400, { ok: false, error: err.message })
        })
      return
    }

    // 星级:设置已有素材的星级(0-5;记录原值供回退)。里程碑 171
    if (req.method === 'POST' && url.pathname === '/star') {
      readBody(req, res)
        .then(async (body) => {
          const payload = JSON.parse(body) as { ids?: string[]; conditions?: unknown; star?: number }
          const star = Number(payload.star)
          if (!Number.isInteger(star) || star < 0 || star > 5) throw new Error('star must be integer 0-5')
          const ids = await resolveAgentIds(payload)
          const starItems: AgentOpItem[] = []
          let unchanged = 0
          for (const id of ids) {
            const a = getAssetById(id)
            if (!a || a.deletedAt != null) continue
            // 星级本来就等于目标值 → 不算改动，不写记录（回退才有意义）。里程碑 182
            if (a.star === star) {
              unchanged++
              continue
            }
            updateAsset(id, { star })
            starItems.push({ id, name: a.name, prev: a.star, next: star })
          }
          if (starItems.length > 0) {
            logAgentOp('star', `设置 ${starItems.length} 个素材为 ${star} 星`, { items: starItems }, starItems.length)
            onImported?.(0, 'agent')
          }
          json(res, 200, { ok: true, updated: starItems.length, unchanged })
        })
        .catch((err: Error) => {
          if (!res.headersSent) json(res, 400, { ok: false, error: err.message })
        })
      return
    }

    // 上板:把已有素材追加到指定白板(流式排布;记录元素 id 供回退)。里程碑 171
    if (req.method === 'POST' && url.pathname === '/board') {
      readBody(req, res)
        .then(async (body) => {
          const payload = JSON.parse(body) as { ids?: string[]; conditions?: unknown; boardId?: number }
          const bid = Number(payload.boardId)
          if (!Number.isInteger(bid) || !listBoards().some((b) => b.id === bid)) throw new Error('board not found')
          const ids = await resolveAgentIds(payload)
          if (ids.length === 0) {
            json(res, 200, { ok: true, added: 0 })
            return
          }
          const itemIds = placeAssetsOnBoard(bid, ids)
          if (itemIds.length > 0) {
            const bn = listBoards().find((b) => b.id === bid)?.name ?? `#${bid}`
            const boardItems: AgentOpItem[] = itemIds.map((itemId, i) => ({
              id: itemId,
              name: getAssetById(ids[i])?.name ?? itemId,
              assetId: ids[i]
            }))
            logAgentOp('board', `把 ${itemIds.length} 个素材放上白板「${bn}」`, { items: boardItems, boardId: bid }, itemIds.length)
          }
          json(res, 200, { ok: true, added: itemIds.length })
        })
        .catch((err: Error) => {
          if (!res.headersSent) json(res, 400, { ok: false, error: err.message })
        })
      return
    }

    // 备注:改写已有素材的备注(生成信息回溯补充;记录原值供回退)。里程碑 171
    if (req.method === 'POST' && url.pathname === '/note') {
      readBody(req, res)
        .then(async (body) => {
          const payload = JSON.parse(body) as {
            ids?: string[]
            conditions?: unknown
            note?: string
            mode?: 'set' | 'append'
          }
          const note = String(payload.note ?? '').trim().slice(0, 2000)
          if (!note) throw new Error('note required')
          const append = payload.mode === 'append'
          const ids = await resolveAgentIds(payload)
          const noteItems: AgentOpItem[] = []
          for (const id of ids) {
            const a = getAssetById(id)
            if (!a || a.deletedAt != null) continue
            const nextComment = append && a.comment ? `${a.comment}
${note}` : note
            // 备注没变化 → 不算改动，不写记录；next 记下来，用户事后重写过备注时回退不动它。里程碑 182
            if (nextComment === a.comment) continue
            updateAsset(id, { comment: nextComment })
            noteItems.push({ id, name: a.name, prev: a.comment, next: nextComment })
          }
          if (noteItems.length > 0) {
            logAgentOp('note', `${append ? '追加' : '改写'} ${noteItems.length} 个素材的备注`, { items: noteItems }, noteItems.length)
            onImported?.(0, 'agent')
          }
          json(res, 200, { ok: true, updated: noteItems.length })
        })
        .catch((err: Error) => {
          if (!res.headersSent) json(res, 400, { ok: false, error: err.message })
        })
      return
    }

    // 操作记录(只读):Agent 写操作审计,含能否回退。里程碑 171
    if (req.method === 'GET' && url.pathname === '/ops') {
      const limitRaw = Number(url.searchParams.get('limit') ?? 30)
      const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 30, 1), 200)
      json(res, 200, { ok: true, ops: listAgentOps(limit) })
      return
    }

    // 回退:按记录 id 撤销一次 Agent 写操作。里程碑 171
    if (req.method === 'POST' && url.pathname === '/undo') {
      readBody(req, res)
        .then(async (body) => {
          const payload = JSON.parse(body) as { id?: number; itemIds?: string[] }
          const id = Number(payload.id)
          if (!Number.isInteger(id)) throw new Error('id required')
          const itemIds = Array.isArray(payload.itemIds) ? payload.itemIds.filter((x) => typeof x === 'string') : undefined
          const r = undoAgentOp(id, itemIds)
          if (r.ok) onImported?.(0, 'agent')
          json(res, r.ok ? 200 : 400, { ok: r.ok, message: r.message, undoneCount: r.undoneCount, remaining: r.remaining })
        })
        .catch((err: Error) => {
          if (!res.headersSent) json(res, 400, { ok: false, error: err.message })
        })
      return
    }

    // Agent 汇总(只读):库规模 + 来源计数,供汇报"库内共 X 张,Agent 收纳 Y 张"
    if (req.method === 'GET' && url.pathname === '/stats') {
      const s = libraryStats()
      const folders = listFolders()
      json(res, 200, {
        ok: true,
        version: app.getVersion(),
        library: getLibraryPath(),
        assets: s.total,
        trash: s.deleted,
        tags: listTags().length,
        folders: folders.length,
        agentImported: s.agent
      })
      return
    }

    if (req.method === 'POST' && url.pathname === '/clip') {
      readBody(req, res)
        .then(async (body) => {
          const payload = JSON.parse(body) as ClipPayload
          const n = await saveClip(payload)
          if (n > 0) onImported?.(n, 'clip')
          json(res, 200, { ok: true, imported: n })
        })
        .catch((err: Error) => {
          // headersSent = readBody 已回 413 并断开,此处静默收尾,避免二次写头
          if (!res.headersSent) json(res, 400, { ok: false, error: err.message })
        })
      return
    }

    if (req.method === 'POST' && url.pathname === '/import') {
      readBody(req, res)
        .then(async (body) => {
          const payload = JSON.parse(body) as AgentImportPayload
          // 危险动作需在设置页显式授权（里程碑 182，"Agent 接入"卡片两个开关）：
          // 请求带了未授权的动作就整批拒绝——不做"先导入再忽略"，避免半个请求悄悄生效
          const agentCfg = loadConfig()
          if (payload.move === true && agentCfg.agentAllowMove !== true) {
            json(res, 403, {
              ok: false,
              error: 'move 未授权：移动导入会删除源文件，需在 LUMEN 设置 → Agent 接入 打开「允许移动导入」'
            })
            return
          }
          if (payload.autoTag === true && agentCfg.agentAllowAutoTag !== true) {
            json(res, 403, {
              ok: false,
              error: 'autoTag 未授权：自动打标签会把图片缩略图发送给所配置的 AI 服务，需在 LUMEN 设置 → Agent 接入 打开「允许 AI 自动打标签」'
            })
            return
          }
          const task = importQueue.then(() => importFromPaths(payload, sendProgress, notify))
          importQueue = task.catch(() => undefined) // 单批失败不让队列卡死
          const r = await task
          // 新导入或命中已有素材(补打了标签/归档)都通知渲染层刷新;纯 missing/failed 不打扰
          if (r.imported > 0 || r.matchedIds.length > 0) onImported?.(r.imported, 'agent')
          json(res, 200, { ok: true, ...r })
        })
        .catch((err: Error) => {
          if (!res.headersSent) json(res, 400, { ok: false, error: err.message })
        })
      return
    }

    json(res, 404, { ok: false, error: 'not found' })
  })

  server.on('error', (err) => console.error('[clip-server]', err.message))
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[clip-server] listening on http://127.0.0.1:${PORT}`)
  })
}
