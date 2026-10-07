import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { closeDb, openDb } from './db'
import { logger } from './logger'

const CONFIG_NAME = 'config.json'
/** safeStorage 加密值前缀（DPAPI/keyring 密文 base64） */
const ENC_PREFIX = 'enc:v1:'

export interface LibraryEntry {
  name: string
  path: string
}

export interface AppConfig {
  libraries: LibraryEntry[]
  current: string
  watchDirs: string[]
  importMode: 'copy' | 'move'
  /** AI 配置（OpenAI 兼容格式） */
  aiBaseUrl?: string
  aiApiKey?: string
  aiModel?: string
  /** 已保存的服务商档案（里程碑 179）：多套 Base URL+Key+模型，一键互切不用重填 Key */
  aiProfiles?: { name: string; baseUrl: string; apiKey: string; model: string }[]
  /** 导入后自动执行 AI 处理（改名+打标签） */
  aiAutoOnImport?: boolean
  /** Agent 权限（里程碑 182）：默认都不允许，需用户在设置 → Agent 接入显式打开。
   *  - agentAllowMove：允许 Agent 移动导入（会把源文件从原位置删掉）
   *  - agentAllowAutoTag：允许 Agent 触发 AI 自动打标签（会把图片缩略图发给所配置的模型） */
  agentAllowMove?: boolean
  agentAllowAutoTag?: boolean
  /** Agent 可写文件夹（里程碑 183）：勾选的文件夹及其子文件夹允许 Agent 归档/导入进去。
   *  为空 = 只允许写「Agent 导入」专属文件夹 */
  agentWriteFolders?: number[]
  /** true = 不限制 Agent 可写文件夹（显式逃生门，默认关） */
  agentScopeUnrestricted?: boolean
  /** 浮动白板窗状态(位置/尺寸/最小化),重开保持与上次一致 */
  floatingWindow?: { x: number; y: number; width: number; height: number; minimized: boolean }
}

function configPath(): string {
  return join(app.getPath('userData'), CONFIG_NAME)
}

/** AI Key 加密存储（Windows DPAPI / macOS Keychain / Linux keyring）。不可用或未 ready 时退回明文 */
function encryptKey(key: string): string {
  if (!key || !app.isReady()) return key
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return ENC_PREFIX + safeStorage.encryptString(key).toString('base64')
    }
  } catch (e) {
    logger.warn('[library]', `API Key 加密失败,退回明文: ${(e as Error).message}`)
  }
  return key
}

/** 解密 enc:v1: 前缀的 Key；解密失败（换机/换系统用户）时丢弃——密文已不可恢复 */
function decryptKey(v: string): string {
  if (!v.startsWith(ENC_PREFIX)) return v
  try {
    return safeStorage.decryptString(Buffer.from(v.slice(ENC_PREFIX.length), 'base64'))
  } catch (e) {
    logger.warn('[library]', `API Key 解密失败已丢弃(可能因换机/换系统用户): ${(e as Error).message}`)
    return ''
  }
}

/** 旧配置里的明文 Key 首次读取时立即回写为加密形态（只做一次，loadConfig 调用频繁不能反复写盘） */
let keyMigrated = false
/**
 * 配置内存缓存(写透):单实例锁保证只有本进程写 config.json,读全部走缓存。
 * loadConfig 此前每次调用都同步读盘+JSON.parse,而 asset:// 协议的每个缩略图请求
 * 都经 assetPaths→getLibraryPath→loadConfig,是全应用最热的读路径之一。
 * 缓存持有解密后的明文(磁盘上 Key 是密文);saveConfig 写盘后同步更新缓存。
 */
let cachedConfig: AppConfig | null = null

export function defaultLibraryPath(): string {
  return join(app.getPath('documents'), 'EagleLike.library')
}

