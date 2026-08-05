const CLIP_URL = 'http://127.0.0.1:45678/clip'
const STATUS_URL = 'http://127.0.0.1:45678/status'

/* ---------------- 通用 ---------------- */

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result)
    fr.onerror = reject
    fr.readAsDataURL(blob)
  })
}

/** 把 dataUrl 图片 POST 到 LUMEN */
async function postDataUrl(dataUrl, filename, pageUrl, title) {
  const r = await fetch(CLIP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl, filename, pageUrl, title })
  })
  const j = await r.json()
  if (!j.ok) throw new Error(j.error || '导入失败')
  return j.imported || 0
}

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  return tabs[0]
}

/* ---------------- 整页批量剪藏（带过滤） ---------------- */

/** 在页面中收集图片 URL（按最小宽度与格式过滤） */
function collectImages(minW, exts) {
  const seen = new Set()
  const urls = []
  const og = document.querySelector('meta[property="og:image"]')
  if (og && og.content) urls.push(og.content)
  document.querySelectorAll('img').forEach((img) => {
    const src = img.currentSrc || img.src
    if (!src) return
    const w = img.naturalWidth || img.width || 0
    const h = img.naturalHeight || img.height || 0
    if (w < 64 && h < 64) return
    if (minW > 0 && w > 0 && w < minW) return
    urls.push(src)
  })
  return urls.filter((u) => {
    if (seen.has(u)) return false
    seen.add(u)
    if (!/^(https?:|data:image)/.test(u)) return false
    if (exts && exts.length > 0) {
      const m = u.match(/\.(jpe?g|png|gif|webp|svg|avif|bmp)(?:[?#]|$)/i)
      if (m && !exts.includes(m[1].toLowerCase().replace('jpeg', 'jpg'))) return false
    }
    return true
  })
}

async function clipOne(url, tab) {
  const filename = decodeURIComponent((url.split('/').pop() || '').split('?')[0]) || undefined
  if (url.startsWith('data:image')) {
    return postDataUrl(url, filename, tab.url, tab.title)
  }
  // 优先浏览器内抓取，失败则交给 LUMEN 服务端下载（绕过 CORS）
  try {
    const resp = await fetch(url, { mode: 'cors', credentials: 'omit' })
    if (resp.ok) {
      const blob = await resp.blob()
      if (blob.type.startsWith('image/') || blob.size > 0) {
        return await postDataUrl(await blobToDataUrl(blob), filename, tab.url, tab.title)
      }
    }
  } catch {
    /* 回退到服务端下载 */
  }
  const r = await fetch(CLIP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl: url, filename, pageUrl: tab.url, title: tab.title })
  })
  const j = await r.json()
  return j.imported || 0
}

async function clipPage(tab, minW, exts) {
  await fetch(STATUS_URL) // 确认应用运行中
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: collectImages,
    args: [minW ?? 0, exts ?? []]
  })
  const urls = results[0]?.result ?? []
  let imported = 0
  const queue = [...urls]
  const workers = Array.from({ length: 4 }, async () => {
    while (queue.length > 0) {
      const url = queue.shift()
      try {
        imported += await clipOne(url, tab)
      } catch {
        /* 单张失败不影响整体 */
      }
    }
  })
  await Promise.all(workers)
  return { total: urls.length, imported }
}

/* ---------------- 区域截图 ---------------- */

/** 注入页面：拖选区域，返回 {x,y,w,h,canceled}（Esc 取消） */
function regionSelector() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,0.35)'
    const box = document.createElement('div')
    box.style.cssText = 'position:fixed;border:2px solid #4da9e9;background:rgba(77,169,233,0.12);display:none'
    overlay.appendChild(box)
    document.documentElement.appendChild(overlay)

    let sx = 0
    let sy = 0
    let dragging = false
    const done = (r) => {
      overlay.remove()
      window.removeEventListener('keydown', onKey, true)
      resolve(r)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        done({ canceled: true })
      }
    }
    window.addEventListener('keydown', onKey, true)
    overlay.addEventListener('mousedown', (e) => {
      dragging = true
      sx = e.clientX
      sy = e.clientY
      box.style.display = 'block'
    })
    overlay.addEventListener('mousemove', (e) => {
      if (!dragging) return
      const x = Math.min(sx, e.clientX)
      const y = Math.min(sy, e.clientY)
      const w = Math.abs(e.clientX - sx)
      const h = Math.abs(e.clientY - sy)
      box.style.left = x + 'px'
      box.style.top = y + 'px'
      box.style.width = w + 'px'
      box.style.height = h + 'px'
    })
    overlay.addEventListener('mouseup', (e) => {
      if (!dragging) return
      const x = Math.min(sx, e.clientX)
      const y = Math.min(sy, e.clientY)
      const w = Math.abs(e.clientX - sx)
      const h = Math.abs(e.clientY - sy)
      done(w < 4 || h < 4 ? { canceled: true } : { x, y, w, h, canceled: false })
    })
  })
}

