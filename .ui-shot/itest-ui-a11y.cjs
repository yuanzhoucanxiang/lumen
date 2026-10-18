/* 里程碑 194：可访问性专项（对比度 / reduced-motion / 弹窗焦点陷阱与恢复）。
   前置：npm run dev -- --remote-debugging-port=9333（或 node scripts/itest.cjs --only ui-a11y） */
const WebSocket = require('ws')
const http = require('http')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function getJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve(JSON.parse(body)))
      })
      .on('error', reject)
  })
}

function lum(hex) {
  const c = hex.replace('#', '')
  const v = [0, 2, 4]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)))
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
}

function contrast(fg, bg) {
  const a = lum(fg)
  const b = lum(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

async function main() {
  const targets = await getJson('http://127.0.0.1:9333/json/list')
  const page = targets.find((t) => t.type === 'page' && !t.url.includes('floating'))
  if (!page) throw new Error('找不到主渲染进程页面')
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false })
  await new Promise((resolve, reject) => {
    ws.on('open', resolve)
    ws.on('error', reject)
  })

  let nextId = 0
  const pending = new Map()
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString())
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  })
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
  const run = (expr) =>
    send('Runtime.evaluate', {
      expression: `(async () => { ${expr} })()`,
      awaitPromise: true,
      returnByValue: true
    }).then((r) => {
      const payload = r.result
      if (payload?.exceptionDetails) {
        throw new Error('EVAL: ' + (payload.exceptionDetails.exception?.description || payload.exceptionDetails.text))
      }
      return payload?.result?.value
    })
  const key = async (k, code, vk, modifiers = 0) => {
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: k,
      code,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
      modifiers
    })
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: k,
      code,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
      modifiers
    })
  }

  let pass = 0
  let fail = 0
  const check = (name, ok, detail) => {
    console.log(ok ? '  PASS' : '  FAIL', name, '—', detail)
    ok ? pass++ : fail++
  }

  const dialogInfo = () =>
    run(`
      const dialogs = [...document.querySelectorAll('[role="dialog"]')]
      const dialog = dialogs[dialogs.length - 1] || null
      const active = document.activeElement
      return {
        dialog: dialog ? dialog.getAttribute('aria-label') : null,
        tabindex: dialog ? dialog.getAttribute('tabindex') : null,
        active: active ? { tag: active.tagName, label: active.getAttribute?.('aria-label') || null } : null,
        inside: !!(dialog && active && dialog.contains(active))
      }
    `)

  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  })
  await sleep(400)

  // 套件隔离：前序套件可能留下全局 keydown 监听/旧弹窗/白板模式，重载一次回到干净启动态
  await run(`localStorage.setItem('lumen.theme', 'silver-gelatin'); location.reload(); return true`)
  await sleep(3500)
  await send('Page.bringToFront')

  // 关掉可能残留的弹层
  await run(`
    const close = document.querySelector('button[aria-label="关闭设置与帮助"]')
    if (close) close.click()
    const closePreview = document.querySelector('button[aria-label="关闭预览"]')
    if (closePreview) closePreview.click()
    await new Promise((r) => setTimeout(r, 300))
    return true
  `)

  /* ---------- 设置弹窗：焦点陷阱 + Esc 关闭 + 焦点恢复 ---------- */
  await run(`
    const btn = document.querySelector('button[aria-label^="打开设置"]')
    if (!btn) throw new Error('找不到设置按钮')
    btn.focus()
    btn.click()
    await new Promise((r) => setTimeout(r, 1200))
    return true
  `)
  let info = await dialogInfo()
  check('设置弹窗挂载焦点陷阱', info.dialog === '设置与帮助' && info.tabindex === '-1' && info.inside, JSON.stringify(info))
  let allInside = info.inside
  for (let i = 0; i < 6; i++) {
    await key('Tab', 'Tab', 9)
    await sleep(70)
    info = await dialogInfo()
    allInside = allInside && info.inside
  }
  check('Tab 连续 6 次不逃出设置弹窗', allInside, JSON.stringify(info))
  await key('Tab', 'Tab', 9, 8) // Shift+Tab
  await sleep(70)
  info = await dialogInfo()
  check('Shift+Tab 仍在设置弹窗内', info.inside, JSON.stringify(info))
  await key('Escape', 'Escape', 27)
  await sleep(450)
  const closed = await run(`
    const dialogs = [...document.querySelectorAll('[role="dialog"]')]
    return {
      gone: !dialogs.some((d) => d.getAttribute('aria-label') === '设置与帮助'),
      focus: document.activeElement?.getAttribute?.('aria-label') || ''
    }
  `)
  check('Esc 关闭设置', closed.gone, JSON.stringify(closed))
  check('关闭后焦点回到设置按钮', closed.focus.startsWith('打开设置'), closed.focus)

  /* ---------- 预览：自动聚焦关闭键 + Esc 关闭 + 焦点还原 ---------- */
  const preview = await run(`
    const card = document.querySelector('.asset-card')
    const focusable = card?.closest('[tabindex="0"]')
    if (!card || !focusable) throw new Error('素材库为空，无法测试预览焦点')
    focusable.focus()
    const before = focusable.getAttribute('aria-label')
    card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 800))
    const dialogs = [...document.querySelectorAll('[role="dialog"]')]
    const dialog = dialogs[dialogs.length - 1]
    const active = document.activeElement
    return {
      before,
      dialog: dialog?.getAttribute('aria-label') || null,
      active: active?.getAttribute?.('aria-label') || null,
      inside: !!(dialog && active && dialog.contains(active))
    }
  `)
  check(
    '预览自动聚焦关闭按钮',
    preview.dialog?.startsWith('预览') && preview.active === '关闭预览' && preview.inside,
    JSON.stringify(preview)
  )
  await key('Escape', 'Escape', 27)
  await sleep(450)
  const previewClosed = await run(`
    return {
      gone: ![...document.querySelectorAll('[role="dialog"]')].some((d) => (d.getAttribute('aria-label') || '').startsWith('预览')),
      focus: document.activeElement?.getAttribute?.('aria-label') || ''
    }
  `)
  check('Esc 关闭预览', previewClosed.gone, JSON.stringify(previewClosed))
  check('预览关闭后焦点回到素材卡', previewClosed.focus === preview.before, `${previewClosed.focus} vs ${preview.before}`)

  /* ---------- 对比度：三主题 text-faint 对 panel/base ---------- */
  await run(`
    const btn = document.querySelector('button[aria-label^="打开设置"]')
    btn.focus()
    btn.click()
    await new Promise((r) => setTimeout(r, 1200))
    return true
  `)
  const themes = ['silver-gelatin', 'pixel-glitch', 'cyber-glitch']
  for (let i = 0; i < themes.length; i++) {
    const token = await run(`
      document.querySelectorAll('.theme-choice')[${i}]?.click()
      await new Promise((r) => setTimeout(r, 350))
      const cs = getComputedStyle(document.documentElement)
      const trim = (v) => v.trim()
      return {
        theme: document.documentElement.dataset.theme,
        faint: trim(cs.getPropertyValue('--text-faint')),
        panel: trim(cs.getPropertyValue('--bg-panel')),
        base: trim(cs.getPropertyValue('--bg-base'))
      }
    `)
    const ratioPanel = contrast(token.faint, token.panel)
    const ratioBase = contrast(token.faint, token.base)
    check(
      `${themes[i]} text-faint ≥ 4.5:1`,
      ratioPanel >= 4.5 && ratioBase >= 4.5,
      `${token.faint} on ${token.panel}=${ratioPanel.toFixed(2)} / ${token.base}=${ratioBase.toFixed(2)}`
    )
  }

  /* ---------- reduced-motion：toast 立即显示最终文本且读屏只读稳定文本 ---------- */
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  })
  await run(`
    document.querySelectorAll('.theme-choice')[0]?.click()
    await new Promise((r) => setTimeout(r, 60))
    return true
  `)
  const toast = await run(`
    const toast = document.querySelector('.anim-toast')
    return {
      visual: toast?.querySelector('span[aria-hidden="true"]')?.textContent || '',
      sr: toast?.querySelector('.sr-only')?.textContent || ''
    }
  `)
  check(
    'reduced-motion 下 toast 无乱码且稳定文本一致',
    toast.visual.length > 0 && toast.visual === toast.sr && toast.visual.includes('已切换'),
    JSON.stringify(toast)
  )
  await send('Emulation.setEmulatedMedia', { features: [] })

  // 恢复默认主题并关闭设置
  await run(`
    document.querySelectorAll('.theme-choice')[0]?.click()
    await new Promise((r) => setTimeout(r, 250))
    const close = document.querySelector('button[aria-label="关闭设置与帮助"]')
    if (close) close.click()
    return true
  `)

  /* ---------- 顶栏确认框：焦点陷阱 + Esc 只关自己 + 焦点恢复 ---------- */
  await run(`
    const nav = document.querySelector('nav[aria-label="素材库导航"]')
    const trash = nav && [...nav.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '回收站')
    if (!trash) throw new Error('找不到回收站入口')
    trash.focus()
    trash.click()
    await new Promise((r) => setTimeout(r, 700))
    const clear = document.querySelector('button[aria-label="清空回收站"]')
    if (!clear) throw new Error('回收站清空按钮未渲染')
    clear.focus()
    clear.click()
    await new Promise((r) => setTimeout(r, 500))
    return true
  `)
  info = await dialogInfo()
  check(
    '确认框挂载焦点陷阱',
    info.dialog === '清空回收站？' && info.tabindex === '-1' && info.inside,
    JSON.stringify(info)
  )
  await key('Escape', 'Escape', 27)
  await sleep(400)
  const confirmClosed = await run(`
    const dialogs = [...document.querySelectorAll('[role="dialog"]')]
    return {
      gone: !dialogs.some((d) => d.getAttribute('aria-label') === '清空回收站？'),
      focus: document.activeElement?.getAttribute?.('aria-label') || ''
    }
  `)
  check('确认框 Esc 关闭且焦点回到清空按钮', confirmClosed.gone && confirmClosed.focus === '清空回收站', JSON.stringify(confirmClosed))
  await run(`
    const nav = document.querySelector('nav[aria-label="素材库导航"]')
    const all = nav && [...nav.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '全部素材')
    if (all) all.click()
    return true
  `)

  await send('Emulation.clearDeviceMetricsOverride')
  await sleep(300)

  ws.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => {
  console.error('TEST CRASH:', e.message)
  process.exit(1)
})
