import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { logger } from './logger'
import type { UpdateStatus } from '../shared/types'

let lastStatus: UpdateStatus = { state: 'idle' }
let manualCheck = false
/** 下载失败自动重试期间置 true:期间 electron-updater 的 error 事件静默(避免重试中途弹失败提示) */
let autoRetryingDownload = false

/** 启动静默检查的重试计划：首次 8s，失败后 30s/2min/10min/30min 递增重试 */
const RETRY_DELAYS = [8000, 30_000, 120_000, 600_000, 1_800_000]
let autoRetryIndex = 0
let autoRetryTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 长跑进程的新版本发现：重试链在首个成功结果处终止，此前应用不重启就再也查不到新版本。
 * 补两条静默通道——每 6h 一次，以及窗口获焦（距上次检查满 1h 才真的发请求，避免频繁切窗口打爆网络）。
 * 两条通道都只在「没在下载、没已就绪」时工作，且不发「已是最新版本」提示。
 */
const PERIODIC_INTERVAL = 6 * 3600_000
const CHECK_MIN_GAP = 3600_000
/** 最近一次发起静默检查的时刻（周期/获焦/重试链共用，用于遵守 CHECK_MIN_GAP） */
let lastCheckAt = 0

/** UpdateInfo.releaseNotes 可能是字符串或数组，统一成纯文本 */
function releaseNotesOf(info: { releaseNotes?: unknown }): string | undefined {
  const rn = info.releaseNotes
  if (typeof rn === 'string') return rn.trim() || undefined
  if (Array.isArray(rn)) {
    const text = rn
      .map((n) => (n && typeof n === 'object' && 'note' in n ? String((n as { note: unknown }).note) : ''))
      .filter(Boolean)
      .join('\n')
    return text.trim() || undefined
  }
  return undefined
}

