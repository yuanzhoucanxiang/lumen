/* 设置内置使用说明专项回归：双主题、比例、章节、搜索与滚动。前置：CDP 9333。 */
const WebSocket = require('ws')
const http = require('http')
const fs = require('fs')

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
  const captureScreenshot = () => new Promise((resolve, reject) => {
    const messageId = ++id
    pending.set(messageId, (message) => {
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolve(message.result.data)
    })
    ws.send(JSON.stringify({ id: messageId, method: 'Page.captureScreenshot', params: { format: 'png' } }))
  })

  let pass = 0
  let fail = 0
  const check = (name, ok, detail = '') => {
    console.log(ok ? '  PASS' : '  FAIL', name, '—', detail)
    if (ok) pass++
    else fail++
  }

  const setSearch = async (value) => {
    await run(`(() => {
      const input = document.querySelector('.guide-search input')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, ${JSON.stringify(value)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    await sleep(180)
  }

  for (const theme of ['silver-gelatin', 'pixel-glitch', 'cyber-glitch']) {
    await run(`localStorage.setItem('lumen.theme', '${theme}'); location.reload()`)
    let ready = false
    for (let i = 0; i < 40; i++) {
      await sleep(150)
      ready = await run(`return !!document.querySelector('button[title="设置"]')`)
      if (ready) break
    }
    check(`${theme} 主界面加载`, ready)

    await run(`document.querySelector('button[title="设置"]').click()`)
    await sleep(180)
    const hub = await run(`return (() => {
      const el = document.querySelector('.settings-hub')
      const rect = el?.getBoundingClientRect()
      const prefs = document.querySelector('.settings-preferences')
      return {
        exists: !!el,
        fits: !!rect && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
        width: Math.round(rect?.width || 0),
        height: Math.round(rect?.height || 0),
        navCount: document.querySelectorAll('.settings-hub__nav > button').length,
        prefsScrollable: !!prefs && prefs.scrollHeight > prefs.clientHeight,
        hasTheme: !!document.querySelector('.theme-settings'),
        hasAi: [...document.querySelectorAll('.settings-preferences .section-title')].some((el) => el.textContent === 'AI 智能处理')
      }
    })()`)
    check(`${theme} 设置中心不越界`, hub.exists && hub.fits && hub.width >= 780 && hub.height >= 560, JSON.stringify(hub))
    check(`${theme} 偏好设置完整`, hub.navCount === 2 && hub.prefsScrollable && hub.hasTheme && hub.hasAi)

    // AI 优先标签选择器：三主题断言区块渲染；首个主题做真实勾选/取消 IPC 链路（结束后恢复原状）
    const aiPriority = await run(`return (() => {
      const pool = document.querySelector('.ai-priority-pool')
      const search = document.querySelector('input[aria-label="搜索AI优先标签"]')
      const label = [...document.querySelectorAll('.settings-preferences label')].find((el) => el.textContent.includes('AI 优先标签'))
      return { pool: !!pool, search: !!search, label: !!label, chips: document.querySelectorAll('.ai-priority-chip').length }
    })()`)
    check(`${theme} AI 优先标签选择器渲染`, aiPriority.pool && aiPriority.search && aiPriority.label, JSON.stringify(aiPriority))

    if (theme === 'silver-gelatin') {
      const pick = await run(`{
        const tags = await window.api.listTags()
        const target = tags.find((t) => t.priority === 0)
        return target ? { id: target.id, name: target.name } : null
      }`)
      if (pick) {
        await run(`{
          const input = document.querySelector('input[aria-label="搜索AI优先标签"]')
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
          setter.call(input, ${JSON.stringify(pick.name)})
          input.dispatchEvent(new Event('input', { bubbles: true }))
        }`)
        await sleep(150)
        const clicked = await run(`{
          const option = [...document.querySelectorAll('.ai-priority-option')].find(
            (button) => button.querySelector('span')?.textContent === ${JSON.stringify(pick.name)}
          )
          if (!option) return false
          option.click()
          return true
        }`)
        check(`${theme} 点选加入优先标签`, clicked, pick.name)
        await sleep(250)
        const afterAdd = await run(`{
          const tags = await window.api.listTags()
          const tag = tags.find((t) => t.id === ${pick.id})
          const chip = [...document.querySelectorAll('.ai-priority-chip')].some((c) => c.textContent.includes(${JSON.stringify(pick.name)}))
          return { priority: tag?.priority, chip }
        }`)
        check(`${theme} 勾选后落库 priority=1 且出现 chip`, afterAdd.priority === 1 && afterAdd.chip, JSON.stringify(afterAdd))
        await run(`{
          const button = document.querySelector('button[aria-label="移出优先标签 ${pick.name}"]')
          if (button) button.click()
        }`)
        await sleep(250)
        const afterRemove = await run(`{
          const tags = await window.api.listTags()
          return tags.find((t) => t.id === ${pick.id})?.priority
        }`)
        check(`${theme} 取消后 priority 回 0`, afterRemove === 0, String(afterRemove))
        await run(`{
          const input = document.querySelector('input[aria-label="搜索AI优先标签"]')
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
          setter.call(input, '')
          input.dispatchEvent(new Event('input', { bubbles: true }))
        }`)
      } else {
        check(`${theme} 优先标签勾选链路(无可选标签跳过)`, true)
      }
    }

    await run(`([...document.querySelectorAll('.settings-hub__nav > button')].find((button) => button.textContent.includes('使用说明'))).click()`)
    await sleep(150)
    const guide = await run(`return (() => {
      const layout = document.querySelector('.guide-layout')
      const reader = document.querySelector('.guide-reader')
      return {
        exists: !!layout,
        chapters: document.querySelectorAll('.guide-index__nav button').length,
        firstTitle: document.querySelector('.guide-article__header h3')?.textContent,
        noXOverflow: !!layout && layout.scrollWidth <= layout.clientWidth,
        readerScrollable: !!reader && reader.scrollHeight > reader.clientHeight,
        offline: document.querySelector('.settings-hub__footer')?.textContent.includes('OFFLINE'),
        theme: document.documentElement.dataset.theme
      }
    })()`)
    check(`${theme} 九章教程渲染`, guide.exists && guide.chapters === 9 && guide.firstTitle === '第一次使用', JSON.stringify(guide))
    check(`${theme} 教程比例与滚动`, guide.noXOverflow && guide.readerScrollable && guide.offline && guide.theme === theme)

    if (theme === 'silver-gelatin' && process.env.LUMEN_GUIDE_SCREENSHOT) {
      const image = await captureScreenshot()
      fs.writeFileSync(process.env.LUMEN_GUIDE_SCREENSHOT, Buffer.from(image, 'base64'))
    }

    await run(`([...document.querySelectorAll('.guide-index__nav button')].find((button) => button.textContent.includes('白板工作区'))).click()`)
    await sleep(80)
    const whiteboard = await run(`return (() => {
      const article = document.querySelector('.guide-reader article')
      return {
        title: article?.querySelector('h3')?.textContent,
        lumenboard: article?.textContent.includes('.lumenboard'),
        shortcut: article?.textContent.includes('Space+拖动'),
        sections: article?.querySelectorAll('.guide-block').length
      }
    })()`)
    check(`${theme} 白板章节足够详细`, whiteboard.title === '白板工作区' && whiteboard.lumenboard && whiteboard.shortcut && whiteboard.sections >= 4, JSON.stringify(whiteboard))

    await setSearch('API Key')
    const search = await run(`return ({
      count: document.querySelectorAll('.guide-index__nav button').length,
      names: [...document.querySelectorAll('.guide-index__nav strong')].map((el) => el.textContent),
      title: document.querySelector('.guide-article__header h3')?.textContent
    })`)
    check(`${theme} 全文搜索命中`, search.count === 2 && search.names.includes('AI 智能处理') && search.names.includes('常见问题排查') && search.title === 'AI 智能处理', JSON.stringify(search))

    await setSearch('绝对不存在的教程关键字')
    const empty = await run(`return ({ empty: !!document.querySelector('.guide-empty'), count: document.querySelectorAll('.guide-index__nav button').length })`)
    check(`${theme} 空搜索结果可恢复`, empty.empty && empty.count === 0, JSON.stringify(empty))

    await run(`([...document.querySelectorAll('.guide-empty button')].find((button) => button.textContent.includes('清除搜索'))).click()`)
    await sleep(160)
    const restored = await run(`return document.querySelectorAll('.guide-index__nav button').length`)
    check(`${theme} 清除搜索恢复目录`, restored === 9, String(restored))

    await run(`(() => {
      const reader = document.querySelector('.guide-reader')
      reader.style.scrollBehavior = 'auto'
      reader.scrollTop = 240
    })()`)
    await sleep(60)
    const scroll = await run(`return (() => {
      const reader = document.querySelector('.guide-reader')
      return { top: reader.scrollTop, max: reader.scrollHeight - reader.clientHeight }
    })()`)
    check(`${theme} 正文可滚动阅读`, scroll.top > 0 && scroll.max > 0, JSON.stringify(scroll))

    const themed = await run(`return (() => {
      const nav = document.querySelector('.settings-hub__nav > button')
      const title = document.querySelector('.guide-article__header h3')
      return { clip: getComputedStyle(nav).clipPath, titleFont: getComputedStyle(title).fontFamily }
    })()`)
    check(
      `${theme} 教程跟随主题`,
      theme === 'pixel-glitch'
        ? themed.clip === 'none' && themed.titleFont.includes('Arial Narrow')
        : theme === 'cyber-glitch'
          ? themed.clip !== 'none' && themed.titleFont.includes('Cascadia Mono')
          : themed.clip === 'none' && themed.titleFont.includes('Iowan Old Style'),
      JSON.stringify(themed)
    )

    await run(`document.querySelector('button[aria-label="关闭设置与帮助"]').click()`)
    await sleep(80)
    check(`${theme} 关闭设置中心`, await run(`return !document.querySelector('.settings-hub')`))
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
