/* UI 截图工具：加载 out/renderer（需先 npm run build），用 mock 数据渲染后抓图
   用法：npx electron .ui-shot/main.cjs  →  产物在 .ui-shot/*.png */
const { app, BrowserWindow, protocol } = require('electron')
const path = require('path')
const fs = require('fs')
const zlib = require('zlib')

// 与开发实例并存时避免 GPU 竞争（viz 合成错误）
// app.disableHardwareAcceleration()
// 独立 userData，避免与 dev/正式版实例争用缓存目录
app.setPath('userData', path.join(__dirname, '.userdata'))

/* ---- 极简 PNG 编码器（纯色/渐变占位图） ---- */
let CRC_TABLE = null
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function makePng(w, h, pixelFn) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    const rs = y * (w * 3 + 1)
    raw[rs] = 0
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixelFn(x, y)
      const i = rs + 1 + x * 3
      raw[i] = r
      raw[i + 1] = g
      raw[i + 2] = b
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'asset', privileges: { standard: true, secure: true, stream: true } }
])

/** 由 id 生成一张「照片感」渐变图 */
function placeholder(id) {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  h = (h * 2654435761) >>> 0
  const hue = h % 360
  const hue2 = (hue + 40 + (h % 80)) % 360
  const w = 240
  const hh = 160 + ((h >> 8) % 5) * 36
  const hsl = (hh_, s, l) => {
    s /= 100
    l /= 100
    const k = (n) => (n + hh_ / 30) % 12
    const a = s * Math.min(l, 1 - l)
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
  }
  const c1 = hsl(hue, 45, 62)
  const c2 = hsl(hue2, 55, 30)
  const sun = hsl((hue + 20) % 360, 70, 75)
  const sx = w * (0.25 + ((h >> 3) % 50) / 100)
  const sy = hh * 0.32
  const sr = w * 0.16
  return makePng(w, hh, (x, y) => {
    const t = y / hh
    let r = c1[0] + (c2[0] - c1[0]) * t
    let g = c1[1] + (c2[1] - c1[1]) * t
    let b = c1[2] + (c2[2] - c1[2]) * t
    const d = Math.sqrt((x - sx) ** 2 + (y - sy) ** 2)
    if (d < sr) {
      const k = 1 - d / sr
      r += (sun[0] - r) * k * 0.85
      g += (sun[1] - g) * k * 0.85
      b += (sun[2] - b) * k * 0.85
    }
    // 底部一道「地平线」暗影
    if (t > 0.78) {
      const k = (t - 0.78) / 0.22
      r *= 1 - k * 0.45
      g *= 1 - k * 0.45
      b *= 1 - k * 0.45
    }
    return [r | 0, g | 0, b | 0]
  })
}

