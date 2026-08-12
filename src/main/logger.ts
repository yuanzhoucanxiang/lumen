import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'fs'
import { join } from 'path'

const MAX_SIZE = 2 * 1024 * 1024 // 2MB 触发轮转

let logFile = ''
let inited = false

function timestamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function rotateIfNeeded(): void {
  try {
    if (!existsSync(logFile)) return
    if (statSync(logFile).size < MAX_SIZE) return
    const bak = `${logFile}.1`
    if (existsSync(bak)) renameSync(bak, `${logFile}.2`)
    renameSync(logFile, bak)
  } catch {
    /* 轮转失败不影响后续写入 */
  }
}

function write(level: string, ctx: string, msg: string): void {
  if (!inited) return
  const line = `[${timestamp()}] ${level} ${ctx} ${msg}\n`
  try {
    rotateIfNeeded()
    appendFileSync(logFile, line, 'utf-8')
  } catch {
    /* 写盘失败静默,避免日志本身导致崩溃 */
  }
  // 开发模式同时输出到控制台,便于调试
  if (!app.isPackaged) console.log(line.trimEnd())
}

export const logger = {
  info: (ctx: string, msg: string): void => write('INFO ', ctx, msg),
  warn: (ctx: string, msg: string): void => write('WARN ', ctx, msg),
  error: (ctx: string, msg: string): void => write('ERROR', ctx, msg),
  debug: (ctx: string, msg: string): void => {
    if (!app.isPackaged) write('DEBUG', ctx, msg)
  }
}

/** 初始化日志系统:创建 logs 目录,注册全局异常兜底。须在 app.whenReady 后调用。 */
export function initLogger(): void {
  if (inited) return
  const dir = join(app.getPath('userData'), 'logs')
  mkdirSync(dir, { recursive: true })
  logFile = join(dir, 'main.log')
  inited = true

  // 全局异常兜底:记录但不退出(Electron 主进程崩溃影响大,先留痕)
  process.on('uncaughtException', (err) => {
    write('ERROR', '[process]', `uncaughtException: ${err.stack ?? err.message}`)
  })
  process.on('unhandledRejection', (reason) => {
    write('ERROR', '[process]', `unhandledRejection: ${String(reason)}`)
  })

  logger.info('[logger]', `日志系统启动,文件: ${logFile}`)
}

/** 当前日志文件路径(供导出日志功能使用) */
export function logFilePath(): string {
  return logFile
}
