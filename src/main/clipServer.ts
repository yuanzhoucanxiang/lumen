import { createServer, IncomingMessage, ServerResponse } from 'http'
import { mkdtempSync, rmSync } from 'fs'
import { writeFile, rm, stat } from 'fs/promises'
import { basename, join, isAbsolute } from 'path'
import { tmpdir } from 'os'
import { app } from 'electron'
import { collectFiles, importFiles, isKnownAssetByNameSize } from './importer'
import { getLibraryPath } from './library'
import {
  addTagToAssets,
  addToFolder,
  createFolder,
  findSimilar,
  libraryStats,
  listFolders,
  listTags,
  queryAssets,
  updateAsset
} from './repository'
import { guardedFetch, readBodyCapped } from './netGuard'
import type { ImportFileDetail } from '../shared/types'

const PORT = 45678
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
}

/** 标签名/文件夹名上限:防 agent 批量生成超长或超量名称污染库 */
const MAX_TAGS_PER_CALL = 32
const MAX_NAME_LEN = 120
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

/**
 * Agent 按路径导入：与剪藏共用 importFiles 管线(查重/缩略图/主色/哈希一致)。
 * paths 支持文件或目录(目录递归展开)；标签与文件夹作用于「本次调用涉及的全部素材」——
 * 新导入的 + 跳过的重复文件命中的库内已有素材(幂等重跑不会漏掉已入库文件的标签/归档)。
 */
async function importFromPaths(payload: AgentImportPayload): Promise<{
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
      similar: []
    }
  }

  const result = await importFiles(exists, { move: payload.move === true, detail: true })
  const importedIds = result.importedIds ?? []

  // 幂等应用标签:新导入 + 命中的库内已有素材(显式标签是 agent 的指令,作用于涉及的全部素材)
  const applyIds = [...new Set([...importedIds, ...(result.matchedIds ?? [])])]
  if (applyIds.length > 0) {
    // tags 兼容单个字符串形式;逐个消毒过滤(可能为任意 JSON 值)
    const rawTags = Array.isArray(payload.tags) ? payload.tags : payload.tags == null ? [] : [payload.tags]
    const tags = rawTags.slice(0, MAX_TAGS_PER_CALL).map(sanitizeName).filter(Boolean)
    for (const t of tags) addTagToAssets(applyIds, t)
  }

  // 归档:显式 folder 优先(作用于涉及的全部素材,幂等);
  // 未指定时新导入素材自动归入专属文件夹「Agent 导入」,与用户自己的素材区分开。
  // 专属文件夹只作用于新导入——matched 的库内已有素材可能是用户自己导入的,不应被挪进 agent 专属文件夹。
  let folderId: number | null = null
  if (applyIds.length > 0 && folderSegments.length > 0) {
    folderId = resolveFolderId(folderSegments)
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
    similar
  }
}

// 串行化 /import:并发批次的 prepare 阶段互相不可见(尚未提交),重叠文件会双导入。
// 排队执行保证任意时刻只有一个导入批次在跑(单个失败不阻断后续)。
let importQueue: Promise<unknown> = Promise.resolve()

/** 启动本机接收服务（仅监听本机回环地址，需携带客户端鉴权头）。
 *  服务对象:①浏览器剪藏扩展(/clip) ②本机 AI Agent(/import /tags /folders)——
 *  鉴权模型一致:网页 JS 无法携带自定义头,本机原生程序不在威胁模型内。
 *  onImported 的 source 区分导入来源(渲染层据此分流提示文案)。 */
export function startClipServer(onImported?: (count: number, source: 'clip' | 'agent') => void): void {
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

    // Agent 查询素材(只读):q=关键词(搜名称+备注,含拼音) / ext=逗号分隔扩展名 / tag=标签名 / limit≤500
    if (req.method === 'GET' && url.pathname === '/assets') {
      const q = url.searchParams
      const keyword = (q.get('q') ?? '').trim().slice(0, 100)
      const limitRaw = Number(q.get('limit') ?? 50)
      const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 50, 1), 500)
      const exts = (q.get('ext') ?? '').split(',').map((s) => s.trim().toLowerCase().replace(/^\./, '')).filter(Boolean)
      const tagName = (q.get('tag') ?? '').trim()
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
        limit: limit + 1
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
        tags: a.tagNames ?? []
      }))
      json(res, 200, { ok: true, count: assets.length, truncated, assets })
      return
    }

    // Agent 汇总(只读):库规模 + Agent 导入专属文件夹计数,供汇报"库内共 X 张,Agent 收纳 Y 张"
    if (req.method === 'GET' && url.pathname === '/stats') {
      const s = libraryStats()
      const folders = listFolders()
      const agentFolder = folders.find((f) => f.name === AGENT_DEFAULT_FOLDER)
      json(res, 200, {
        ok: true,
        version: app.getVersion(),
        library: getLibraryPath(),
        assets: s.total,
        trash: s.deleted,
        tags: listTags().length,
        folders: folders.length,
        agentImported: agentFolder?.count ?? 0
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
          const task = importQueue.then(() => importFromPaths(payload))
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
