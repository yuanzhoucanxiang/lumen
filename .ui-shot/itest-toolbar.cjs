/* 顶栏全控件专项回归：两主题下验证弹层根层定位、筛选、搜索、重复检测、布局与缩放。 */
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
    pending.set(messageId, (message) => {
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolve(message.result)
    })
    ws.send(JSON.stringify({
      id: messageId,
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true }
    }))
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
  const byLabel = (label) => `[...document.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === '${label}')`
  const closePopover = async () => {
    await run(`(() => {
      const backdrop = [...document.body.children].find((node) => node.classList?.contains('z-[150]'))
      if (backdrop) backdrop.click()
    })()`)
    await sleep(80)
  }
  const openAndMeasure = async (label) => {
    await run(`(${byLabel(label)}).click()`)
    await sleep(120)
    return run(`return (() => {
      const menu = document.querySelector('body > .menu')
      const toolbar = document.querySelector('.archive-filterbar')
      if (!menu || !toolbar) return { exists: false }
      const rect = menu.getBoundingClientRect()
      const toolbarRect = toolbar.getBoundingClientRect()
      return {
        exists: true,
        root: menu.parentElement === document.body,
        below: rect.top >= toolbarRect.bottom,
        within: rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
        top: Math.round(rect.top),
        toolbarBottom: Math.round(toolbarRect.bottom)
      }
    })()`)
  }

  for (const theme of ['silver-gelatin', 'pixel-glitch']) {
    await run(`localStorage.setItem('lumen.theme', '${theme}'); location.reload()`)
    let ready = false
    for (let i = 0; i < 50; i++) {
      await sleep(200)
      ready = await run(`return !!document.querySelector('.archive-filterbar')`)
      if (ready) break
    }
    check(`${theme} 顶栏加载`, ready)

    const searchSpacing = await run(`return (() => {
      const input = document.querySelector('input[aria-label="搜索素材"]')
      const icon = input?.parentElement?.querySelector('svg')
      if (!input || !icon) return null
      const inputRect = input.getBoundingClientRect()
      const iconRect = icon.getBoundingClientRect()
      const textStart = inputRect.left + parseFloat(getComputedStyle(input).paddingLeft)
      return { gap: Math.round(textStart - iconRect.right), paddingLeft: Math.round(textStart - inputRect.left) }
    })()`)
    check(`${theme} 搜索图标与文字留白`, searchSpacing?.gap >= 10 && searchSpacing?.paddingLeft >= 34, JSON.stringify(searchSpacing))

    const duplicateIcon = await run(`return (() => {
      const button = ${byLabel('扫描相似或重复图片')}
      const svg = button?.querySelector('svg')
      return { title: button?.getAttribute('title'), width: Number(svg?.getAttribute('width')), parts: svg?.children.length }
    })()`)
    check(`${theme} 重复检查专用图标`, duplicateIcon.title === '重复素材检查' && duplicateIcon.width >= 17 && duplicateIcon.parts >= 4, JSON.stringify(duplicateIcon))

    const format = await openAndMeasure('按格式筛选')
    check(`${theme} 格式弹层可见`, format.exists && format.root && format.below && format.within, JSON.stringify(format))
    await run(`(() => {
      const menu = document.querySelector('body > .menu')
      const png = [...menu.querySelectorAll('button')].find((button) => button.textContent.trim() === 'PNG')
      png.click()
    })()`)
    await sleep(120)
    check(`${theme} 格式筛选生效`, await run(`return (${byLabel('按格式筛选')}).getAttribute('aria-pressed') === 'true'`))
    await run(`(() => {
      const clear = [...document.querySelectorAll('body > .menu button')].find((button) => button.textContent.includes('清除格式'))
      if (clear) clear.click()
    })()`)
    await closePopover()

    const color = await openAndMeasure('按颜色筛选')
    check(`${theme} 颜色弹层可见`, color.exists && color.root && color.below && color.within, JSON.stringify(color))
    await run(`document.querySelector('body > .menu button[aria-label^="筛选颜色"]').click()`)
    await sleep(120)
    check(`${theme} 颜色筛选生效`, await run(`return (${byLabel('按颜色筛选')}).getAttribute('aria-pressed') === 'true'`))
    await run(`(() => {
      const clear = [...document.querySelectorAll('body > .menu button')].find((button) => button.textContent.includes('清除颜色'))
      if (clear) clear.click()
    })()`)
    await closePopover()

    const untaggedBefore = await run(`return (${byLabel('只看未打标签的素材')}).getAttribute('aria-pressed')`)
    await run(`(${byLabel('只看未打标签的素材')}).click()`)
    await sleep(80)
    const untaggedAfter = await run(`return (${byLabel('只看未打标签的素材')}).getAttribute('aria-pressed')`)
    check(`${theme} 未标筛选切换`, untaggedBefore !== untaggedAfter, `${untaggedBefore}→${untaggedAfter}`)
    await run(`(${byLabel('只看未打标签的素材')}).click()`)

    const date = await openAndMeasure('按导入时间筛选')
    check(`${theme} 日期弹层可见`, date.exists && date.root && date.below && date.within, JSON.stringify(date))
    await run(`(() => {
      const item = [...document.querySelectorAll('body > .menu button')].find((button) => button.textContent.trim() === '近 7 天')
      item.click()
    })()`)
    await sleep(100)
    check(`${theme} 日期筛选生效`, await run(`return (${byLabel('按导入时间筛选')}).textContent.includes('7天')`))
    await run(`(${byLabel('按导入时间筛选')}).click()`)
    await sleep(80)
    await run(`(() => {
      const item = [...document.querySelectorAll('body > .menu button')].find((button) => button.textContent.trim() === '不限')
      item.click()
    })()`)

    const sort = await openAndMeasure('排序方式')
    check(`${theme} 排序弹层可见`, sort.exists && sort.root && sort.below && sort.within, JSON.stringify(sort))
    await run(`(() => {
      const item = [...document.querySelectorAll('body > .menu button')].find((button) => button.textContent.trim() === '名称')
      item.click()
    })()`)
    await sleep(100)
    check(`${theme} 排序切换生效`, await run(`return (${byLabel('排序方式')}).textContent.includes('名称')`))
    await run(`(${byLabel('排序方式')}).click()`)
    await sleep(80)
    await run(`(() => {
      const item = [...document.querySelectorAll('body > .menu button')].find((button) => button.textContent.trim() === '导入时间')
      item.click()
    })()`)

    const starBefore = await run(`return (${byLabel('按星级筛选')}).getAttribute('aria-pressed')`)
    await run(`(${byLabel('按星级筛选')}).click()`)
    await sleep(80)
    const starAfter = await run(`return (${byLabel('按星级筛选')}).getAttribute('aria-pressed')`)
    check(`${theme} 星标筛选切换`, starBefore !== starAfter, `${starBefore}→${starAfter}`)
    await run(`(${byLabel('按星级筛选')}).click()`)

    await run(`(${byLabel('AI 智能搜索')}).click()`)
    await sleep(100)
    check(`${theme} AI 搜索模式切换`, await run(`return !!document.querySelector('input[aria-label="AI 智能搜索"]')`))
    await run(`(${byLabel('退出 AI 搜索')}).click()`)

    const searchValue = `toolbar-${theme}`
    await run(`(() => {
      const input = document.querySelector('input[aria-label="搜索素材"]')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, '${searchValue}')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    await sleep(100)
    check(`${theme} 普通搜索输入`, await run(`return document.querySelector('input[aria-label="搜索素材"]').value === '${searchValue}'`))
    await run(`(() => {
      const input = document.querySelector('input[aria-label="搜索素材"]')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)

    await run(`(${byLabel('扫描相似或重复图片')}).click()`)
    await sleep(160)
    const dupe = await run(`return (() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="重复素材检测"]')
      return { exists: !!dialog, root: dialog?.parentElement?.parentElement === document.body }
    })()`)
    check(`${theme} 重复检测模态框可见`, dupe.exists && dupe.root, JSON.stringify(dupe))
    await run(`document.querySelector('[role="dialog"][aria-label="重复素材检测"] button[aria-label="关闭"]').click()`)

    await run(`(${byLabel('回收站')}).click()`)
    await sleep(120)
    await run(`(${byLabel('清空回收站')}).click()`)
    await sleep(100)
    const confirm = await run(`return (() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="清空回收站？"]')
      return { exists: !!dialog, root: dialog?.parentElement?.parentElement === document.body }
    })()`)
    check(`${theme} 顶栏确认框可见`, confirm.exists && confirm.root, JSON.stringify(confirm))
    await run(`(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="清空回收站？"]')
      const cancel = [...dialog.querySelectorAll('button')].find((button) => button.textContent.trim() === '取消')
      cancel.click()
    })()`)
    await run(`(${byLabel('全部素材')}).click()`)
    await sleep(100)

    const currentLayout = await run(`return document.querySelector('[role="group"][aria-label="布局切换"] button[aria-pressed="true"]').getAttribute('aria-label')`)
    const nextLayout = currentLayout === '网格' ? '瀑布流' : '网格'
    await run(`(${byLabel(nextLayout)}).click()`)
    await sleep(80)
    check(`${theme} 布局切换`, await run(`return (${byLabel(nextLayout)}).getAttribute('aria-pressed') === 'true'`), `${currentLayout}→${nextLayout}`)
    await run(`(${byLabel(currentLayout)}).click()`)

    const zoom = await run(`return Number(document.querySelector('input[aria-label="缩略图大小"]').value)`)
    const nextZoom = zoom === 6 ? 5 : zoom + 1
    await run(`(() => {
      const input = document.querySelector('input[aria-label="缩略图大小"]')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, '${nextZoom}')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    await sleep(80)
    check(`${theme} 缩略图大小切换`, await run(`return Number(document.querySelector('input[aria-label="缩略图大小"]').value) === ${nextZoom}`), `${zoom}→${nextZoom}`)
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
