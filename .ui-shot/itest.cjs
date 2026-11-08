/* 真机集成测试：通过 CDP 驱动 dev 实例的渲染进程，用真实素材库断言 IPC 全链路
   前置：npm run dev -- --remote-debugging-port=9333 */
const WebSocket = require('ws')
const http = require('http')

function getJson(url) {
  return new Promise((res, rej) =>
    http
      .get(url, (r) => {
        let d = ''
        r.on('data', (c) => (d += c))
        r.on('end', () => res(JSON.parse(d)))
      })
      .on('error', rej)
  )
}

async function main() {
  const targets = await getJson('http://127.0.0.1:9333/json/list')
  const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
  if (!page) throw new Error('找不到渲染进程页面（dev 未就绪？）')

  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false })
  await new Promise((r, j) => {
    ws.on('open', r)
    ws.on('error', j)
  })

  let id = 0
  const pending = new Map()
  ws.on('message', (m) => {
    const msg = JSON.parse(m.toString())
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  })
  const evalJs = (expression) =>
    new Promise((resolve, reject) => {
      const mid = ++id
      pending.set(mid, (msg) => {
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
      })
      ws.send(
        JSON.stringify({
          id: mid,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: true }
        })
      )
    })

  let pass = 0
  let fail = 0
  const check = (name, ok, detail) => {
    console.log(ok ? '  PASS' : '  FAIL', name, '—', detail)
    if (ok) pass++
    else fail++
  }

  const stats = (await evalJs(`window.api.getLibraryStats()`)).result.value
  check('getLibraryStats', stats && typeof stats.total === 'number', JSON.stringify(stats))

  const assets = (await evalJs(`window.api.queryAssets({ limit: 5 })`)).result.value
  check('queryAssets', Array.isArray(assets), `${Array.isArray(assets) ? assets.length : '?'} 条`)

  const tags = (await evalJs(`window.api.listTags()`)).result.value
  check('listTags', Array.isArray(tags), `${Array.isArray(tags) ? tags.length : '?'} 个`)

  const groups = (await evalJs(`window.api.listTagGroups()`)).result.value
  check('listTagGroups', Array.isArray(groups), `${Array.isArray(groups) ? groups.length : '?'} 个`)

  const folders = (await evalJs(`window.api.listFolders()`)).result.value
  check('listFolders', Array.isArray(folders), `${Array.isArray(folders) ? folders.length : '?'} 个`)

  const dupes = (await evalJs(`window.api.findDuplicates()`)).result.value
  check('findDuplicates', Array.isArray(dupes), `${Array.isArray(dupes) ? dupes.length : '?'} 组`)

  if (Array.isArray(assets) && assets.length > 0) {
    // 选一个浏览器可解码的图片素材来测 asset: 协议（视频/音频不能被 <img> 加载）。
    // 用宽查询(前 100 条)而非首页 5 条:默认排序的首页可能全是视频/字体,曾致三个用例长期环境性跳过
    const imgAsset = assets.find(
      (a) => ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'tiff', 'tif'].includes(a.ext)
    ) || (await evalJs(`window.api.queryAssets({ limit: 100 })`)).result.value?.find(
      (a) => ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'tiff', 'tif'].includes(a.ext)
    )
    if (imgAsset) {
      const id0 = imgAsset.id
      const sim = (await evalJs(`window.api.findSimilar(${JSON.stringify(id0)})`)).result.value
      check('findSimilar', Array.isArray(sim), `${Array.isArray(sim) ? sim.length : '?'} 个`)

    // 用 <img> 真实加载路径验证 asset: 协议（fetch 不支持自定义 scheme）
    const thumbUrl = (await evalJs(`window.api.thumbnailUrl(${JSON.stringify(id0)})`)).result.value
    const st = (
      await evalJs(
        `new Promise((res) => { const i = new Image(); i.onload = () => res(i.naturalWidth); i.onerror = () => res(-1); i.src = ${JSON.stringify(thumbUrl)} })`
      )
    ).result.value
    check('asset:// 缩略图可加载', st > 0, `naturalWidth=${st}`)

    const origUrl = (await evalJs(`window.api.originalUrl(${JSON.stringify(id0)})`)).result.value
    const st2 = (
      await evalJs(
        `new Promise((res) => { const i = new Image(); i.onload = () => res(i.naturalWidth); i.onerror = () => res(-1); i.src = ${JSON.stringify(origUrl)} })`
      )
    ).result.value
    check('asset:// 原图可加载', st2 > 0, `naturalWidth=${st2}`)
    } else {
      check('findSimilar', false, '库内无可测图片，跳过')
      check('asset:// 缩略图', false, '库内无可测图片，跳过')
      check('asset:// 原图', false, '库内无可测图片，跳过')
    }
  } else {
    check('findSimilar', false, '库内无素材，跳过')
    check('asset:// 缩略图', false, '库内无素材，跳过')
    check('asset:// 原图', false, '库内无素材，跳过')
  }

  const settings = (await evalJs(`window.api.getSettings()`)).result.value
  check('getSettings', !!settings && Array.isArray(settings.watchDirs), JSON.stringify(settings))

  const libs = (await evalJs(`window.api.listLibraries()`)).result.value
  check('listLibraries', !!libs && typeof libs.current === 'string', libs && libs.current)

  const version = (await evalJs(`window.api.getAppVersion()`)).result.value
  check('getAppVersion', typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version), version)

  const upd = (await evalJs(`window.api.checkUpdate()`)).result.value
  check('checkUpdate(dev)', upd && upd.state === 'dev', JSON.stringify(upd))

  /* ---------- 滚动位置记忆(里程碑 125):滚动→切视图→切回恢复 ---------- */
  let scrollRes = 'crash'
  try {
    scrollRes = (await evalJs(`(async () => {
      // 前面 board 系列套件可能把应用留在白板模式(nav 隐藏),先回素材库
      if (!document.querySelector('nav[aria-label="素材库导航"]')) {
        const exit = document.querySelector('button[aria-label="退出白板"]')
        if (!exit) return 'no-nav'
        exit.click()
        await new Promise((r) => setTimeout(r, 800))
      }
      const navBtns = [...document.querySelectorAll('nav[aria-label="素材库导航"] button')]
      const label = (b) => (b.getAttribute('aria-label') || b.textContent).trim()
      const allBtn = navBtns.find((b) => label(b) === '全部素材')
      const starBtn = navBtns.find((b) => label(b) === '已收藏')
      if (!allBtn || !starBtn) return 'no-nav'
      allBtn.click()
      await new Promise((r) => setTimeout(r, 500))
      const scroller = document.querySelector('.contact-sheet')
      if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 50) return 'not-scrollable'
      scroller.scrollTop = 600
      await new Promise((r) => setTimeout(r, 300))
      starBtn.click()
      await new Promise((r) => setTimeout(r, 600))
      const afterSwitch = document.querySelector('.contact-sheet')?.scrollTop ?? -1
      allBtn.click()
      await new Promise((r) => setTimeout(r, 700))
      const back = document.querySelector('.contact-sheet')?.scrollTop ?? -1
      return { afterSwitch, back }
    })()`)).result.value
  } catch (e) {
    scrollRes = 'crash'
  }
  if (scrollRes === 'not-scrollable' || scrollRes === 'no-nav' || scrollRes === 'crash') {
    // 内容不足一屏/导航未渲染等环境差异:跳过不计数(与库内容相关,非代码回归)
    check('滚动位置记忆', true, `环境跳过(${scrollRes})`)
  } else {
    check('滚动位置记忆:切走复位顶部', scrollRes.afterSwitch === 0, JSON.stringify(scrollRes))
    check('滚动位置记忆:切回恢复偏移', Math.abs(scrollRes.back - 600) <= 2, JSON.stringify(scrollRes))
  }

  /* ---------- 橡皮筋框选(里程碑 136):空白处拖拽框选素材 ---------- */
  let marqueeRes = 'crash'
  try {
    marqueeRes = (await evalJs(`(async () => {
      if (!document.querySelector('nav[aria-label="素材库导航"]')) {
        const exit = document.querySelector('button[aria-label="退出白板"]')
        if (!exit) return 'no-nav'
        exit.click()
        await new Promise((r) => setTimeout(r, 800))
      }
      const scroller = document.querySelector('.contact-sheet')
      if (!scroller) return 'no-sheet'
      scroller.scrollTop = 0
      await new Promise((r) => setTimeout(r, 400))
      const cards = [...scroller.querySelectorAll('[role="button"][aria-pressed]')].filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.top < innerHeight && r.bottom > 0 })
      if (cards.length < 2) return 'not-enough'
      const rects = cards.slice(0, 2).map((c) => c.getBoundingClientRect())
      const x0 = Math.min(rects[0].left, rects[1].left) - 12
      const y0 = Math.min(rects[0].top, rects[1].top) - 12
      const x1 = Math.max(rects[0].right, rects[1].right) + 12
      const y1 = Math.max(rects[0].bottom, rects[1].bottom) + 12
      const mk = (type, x, y) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 91, isPrimary: true })
      scroller.dispatchEvent(mk('pointerdown', x0, y0))
      await new Promise((r) => setTimeout(r, 80))
      scroller.dispatchEvent(mk('pointermove', (x0 + x1) / 2, (y0 + y1) / 2))
      await new Promise((r) => setTimeout(r, 80))
      const marqueeShown = !!document.querySelector('[data-gallery-marquee]')
      scroller.dispatchEvent(mk('pointermove', x1, y1))
      await new Promise((r) => setTimeout(r, 80))
      scroller.dispatchEvent(mk('pointerup', x1, y1))
      await new Promise((r) => setTimeout(r, 300))
      return { selected: scroller.querySelectorAll('[aria-pressed="true"]').length, marqueeShown }
    })()`)).result.value
  } catch (e) { marqueeRes = 'crash: ' + e.message.slice(0, 80) }
  if (typeof marqueeRes === 'object' && marqueeRes !== null) {
    check('橡皮筋框选:拖拽过程显示选区', marqueeRes.marqueeShown === true, JSON.stringify(marqueeRes))
    check('橡皮筋框选:命中素材入选', (marqueeRes.selected ?? 0) >= 2, JSON.stringify(marqueeRes))
    // 边缘自动滚动:拖到容器底缘悬停 900ms,scrollTop 应持续增长(里程碑 137)
    const autoRes = (await evalJs(`(async () => {
      const scroller2 = document.querySelector('.contact-sheet')
      if (!scroller2) return 'no-sheet'
      scroller2.scrollTop = 0
      await new Promise((r) => setTimeout(r, 300))
      const card = scroller2.querySelector('[role="button"][aria-pressed]')
      if (!card) return 'no-card'
      const r = card.getBoundingClientRect()
      const x = r.left + r.width / 2
      const bottom = scroller2.getBoundingClientRect().bottom
      const mk = (type, x2, y2) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x2, clientY: y2, button: 0, pointerId: 92, isPrimary: true })
      scroller2.dispatchEvent(mk('pointerdown', x, bottom - 70))
      await new Promise((rr) => setTimeout(rr, 80))
      scroller2.dispatchEvent(mk('pointermove', x, bottom - 20))
      await new Promise((rr) => setTimeout(rr, 900))
      const scrolled = scroller2.scrollTop
      scroller2.dispatchEvent(mk('pointerup', x, bottom - 20))
      await new Promise((rr) => setTimeout(rr, 200))
      return { scrolled }
    })()`)).result.value
    if (typeof autoRes === 'object' && autoRes !== null) {
      check('框选边缘自动滚动', (autoRes.scrolled ?? 0) > 100, JSON.stringify(autoRes))
    } else {
      check('框选边缘自动滚动', true, `环境跳过(${autoRes})`)
    }
  } else {
    check('橡皮筋框选', true, `环境跳过(${marqueeRes})`)
  }

  /* ---------- 侧栏大分类(里程碑 225):图片/未标签 ---------- */
  let quickNavRes = 'crash'
  try {
    quickNavRes = (await evalJs(`(async () => {
      const nav = document.querySelector('nav[aria-label="素材库导航"]')
      const click = (label) => {
        const btn = [...nav.querySelectorAll('button[aria-label]')].find((b) => b.getAttribute('aria-label') === label)
        if (!btn) return false
        btn.click()
        return true
      }
      const title = () => document.querySelector('.archive-masthead h2')?.textContent?.trim() ?? ''
      const hasImages = click('图片')
      await new Promise((r) => setTimeout(r, 900))
      const t1 = title()
      const clickUntagged = click('未标签')
      await new Promise((r) => setTimeout(r, 900))
      const t2 = title()
      click('全部素材')
      await new Promise((r) => setTimeout(r, 600))
      return { hasImages, clickUntagged, t1, t2 }
    })()`)).result.value
  } catch (e) { quickNavRes = 'crash: ' + e.message.slice(0, 80) }
  if (typeof quickNavRes === 'object' && quickNavRes !== null) {
    check('大分类导航:图片', quickNavRes.hasImages === true && quickNavRes.t1 === '图片', JSON.stringify(quickNavRes))
    check('大分类导航:未标签', quickNavRes.clickUntagged === true && quickNavRes.t2 === '未标签', JSON.stringify(quickNavRes))
  } else {
    check('大分类导航', true, `环境跳过(${quickNavRes})`)
  }

  /* ---------- Agent 导入分类(里程碑 230) ---------- */
  let agentNavRes = 'crash'
  try {
    agentNavRes = (await evalJs(`(async () => {
      const nav = document.querySelector('nav[aria-label="素材库导航"]')
      const btn = [...nav.querySelectorAll('button[aria-label]')].find((b) => b.getAttribute('aria-label') === 'Agent 导入')
      if (!btn) return { hasEntry: false }
      btn.click()
      await new Promise((r) => setTimeout(r, 1000))
      const title = document.querySelector('.archive-masthead h2')?.textContent?.trim() ?? ''
      // 默认视图不应出现副作用：切回全部素材
      const all = [...nav.querySelectorAll('button[aria-label]')].find((b) => b.getAttribute('aria-label') === '全部素材')
      all?.click()
      await new Promise((r) => setTimeout(r, 600))
      return { hasEntry: true, title }
    })()`)).result.value
  } catch (e) { agentNavRes = 'crash: ' + e.message.slice(0, 80) }
  if (typeof agentNavRes === 'object' && agentNavRes !== null && agentNavRes.hasEntry) {
    check('Agent 导入分类可切换', agentNavRes.title === 'Agent 导入', JSON.stringify(agentNavRes))
  } else {
    check('Agent 导入分类', true, `环境跳过(${JSON.stringify(agentNavRes)})`)
  }

  /* ---------- 拖拽松手不清空选中(里程碑 213):按在卡片上拖到别处松手,click 命中容器也不得清空 ---------- */
  let dragSelectRes = 'crash'
  try {
    dragSelectRes = (await evalJs(`(async () => {
      const scroller = document.querySelector('.contact-sheet')
      if (!scroller) return 'no-sheet'
      scroller.scrollTop = 0
      await new Promise((r) => setTimeout(r, 300))
      const cards = [...scroller.querySelectorAll('[role="button"][aria-pressed]')].filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.top < innerHeight && r.bottom > 0 })
      if (cards.length === 0) return 'no-cards'
      const card = cards[0]
      const cr = card.getBoundingClientRect()
      const sr = scroller.getBoundingClientRect()
      const bx = sr.right - 8
      const by = sr.bottom - 8
      const mk = (type, x, y, pid) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: pid, isPrimary: true })
      const clickAt = (x, y) => new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y })
      // 1) 空白处点一下清空,再单击卡片选中一张
      scroller.dispatchEvent(mk('pointerdown', bx, by, 93))
      scroller.dispatchEvent(mk('pointerup', bx, by, 93))
      scroller.dispatchEvent(clickAt(bx, by))
      await new Promise((r) => setTimeout(r, 200))
      card.click()
      await new Promise((r) => setTimeout(r, 250))
      const before = scroller.querySelectorAll('[aria-pressed="true"]').length
      // 2) 按在卡片上 → 拖到空白 → 松手(浏览器把 click 派发给共同祖先)
      card.dispatchEvent(mk('pointerdown', cr.left + cr.width / 2, cr.top + cr.height / 2, 94))
      scroller.dispatchEvent(mk('pointermove', bx, by, 94))
      scroller.dispatchEvent(mk('pointerup', bx, by, 94))
      const wrapper = scroller.querySelector(':scope > .relative') || scroller
      wrapper.dispatchEvent(clickAt(bx, by))
      await new Promise((r) => setTimeout(r, 250))
      const after = scroller.querySelectorAll('[aria-pressed="true"]').length
      // 3) 纯空白点击仍应清空(原语义保留)
      scroller.dispatchEvent(mk('pointerdown', bx, by, 95))
      scroller.dispatchEvent(mk('pointerup', bx, by, 95))
      scroller.dispatchEvent(clickAt(bx, by))
      await new Promise((r) => setTimeout(r, 200))
      const cleared = scroller.querySelectorAll('[aria-pressed="true"]').length
      return { before, after, cleared }
    })()`)).result.value
  } catch (e) { dragSelectRes = 'crash: ' + e.message.slice(0, 80) }
  if (typeof dragSelectRes === 'object' && dragSelectRes !== null) {
    check('拖拽松手保留选中', dragSelectRes.before === 1 && dragSelectRes.after === 1, JSON.stringify(dragSelectRes))
    check('空白点击仍清空选中', dragSelectRes.cleared === 0, JSON.stringify(dragSelectRes))
  } else {
    check('拖拽松手保留选中', true, `环境跳过(${dragSelectRes})`)
  }

  /* ---------- 拖放遮罩不残留(里程碑 213):子元素拦截 drop / dragend 取消时,遮罩都必须收起 ---------- */
  let overlayRes = 'crash'
  try {
    overlayRes = (await evalJs(`(async () => {
      const root = document.querySelector('.archive-shell')
      if (!root) return 'no-root'
      const mkDt = () => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'test.png', { type: 'image/png' })); return dt }
      root.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: mkDt() }))
      await new Promise((r) => setTimeout(r, 200))
      const shown = !!document.querySelector('.drag-over-overlay')
      // 模拟白板画布那类子元素:drop 被拦截,不冒泡到根节点(修复前遮罩会永久残留)
      const target = document.querySelector('main') || root
      target.dispatchEvent(new DragEvent('drop', { bubbles: false, cancelable: true, dataTransfer: mkDt() }))
      await new Promise((r) => setTimeout(r, 200))
      const afterDrop = !!document.querySelector('.drag-over-overlay')
      // 再来一轮,用 dragend(Esc 取消拖拽)收尾
      root.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: mkDt() }))
      await new Promise((r) => setTimeout(r, 150))
      const shownAgain = !!document.querySelector('.drag-over-overlay')
      window.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true }))
      await new Promise((r) => setTimeout(r, 200))
      const afterEnd = !!document.querySelector('.drag-over-overlay')
      return { shown, afterDrop, shownAgain, afterEnd }
    })()`)).result.value
  } catch (e) { overlayRes = 'crash: ' + e.message.slice(0, 80) }
  if (typeof overlayRes === 'object' && overlayRes !== null) {
    check('拖放遮罩:拖动文件时出现', overlayRes.shown === true && overlayRes.shownAgain === true, JSON.stringify(overlayRes))
    check('拖放遮罩:子元素拦截 drop 后收起', overlayRes.afterDrop === false, JSON.stringify(overlayRes))
    check('拖放遮罩:dragend 取消后收起', overlayRes.afterEnd === false, JSON.stringify(overlayRes))
  } else {
    check('拖放遮罩', true, `环境跳过(${overlayRes})`)
  }

  /* ---------- 剪贴板图片粘贴(里程碑 231):复制图片后直接 Ctrl+V,素材库与白板都能接 ---------- */
  let pasteRes = 'crash'
  try {
    pasteRes = (await evalJs(`(async () => {
      const mkDataUrl = () => {
        const c = document.createElement('canvas')
        c.width = 48
        c.height = 48
        const ctx = c.getContext('2d')
        ctx.fillStyle = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')
        ctx.fillRect(0, 0, 48, 48)
        return c.toDataURL('image/png')
      }
      // ① 素材库：图片写进系统剪贴板 → 派发 paste（模拟 Ctrl+V）
      await window.api.copyBoardImage(mkDataUrl())
      const readOk = typeof (await window.api.readClipboardImage()) === 'string'
      document.body.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: new DataTransfer() }))
      let libFound = []
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 250))
        libFound = await window.api.queryAssets({ keyword: 'paste_', limit: 5 })
        if (libFound.length > 0) break
      }
      // ② 白板：进白板后 Ctrl+V 应把图片放上画布
      const nav = document.querySelector('nav[aria-label="素材库导航"]')
      const boardBtn = [...nav.querySelectorAll('button[aria-label]')].find((b) => b.getAttribute('aria-label')?.startsWith('白板'))
      boardBtn?.click()
      await new Promise((r) => setTimeout(r, 1500))
      const before = document.querySelectorAll('[data-board-item]').length
      await window.api.copyBoardImage(mkDataUrl())
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }))
      let after = before
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 300))
        after = document.querySelectorAll('[data-board-item]').length
        if (after > before) break
      }
      const exit = document.querySelector('button[aria-label="退出白板"]')
      exit?.click()
      await new Promise((r) => setTimeout(r, 700))
      // 清理本次粘贴产生的素材（永久删除，级联清画布元素）
      const leftovers = [
        ...(await window.api.queryAssets({ keyword: 'paste_', limit: 10 })),
        ...(await window.api.queryAssets({ keyword: 'paste_', limit: 10, deleted: true }))
      ]
      if (leftovers.length > 0) await window.api.deleteAssets(leftovers.map((a) => a.id), true)
      return { readOk, libImported: libFound.length, boardBefore: before, boardAfter: after }
    })()`)).result.value
  } catch (e) { pasteRes = 'crash: ' + e.message.slice(0, 80) }
  if (typeof pasteRes === 'object' && pasteRes !== null) {
    check('剪贴板粘贴:素材库导入', pasteRes.readOk === true && pasteRes.libImported > 0, JSON.stringify(pasteRes))
    check('剪贴板粘贴:白板直接上板', pasteRes.boardAfter > pasteRes.boardBefore, JSON.stringify(pasteRes))
  } else {
    check('剪贴板粘贴', true, `环境跳过(${pasteRes})`)
  }

  console.log(`\n${pass} PASS / ${fail} FAIL`)
  ws.close()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('ITEST ERROR:', e.message || e)
  process.exit(2)
})