export function initUpdater(getWindow: () => BrowserWindow | null): void {
  const send = (status: UpdateStatus): void => {
    lastStatus = status
    logger.info('[updater]', `${status.state} ${status.version ?? ''} ${status.percent ?? ''} ${status.message ?? ''}`.trim())
    getWindow()?.webContents.send('update:event', status)
  }

  // 开发模式：只响应手动调用，给出明确状态
  if (!app.isPackaged) {
    ipcMain.handle('update:check', () => ({ state: 'dev' }) satisfies UpdateStatus)
    ipcMain.handle('update:download', () => undefined)
    ipcMain.handle('update:install', () => undefined)
    ipcMain.handle('update:getState', () => ({ state: 'dev' }) satisfies UpdateStatus)
    return
  }

  autoUpdater.autoDownload = false // 发现更新后由用户确认再下载
  // 本地联调：SHIGUANG_AUTO_DL=1 时免确认直接下载
  if (process.env.SHIGUANG_AUTO_DL === '1') autoUpdater.autoDownload = true

  // 差分下载关闭(里程碑 99 修复):NSIS 差分流程是「先差分下载一遍 → 校验失败
  // 回退整包下载一遍」,进度条表现为「100% 后又从 0 跑一遍」;在慢网/GitHub HTTP2
  // 不稳环境下差分几乎必失败,白耗一遍时间且让用户误以为下载出问题。关掉后是
  // 单次完整下载、单段 0→100 进度。
  autoUpdater.disableDifferentialDownload = true

  /** 清掉挂起的静默重试定时器(已得到结论或进入下载/完成态时,迟到的重试会重置 UI 卡片) */
  const clearRetryTimer = (): void => {
    if (autoRetryTimer) {
      clearTimeout(autoRetryTimer)
      autoRetryTimer = null
    }
  }

  /**
   * 发起一次静默检查。超时保护：网络抖动时 electron-updater 的请求可能无限挂起（无 error 事件），
   * 用 Promise.race 强制超时，超时视为失败走 onFail。
   */
  const checkOnce = (onFail: () => void): void => {
    lastCheckAt = Date.now()
    const CHECK_TIMEOUT = 60_000
    const check = autoUpdater.checkForUpdates()
    Promise.race([check, new Promise((_, rej) => setTimeout(() => rej(new Error('检查超时')), CHECK_TIMEOUT))])
      .then(() => {
        autoRetryIndex = 0
      })
      .catch(onFail)
  }

  /** 启动静默自动检查（失败/超时自动重试，直至成功或重试次数耗尽） */
  const scheduleAutoCheck = (delay: number): void => {
    if (autoRetryTimer) clearTimeout(autoRetryTimer)
    autoRetryTimer = setTimeout(() => {
      // 下载中/已完成时不再打扰(重复检查会触发 available 事件重置「已就绪」状态)
      if (lastStatus.state === 'downloading' || lastStatus.state === 'downloaded') return
      checkOnce(() => {
        // 静默检查失败：按计划重试（网络抖动常见），不打扰用户
        if (autoRetryIndex < RETRY_DELAYS.length - 1) {
          autoRetryIndex++
          logger.warn('[updater]', `静默检查失败，${RETRY_DELAYS[autoRetryIndex] / 1000}s 后重试`)
          scheduleAutoCheck(RETRY_DELAYS[autoRetryIndex])
        } else {
          logger.warn('[updater]', '静默检查重试次数耗尽（可手动「检查更新」，周期检查仍会继续）')
        }
      })
    }, delay)
  }

  /** 周期/获焦共用的机会性检查：不打扰下载流程，失败不重试（下个周期再来） */
  const opportunisticCheck = (reason: string): void => {
    if (lastStatus.state === 'downloading' || lastStatus.state === 'downloaded') return
    if (Date.now() - lastCheckAt < CHECK_MIN_GAP) return
    logger.info('[updater]', `${reason}触发静默检查`)
    checkOnce(() => logger.warn('[updater]', `${reason}静默检查失败`))
  }

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => {
    autoRetryIndex = 0
    clearRetryTimer() // 已确认有更新,挂起的重试不再需要(否则迟到重试会重置卡片)
    send({ state: 'available', version: info.version, notes: releaseNotesOf(info) })
  })
  autoUpdater.on('update-not-available', () => {
    autoRetryIndex = 0
    clearRetryTimer()
    // 静默启动检查无更新时不打扰；仅手动检查才提示「已是最新」
    if (manualCheck) send({ state: 'none' })
    else lastStatus = { state: 'none' }
    manualCheck = false
  })
  autoUpdater.on('download-progress', (p) =>
    send({ state: 'downloading', percent: Math.floor(p.percent) })
  )
  autoUpdater.on('update-downloaded', (info) => {
    clearRetryTimer()
    send({ state: 'downloaded', version: info.version, notes: releaseNotesOf(info) })
  })
  autoUpdater.on('error', (err) => {
    // 网络异常只在手动检查时提示；下载阶段的错误必须提示（否则用户点「立即下载」无反馈）；
    // 自动重试期间的中间错误静默,由 update:download 兜底最终失败提示
    if (manualCheck || (lastStatus.state === 'downloading' && !autoRetryingDownload)) {
      send({ state: 'error', message: err?.message ?? '网络异常' })
    } else {
      logger.warn('[updater]', `silent error: ${err?.message ?? err}`)
    }
    manualCheck = false
  })

  // 启动后延迟静默检查一次（失败按 RETRY_DELAYS 递增重试）
  scheduleAutoCheck(RETRY_DELAYS[0])
  // 长跑进程兜底：周期检查 + 窗口获焦检查（应用常开数天不重启也能发现新版本）
  setInterval(() => opportunisticCheck('周期'), PERIODIC_INTERVAL)
  app.on('browser-window-focus', () => opportunisticCheck('窗口获焦'))

  ipcMain.handle('update:check', async () => {
    // 下载进行中/已完成时不重复检查:重复的 available 事件会重置进度卡片与「已就绪」角标
    if (lastStatus.state === 'downloading' || lastStatus.state === 'downloaded') return lastStatus
    manualCheck = true
    lastCheckAt = Date.now() // 手动检查也算「刚查过」，避免紧随其后的获焦检查重复发请求
    try {
      await autoUpdater.checkForUpdates()
    } catch (e) {
      manualCheck = false
      send({ state: 'error', message: e instanceof Error ? e.message : '检查失败' })
    }
    return lastStatus
  })
  ipcMain.handle('update:download', async () => {
    // 幂等防护:双击/重复触发不并发重复下载(差分回退已禁,单次下载单段进度)
    if (lastStatus.state === 'downloading' || lastStatus.state === 'downloaded') return
    // 网络错误自动重试(里程碑 99):大安装包下载中途 ERR_* 断连很常见,此前一次失败
    // 用户只能手动重来(曾发生 40 分钟下载死于 HTTP2 错误);这里对网络类错误静默
    // 重试 2 次(5s 间隔),最终失败才报错给渲染层。重试期间状态保持 downloading,
    // 配合上方的 check 防护不会插入新的检查。
    autoRetryingDownload = true
    try {
      let lastError: unknown = null
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await autoUpdater.downloadUpdate()
          return
        } catch (e) {
          lastError = e
          const msg = e instanceof Error ? e.message : String(e)
          const networkish = /ERR_|ETIMEDOUT|ECONN|ENOTFOUND|net::/i.test(msg)
          if (!networkish || attempt >= 2) throw e
          logger.warn('[updater]', `下载失败(${msg}),5s 后自动重试(${attempt + 1}/2)`)
          await new Promise((r) => setTimeout(r, 5000))
        }
      }
      // 理论上到不了这里(循环内最终 throw),仅为类型收窄
      const e = lastError
      send({ state: 'error', message: e instanceof Error ? e.message : '下载失败' })
      throw e
    } finally {
      autoRetryingDownload = false
    }
  })
  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall(false, true)
  })
  ipcMain.handle('update:getState', () => lastStatus)
}