/** dataUrl → OffscreenCanvas 裁剪 → 新 dataUrl */
async function cropDataUrl(dataUrl, rect, dpr) {
  const blob = await (await fetch(dataUrl)).blob()
  const bmp = await createImageBitmap(blob)
  const canvas = new OffscreenCanvas(Math.round(rect.w * dpr), Math.round(rect.h * dpr))
  const ctx = canvas.getContext('2d')
  ctx.drawImage(
    bmp,
    Math.round(rect.x * dpr),
    Math.round(rect.y * dpr),
    Math.round(rect.w * dpr),
    Math.round(rect.h * dpr),
    0,
    0,
    canvas.width,
    canvas.height
  )
  return blobToDataUrl(await canvas.convertToBlob({ type: 'image/png' }))
}

async function regionClip(tab) {
  await fetch(STATUS_URL)
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: regionSelector
  })
  if (!result || result.canceled) return { canceled: true }
  const dprResult = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => window.devicePixelRatio
  })
  const dpr = dprResult[0]?.result ?? 1
  const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
  const cropped = await cropDataUrl(shot, result, dpr)
  const name = `${(tab.title || 'page').slice(0, 40)}_区域截图.png`
  await postDataUrl(cropped, name, tab.url, tab.title)
  return { canceled: false, w: result.w, h: result.h }
}

/* ---------------- 整页长截图 ---------------- */

function pageMetrics() {
  const d = document.documentElement
  return {
    vh: window.innerHeight,
    pageH: Math.max(d.scrollHeight, document.body ? document.body.scrollHeight : 0),
    dpr: window.devicePixelRatio,
    y: window.scrollY
  }
}

function scrollToY(y) {
  window.scrollTo(0, y)
}

function restoreScroll(y) {
  window.scrollTo(0, y)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fullPageClip(tab) {
  await fetch(STATUS_URL)
  const [{ result: m }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: pageMetrics
  })
  if (!m) throw new Error('无法读取页面信息')
  const pageH = Math.min(m.pageH, 12000) // 上限 12000 CSS px
  const shots = []
  for (let y = 0; y < pageH; y += m.vh) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scrollToY, args: [y] })
    await sleep(600) // captureVisibleTab 限速 + 页面渲染
    shots.push(await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }))
  }
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: restoreScroll, args: [m.y] })

  // 拼接（先读第一段拿视口宽高）
  const dpr = m.dpr
  const firstBmp = await createImageBitmap(await (await fetch(shots[0])).blob())
  const w = firstBmp.width
  const canvas = new OffscreenCanvas(w, Math.round(pageH * dpr))
  const ctx = canvas.getContext('2d')
  let offsetY = 0
  for (let i = 0; i < shots.length; i++) {
    const bmp = i === 0 ? firstBmp : await createImageBitmap(await (await fetch(shots[i])).blob())
    const remaining = canvas.height - offsetY
    if (remaining <= 0) break
    const srcH = Math.min(bmp.height, remaining)
    ctx.drawImage(bmp, 0, 0, bmp.width, srcH, 0, offsetY, w, srcH)
    offsetY += srcH
  }
  const dataUrl = await blobToDataUrl(await canvas.convertToBlob({ type: 'image/png' }))
  const name = `${(tab.title || 'page').slice(0, 40)}_长截图.png`
  await postDataUrl(dataUrl, name, tab.url, tab.title)
  return { shots: shots.length }
}

/* ---------------- 消息路由 ---------------- */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handle = async () => {
    const tab = await activeTab()
    if (!tab) return { ok: false, error: '未找到活动标签页' }
    try {
      if (msg.type === 'clipPage') return { ok: true, ...(await clipPage(tab, msg.minW, msg.exts)) }
      if (msg.type === 'regionClip') return { ok: true, ...(await regionClip(tab)) }
      if (msg.type === 'fullPageClip') return { ok: true, ...(await fullPageClip(tab)) }
      return { ok: false, error: 'unknown message' }
    } catch (e) {
      return { ok: false, error: '无法连接 LUMEN 或操作失败：' + (e && e.message ? e.message : e) }
    }
  }
  handle().then(sendResponse)
  return true // 异步响应
})

/* ---------------- 右键菜单：剪藏单张图片 ---------------- */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'lumen-clip-image',
    title: '剪藏图片到 LUMEN',
    contexts: ['image']
  })
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'lumen-clip-image' || !info.srcUrl) return
  try {
    await clipOne(info.srcUrl, { url: info.pageUrl, title: tab ? tab.title : '' })
  } catch {
    /* 应用未运行时忽略 */
  }
})
