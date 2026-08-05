import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { closeDb, openDb } from './db'

const CONFIG_NAME = 'config.json'

export interface LibraryEntry {
  name: string
  path: string
}

export interface AppConfig {
  libraries: LibraryEntry[]
  current: string
  watchDirs: string[]
  importMode: 'copy' | 'move'
}

function configPath(): string {
  return join(app.getPath('userData'), CONFIG_NAME)
}

export function defaultLibraryPath(): string {
  return join(app.getPath('documents'), 'EagleLike.library')
}

export function loadConfig(): AppConfig {
  const p = configPath()
  let raw: Partial<AppConfig> & { libraryPath?: string } = {}
  if (existsSync(p)) {
    try {
      raw = JSON.parse(readFileSync(p, 'utf-8'))
    } catch {
      /* 配置损坏则重建 */
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
    return {
      libraries: raw.libraries,
      current: raw.current,
      watchDirs: raw.watchDirs ?? [],
      importMode: raw.importMode ?? 'copy'
    }
  }
  const def = defaultLibraryPath()
  const cfg: AppConfig = {
    libraries: [{ name: basename(def), path: def }],
    current: def,
    watchDirs: [],
    importMode: 'copy'
  }
  saveConfig(cfg)
  return cfg
}

export function saveConfig(cfg: AppConfig): void {
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf-8')
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