app.whenReady().then(async () => {
  // 看门狗：任何步骤卡死都保证退出
  setTimeout(() => {
    console.error('watchdog: force exit')
    app.exit(2)
  }, 90000).unref()

  process.on('unhandledRejection', (e) => {
    console.error('unhandledRejection:', e && e.stack ? e.stack : e)
    app.exit(3)
  })

  const cache = new Map()
  protocol.handle('asset', (req) => {
    const id = new URL(req.url).host
    if (!cache.has(id)) cache.set(id, placeholder(id))
    return new Response(cache.get(id), { headers: { 'content-type': 'image/png' } })
  })

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: false,
      offscreen: true
    }
  })

  await win.loadFile(path.join(__dirname, '..', 'out', 'renderer', 'index.html'))
  win.webContents.on('console-message', (_e, _l, msg) => console.log('[renderer]', msg))
  await new Promise((r) => setTimeout(r, 3500))

  const shot = async (name) => {
    const img = await win.webContents.capturePage()
    fs.writeFileSync(path.join(__dirname, name), img.toPNG())
    console.log('saved', name)
  }

  // 1. 首页
  await shot('shot-1-home.png')

  // 2. 选中一张卡片（联动 Inspector）
  await win.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('[role="button"]')
    if (card) card.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })()`)
  await new Promise((r) => setTimeout(r, 500))
  await shot('shot-2-selected.png')

  // 3. 双击进入大图预览
  const dbg = await win.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('[role="button"]')
    if (!card) return 'no card'
    const opts = { bubbles: true, cancelable: true, view: window }
    card.dispatchEvent(new MouseEvent('mousedown', opts))
    card.dispatchEvent(new MouseEvent('mouseup', opts))
    card.dispatchEvent(new MouseEvent('click', { ...opts, detail: 1 }))
    card.dispatchEvent(new MouseEvent('mousedown', opts))
    card.dispatchEvent(new MouseEvent('mouseup', opts))
    card.dispatchEvent(new MouseEvent('click', { ...opts, detail: 2 }))
    card.dispatchEvent(new MouseEvent('dblclick', { ...opts, detail: 2 }))
    return 'dispatched'
  })()`)
  console.log('dblclick:', dbg)
  await new Promise((r) => setTimeout(r, 300))
  const opened = await win.webContents.executeJavaScript(
    `document.querySelector('[aria-modal="true"]')?.getAttribute('aria-label') ?? 'none'`
  )
  console.log('overlay now:', opened)
  await new Promise((r) => setTimeout(r, 1500))
  const opened2 = await win.webContents.executeJavaScript(
    `document.querySelector('[aria-modal="true"]')?.getAttribute('aria-label') ?? 'none'`
  )
  console.log('overlay after 1.5s:', opened2)
  await shot('shot-3-preview.png')

  // 页面内辅助：按文本点击按钮
  await win.webContents.executeJavaScript(`(() => {
    window.__clickText = (txt) => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(txt))
      if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return !!b
    }
    window.__clickSel = (sel) => {
      const b = document.querySelector(sel)
      if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return !!b
    }
  })()`)

  // 4. 编辑器（预览中点「编辑」）
  await win.webContents.executeJavaScript(`window.__clickText('编辑')`)
  await new Promise((r) => setTimeout(r, 1200))
  await shot('shot-4-editor.png')
  await win.webContents.executeJavaScript(`window.__clickText('取消')`) // 关编辑器
  await new Promise((r) => setTimeout(r, 300))
  await win.webContents.executeJavaScript(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`
  ) // 关预览
  await new Promise((r) => setTimeout(r, 400))

  // 5. 右键菜单
  await win.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('[role="button"]')
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 700, clientY: 400 }))
  })()`)
  await new Promise((r) => setTimeout(r, 400))
  await shot('shot-5-contextmenu.png')
  await win.webContents.executeJavaScript(`(() => {
    const c = document.querySelector('main .modal-scroll')
    if (c) c.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })()`)
  await new Promise((r) => setTimeout(r, 300))

  // 6. 颜色筛选弹层
  await win.webContents.executeJavaScript(`window.__clickSel('[aria-label="按颜色筛选"]')`)
  await new Promise((r) => setTimeout(r, 400))
  await shot('shot-6-color.png')
  await win.webContents.executeJavaScript(`window.__clickSel('[aria-label="按颜色筛选"]')`)
  await new Promise((r) => setTimeout(r, 200))

  // 7. 查重弹窗
  await win.webContents.executeJavaScript(`window.__clickText('查重')`)
  await new Promise((r) => setTimeout(r, 600))
  await shot('shot-7-dupe.png')
  await win.webContents.executeJavaScript(`window.__clickText('关闭')`)
  await new Promise((r) => setTimeout(r, 200))

  // 8. 设置弹窗
  await win.webContents.executeJavaScript(`window.__clickSel('[aria-label="打开设置"]')`)
  await new Promise((r) => setTimeout(r, 600))
  await shot('shot-8-settings.png')
  await win.webContents.executeJavaScript(`window.__clickSel('[aria-label="关闭设置"]')`)
  await new Promise((r) => setTimeout(r, 300))

  // 9. 悬停放大预览（mouseover 触发，等待 420ms 延迟）
  await win.webContents.executeJavaScript(`(() => {
    const cards = document.querySelectorAll('[role="button"]')
    if (cards[1]) cards[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  })()`)
  await new Promise((r) => setTimeout(r, 900))
  await shot('shot-9-hover.png')
  await win.webContents.executeJavaScript(`(() => {
    const cards = document.querySelectorAll('[role="button"]')
    if (cards[1]) cards[1].dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
  })()`)
  await new Promise((r) => setTimeout(r, 200))

  // 10. 多选（Ctrl 加选）→ 批量标签面板
  await win.webContents.executeJavaScript(`(() => {
    const cards = document.querySelectorAll('[role="button"]')
    if (cards[0]) cards[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    if (cards[2]) cards[2].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
  })()`)
  await new Promise((r) => setTimeout(r, 400))
  await shot('shot-10-batchtag.png')
  await win.webContents.executeJavaScript(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`
  )
  await new Promise((r) => setTimeout(r, 200))

  // 11. 右键菜单 → 搜索相似图片（横幅）
  await win.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('[role="button"]')
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 700, clientY: 400 }))
  })()`)
  await new Promise((r) => setTimeout(r, 300))
  await win.webContents.executeJavaScript(`window.__clickText('搜索相似图片')`)
  await new Promise((r) => setTimeout(r, 600))
  await shot('shot-11-similar.png')
  await win.webContents.executeJavaScript(`window.__clickText('退出')`)
  await new Promise((r) => setTimeout(r, 300))

  // 12. 网格布局
  await win.webContents.executeJavaScript(`window.__clickSel('[aria-label="网格"]')`)
  await new Promise((r) => setTimeout(r, 500))
  await shot('shot-12-grid.png')

  // 13. 列表布局
  await win.webContents.executeJavaScript(`window.__clickSel('[aria-label="列表"]')`)
  await new Promise((r) => setTimeout(r, 500))
  await shot('shot-13-list.png')
  await win.webContents.executeJavaScript(`window.__clickSel('[aria-label="瀑布流"]')`)
  await new Promise((r) => setTimeout(r, 300))

  // 14. 预览缩放（滚轮放大后拖动）
  await win.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('[role="button"]')
    const opts = { bubbles: true, cancelable: true, view: window }
    card.dispatchEvent(new MouseEvent('mousedown', opts))
    card.dispatchEvent(new MouseEvent('mouseup', opts))
    card.dispatchEvent(new MouseEvent('click', { ...opts, detail: 1 }))
    card.dispatchEvent(new MouseEvent('mousedown', opts))
    card.dispatchEvent(new MouseEvent('mouseup', opts))
    card.dispatchEvent(new MouseEvent('click', { ...opts, detail: 2 }))
    card.dispatchEvent(new MouseEvent('dblclick', { ...opts, detail: 2 }))
  })()`)
  await new Promise((r) => setTimeout(r, 600))
  await win.webContents.executeJavaScript(`(() => {
    const stage = document.querySelector('[aria-modal="true"] .overflow-hidden')
    if (stage) {
      for (let i = 0; i < 4; i++) {
        stage.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -240, clientX: 900, clientY: 450 }))
      }
    }
  })()`)
  await new Promise((r) => setTimeout(r, 500))
  await shot('shot-14-zoom.png')
  await win.webContents.executeJavaScript(`window.__clickText('关闭')`)
  await new Promise((r) => setTimeout(r, 300))

  // 15. 回收站视图（批量操作按钮）
  await win.webContents.executeJavaScript(`window.__clickText('回收站')`)
  await new Promise((r) => setTimeout(r, 500))
  await win.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('[role="button"]')
    if (card) card.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })()`)
  await new Promise((r) => setTimeout(r, 300))
  await shot('shot-15-trash.png')
  await win.webContents.executeJavaScript(`window.__clickText('全部素材')`)
  await new Promise((r) => setTimeout(r, 300))

  // 16. 标签右键菜单（颜色 + 移动到分组）
  await win.webContents.executeJavaScript(`(() => {
    const el = [...document.querySelectorAll('nav button')].find((b) => b.textContent.trim().startsWith('风光'))
    if (el) {
      const r = el.getBoundingClientRect()
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.x + 40, clientY: r.y + 8 }))
    }
  })()`)
  await new Promise((r) => setTimeout(r, 400))
  await shot('shot-16-tagmenu.png')
  await win.webContents.executeJavaScript(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`
  )
  await new Promise((r) => setTimeout(r, 200))

  // 17. 折叠「智能文件夹」分区（标签区应获得更多空间）
  await win.webContents.executeJavaScript(`window.__clickSel('[aria-label="折叠智能文件夹"]')`)
  await new Promise((r) => setTimeout(r, 400))
  await shot('shot-17-folded.png')

  app.exit(0)
})