export function loadConfig(): AppConfig {
  // 浅克隆:调用方对顶层字段的替换(replace 而非原地改)不影响缓存,直到其 saveConfig 写回
  if (cachedConfig) return { ...cachedConfig }
  const p = configPath()
  let raw: Partial<AppConfig> & { libraryPath?: string } = {}
  if (existsSync(p)) {
    try {
      raw = JSON.parse(readFileSync(p, 'utf-8'))
    } catch (e) {
      /* 配置损坏则重建 */
      logger.warn('[library]', `配置文件损坏已重建: ${(e as Error).message}`)
    }
  }
  // 兼容旧格式 { libraryPath }
  if (!raw.libraries && raw.libraryPath) {
    const cfg: AppConfig = {
      libraries: [{ name: basename(raw.libraryPath), path: raw.libraryPath }],
      current: raw.libraryPath,
      watchDirs: [],
      importMode: 'copy'
    }
    saveConfig(cfg)
    return cfg
  }
  if (raw.libraries && raw.libraries.length > 0 && raw.current) {
    const cfg: AppConfig = {
      libraries: raw.libraries,
      current: raw.current,
      watchDirs: raw.watchDirs ?? [],
      importMode: raw.importMode ?? 'copy',
      aiBaseUrl: raw.aiBaseUrl ?? 'https://open.bigmodel.cn/api/paas/v4',
      aiApiKey: decryptKey(raw.aiApiKey ?? ''),
      aiProfiles: Array.isArray(raw.aiProfiles)
        ? raw.aiProfiles.slice(0, 20).map((p: { name?: string; baseUrl?: string; apiKey?: string; model?: string }) => ({
            name: String(p.name ?? '').slice(0, 60),
            baseUrl: String(p.baseUrl ?? ''),
            apiKey: decryptKey(String(p.apiKey ?? '')),
            model: String(p.model ?? '')
          }))
        : [],
      aiModel: raw.aiModel ?? 'glm-4v',
      aiAutoOnImport: raw.aiAutoOnImport ?? false,
      // Agent 危险权限：缺省即 false（旧配置文件升级上来也一律先关着）
      agentAllowMove: raw.agentAllowMove === true,
      agentAllowAutoTag: raw.agentAllowAutoTag === true,
      // 可写范围：缺省为空 = 只允许写「Agent 导入」；只收整数（防脏数据绕开校验）
      agentWriteFolders: Array.isArray(raw.agentWriteFolders)
        ? raw.agentWriteFolders.filter((n: unknown): n is number => Number.isInteger(n)).slice(0, 50)
        : [],
      agentScopeUnrestricted: raw.agentScopeUnrestricted === true,
      floatingWindow: raw.floatingWindow
    }
    if (!keyMigrated && typeof raw.aiApiKey === 'string' && raw.aiApiKey && !raw.aiApiKey.startsWith(ENC_PREFIX)) {
      keyMigrated = true
      try {
        saveConfig(cfg)
        logger.info('[library]', '已将明文 AI Key 迁移为系统级加密存储')
      } catch {
        /* 回写失败不影响本次启动 */
      }
    }
    return cfg
  }
  const def = defaultLibraryPath()
  const cfg: AppConfig = {
    libraries: [{ name: basename(def), path: def }],
    current: def,
    watchDirs: [],
    importMode: 'copy',
    aiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    aiApiKey: '',
    aiModel: 'glm-4v',
    aiAutoOnImport: false
  }
  saveConfig(cfg)
  return cfg
}

export function saveConfig(cfg: AppConfig): void {
  const out: AppConfig = { ...cfg }
  // Key 只以密文落盘（safeStorage 不可用时退回明文，行为与旧版一致）；已是密文则不再二次加密
  if (out.aiApiKey && !out.aiApiKey.startsWith(ENC_PREFIX)) out.aiApiKey = encryptKey(out.aiApiKey)
  // 服务商档案的 Key 同样只以密文落盘
  if (Array.isArray(out.aiProfiles)) {
    out.aiProfiles = out.aiProfiles.map((p) =>
      p.apiKey && !p.apiKey.startsWith(ENC_PREFIX) ? { ...p, apiKey: encryptKey(p.apiKey) } : p
    )
  }
  writeFileSync(configPath(), JSON.stringify(out, null, 2), 'utf-8')
  // 写透:缓存持有调用方传入的明文形态,磁盘与内存同源
  cachedConfig = cfg
}

export function ensureLibrary(libraryPath: string): string {
  mkdirSync(libraryPath, { recursive: true })
  mkdirSync(join(libraryPath, 'assets'), { recursive: true })
  openDb(libraryPath)
  return libraryPath
}

export function getLibraryPath(): string {
  return loadConfig().current
}

/** 打开/新建一个库并切换过去（目录不存在会自动创建） */
export function addAndSwitchLibrary(path: string): AppConfig {
  const cfg = loadConfig()
  if (!cfg.libraries.some((l) => l.path === path)) {
    cfg.libraries.push({ name: basename(path), path })
  }
  cfg.current = path
  closeDb()
  ensureLibrary(path)
  saveConfig(cfg)
  return cfg
}

/** 切换到已注册的库 */
export function switchLibrary(path: string): AppConfig {
  const cfg = loadConfig()
  if (!cfg.libraries.some((l) => l.path === path)) {
    throw new Error('库未注册')
  }
  cfg.current = path
  closeDb()
  ensureLibrary(path)
  saveConfig(cfg)
  return cfg
}

/** 从列表中移除库记录（不删除磁盘文件） */
export function removeLibrary(path: string): AppConfig {
  const cfg = loadConfig()
  cfg.libraries = cfg.libraries.filter((l) => l.path !== path)
  if (cfg.libraries.length === 0) {
    const def = defaultLibraryPath()
    cfg.libraries = [{ name: basename(def), path: def }]
    cfg.current = def
  } else if (cfg.current === path) {
    cfg.current = cfg.libraries[0].path
  }
  closeDb()
  ensureLibrary(cfg.current)
  saveConfig(cfg)
  return cfg
}
