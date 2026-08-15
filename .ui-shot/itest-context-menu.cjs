/* 素材右键菜单边界专项：两主题下验证一级菜单与文件夹二级菜单四向防越界。 */
const WebSocket = require('ws')
const http = require('http')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const getJson = (url) => new Promise((resolve, reject) => {
  http.get(url, (response) => {
    let data = ''
    response.on('data', (chunk) => (data += chunk))
    response.on('end', () => resolve(JSON.parse(data)))
  }).on('error', reject)
})

async function main() {
  const targets = await getJson('http://127.0.0.1:9333/json/list')
  const page = targets.find((target) => target.type === 'page' && target.url.includes('localhost:5173') && !target.url.includes('floating'))
  if (!page) throw new Error('找不到主窗口页面')
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false })
  await new Promise((resolve, reject) => {
    ws.on('open', resolve)
    ws.on('error', reject)
  })
  let id = 0
  const pending = new Map()
  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString())
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
    }
  })
  const evaluate = (expression) => new Promise((resolve, reject) => {
    const messageId = ++id
    pending.set(messageId, (message) => message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result))
    ws.send(JSON.stringify({ id: messageId, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
  })
  const run = async (source) => {
    const result = await evaluate(`(async () => { ${source} })()`)
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }

  let pass = 0
  let fail = 0
  const check = (name, ok, detail = '') => {
    console.log(ok ? '  PASS' : '  FAIL', name, '—', detail)
    if (ok) pass++
    else fail++
  }
  const inspectMenus = () => `return (() => {
    const main = document.querySelector('[data-asset-context-menu]')
    const sub = document.querySelector('[data-folder-submenu]')
    const mr = main?.getBoundingClientRect()
    const sr = sub?.getBoundingClientRect()
    const visible = sub && getComputedStyle(sub).display !== 'none'
    const inside = (r) => !!r && r.left >= 6 && r.top >= 6 && r.right <= innerWidth - 6 && r.bottom <= innerHeight - 6
    return {
      mainRoot: main?.parentElement === document.body,
      mainInside: inside(mr),
      subVisible: !!visible,
      subInside: visible ? inside(sr) : false,
      x: sub?.dataset.placementX,
      y: sub?.dataset.placementY,
      viewport: [innerWidth, innerHeight],
      mainStyle: main ? [main.style.left, main.style.top, main.offsetWidth, main.offsetHeight] : null,
      main: mr ? [Math.round(mr.left), Math.round(mr.top), Math.round(mr.right), Math.round(mr.bottom)] : null,
      sub: sr ? [Math.round(sr.left), Math.round(sr.top), Math.round(sr.right), Math.round(sr.bottom)] : null
    }
  })()`
  const openAt = async (xExpr, yExpr) => {
    await run(`(() => {
      const card = document.querySelector('.contact-sheet [role="button"]')
      if (!card) throw new Error('无可测试素材卡片')
      card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: ${xExpr}, clientY: ${yExpr} }))
    })()`)
    await sleep(220)
    await run(`(() => {
      const trigger = [...document.querySelectorAll('[data-asset-context-menu] button')].find((button) => button.textContent.includes('添加到文件夹'))
      if (!trigger) throw new Error('无文件夹二级菜单')
      trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null }))
    })()`)
    await sleep(100)
    return run(inspectMenus())
  }
  const closeMenu = async () => {
    await run(`(() => {
      const backdrop = [...document.body.children].find((node) => node.classList?.contains('z-[290]'))
      if (backdrop) backdrop.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })()`)
    await sleep(80)
  }

  for (const theme of ['silver-gelatin', 'pixel-glitch']) {
    await run(`localStorage.setItem('lumen.theme', '${theme}'); location.reload()`)
    let ready = false
    for (let i = 0; i < 60; i++) {
      await sleep(200)
      ready = await run(`return !!document.querySelector('.contact-sheet [role="button"]')`)
      if (ready) break
    }
    check(`${theme} 素材墙加载`, ready)

    const rightBottom = await openAt('innerWidth - 2', 'innerHeight - 2')
    check(`${theme} 右下一级菜单根层且不越界`, rightBottom.mainRoot && rightBottom.mainInside, JSON.stringify(rightBottom))
    check(`${theme} 右侧二级菜单自动向左`, rightBottom.subVisible && rightBottom.x === 'left', JSON.stringify(rightBottom))
    check(`${theme} 右下二级菜单完整留在视口`, rightBottom.subInside, JSON.stringify(rightBottom))
    check(`${theme} 底部二级菜单自动向上`, rightBottom.y === 'up', JSON.stringify(rightBottom))
    await closeMenu()

    const leftTop = await openAt("document.querySelector('.contact-sheet').getBoundingClientRect().left + 12", "document.querySelector('.contact-sheet').getBoundingClientRect().top + 12")
    check(`${theme} 左上一级菜单不越界`, leftTop.mainRoot && leftTop.mainInside, JSON.stringify(leftTop))
    check(`${theme} 左侧二级菜单自动向右`, leftTop.subVisible && leftTop.x === 'right', JSON.stringify(leftTop))
    check(`${theme} 左上二级菜单完整留在视口`, leftTop.subInside, JSON.stringify(leftTop))
    await closeMenu()
  }

  await run(`localStorage.setItem('lumen.theme', 'silver-gelatin'); location.reload()`)
  console.log(`\n${pass} PASS / ${fail} FAIL`)
  ws.close()
  process.exit(fail ? 1 : 0)
}

main().catch((error) => {
  console.error('TEST CRASH:', error.message)
  process.exit(1)
})
