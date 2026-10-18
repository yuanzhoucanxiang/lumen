/* 里程碑 197：预览信息面板 + 缩放控制。
   前置：npm run dev -- --remote-debugging-port=9333 */
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
  const key = async (k, code, vk) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
  }

  let pass = 0
  let fail = 0
  const check = (name, ok, detail) => {
    console.log(ok ? '  PASS' : '  FAIL', name, '—', detail)
    ok ? pass++ : fail++
  }

  await send('Page.bringToFront')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await run(`localStorage.setItem('lumen.theme', 'silver-gelatin'); location.reload(); return true`)
  await sleep(3500)
  await send('Page.bringToFront')

  await run(`
    const nav = document.querySelector('nav[aria-label="素材库导航"]')
    const all = nav && [...nav.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '全部素材')
    if (all) all.click()
    await new Promise((r) => setTimeout(r, 500))
    const card = document.querySelector('.asset-card')
    if (!card) throw new Error('素材库为空')
    card.closest('[tabindex="0"]')?.focus()
    card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 900))
    return true
  `)

  const opened = await run(`
    const dialog = document.querySelector('[role="dialog"][aria-label^="预览"]')
    return {
      preview: !!dialog,
      infoBtn: !!document.querySelector('button[aria-label="显示/隐藏素材信息"]'),
      zoomMinus: !!document.querySelector('button[aria-label="缩小"]'),
      zoomPlus: !!document.querySelector('button[aria-label="放大"]'),
      fit: !!document.querySelector('button[aria-label="适应窗口"]'),
      one: !!document.querySelector('button[aria-label="100% 像素显示"]')
    }
  `)
  check('预览带信息/缩放控制', opened.preview && opened.infoBtn && opened.zoomMinus && opened.zoomPlus && opened.fit && opened.one, JSON.stringify(opened))

  const info = await run(`
    document.querySelector('button[aria-label="显示/隐藏素材信息"]').click()
    await new Promise((r) => setTimeout(r, 350))
    const panel = document.querySelector('[aria-label="素材信息"]')
    return {
      open: !!panel,
      text: panel ? panel.innerText : '',
      pressed: document.querySelector('button[aria-label="显示/隐藏素材信息"]')?.getAttribute('aria-pressed'),
      right: panel ? Math.round(panel.getBoundingClientRect().right) : 0,
      innerW: innerWidth
    }
  `)
  check(
    '信息面板显示素材元数据',
    info.open &&
      info.pressed === 'true' &&
      info.right === info.innerW &&
      info.text.includes('格式') &&
      info.text.includes('导入时间') &&
      info.text.includes('所在文件夹'),
    JSON.stringify({ open: info.open, right: info.right, innerW: info.innerW, sample: info.text.slice(0, 120) })
  )

  const zoomed = await run(`
    const plus = document.querySelector('button[aria-label="放大"]')
    plus.click(); plus.click()
    await new Promise((r) => setTimeout(r, 250))
    const pct = document.querySelector('button[aria-label="放大"]').parentElement.querySelector('.tnum')?.textContent?.trim()
    return { pct, plusDisabled: plus.disabled }
  `)
  check('放大按钮提升缩放百分比', parseInt(zoomed.pct || '0', 10) > 100, JSON.stringify(zoomed))

  const fitted = await run(`
    document.querySelector('button[aria-label="适应窗口"]').click()
    await new Promise((r) => setTimeout(r, 200))
    const pct = document.querySelector('button[aria-label="放大"]').parentElement.querySelector('.tnum')?.textContent?.trim()
    return { pct }
  `)
  check('适应窗口复位 100%', fitted.pct === '100%', JSON.stringify(fitted))

  await key('i', 'KeyI', 73)
  await sleep(250)
  const toggled = await run(`return { open: !!document.querySelector('[aria-label="素材信息"]') }`)
  check('i 键关闭信息面板', !toggled.open, JSON.stringify(toggled))

  await key('Escape', 'Escape', 27)
  await sleep(350)
  const closed = await run(`return { preview: !!document.querySelector('[role="dialog"][aria-label^="预览"]') }`)
  check('Esc 关闭预览', !closed.preview, JSON.stringify(closed))

  await send('Emulation.clearDeviceMetricsOverride')
  await sleep(300)
  ws.close()
  console.log(`\n${pass} PASS / ${fail} FAIL`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('TEST CRASH:', e.message)
  process.exit(1)
})
