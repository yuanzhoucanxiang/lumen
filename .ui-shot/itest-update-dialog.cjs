/* 更新完成弹窗长日志回归：标题/按钮固定，正文独立滚动且全体不越出视口。前置：CDP 9333。 */
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

  for (const theme of ['silver-gelatin', 'pixel-glitch']) {
    await run(`localStorage.setItem('lumen.theme', '${theme}'); location.reload()`)
    let ready = false
    for (let i = 0; i < 40; i++) {
      await sleep(150)
      ready = await run(`return document.documentElement.dataset.theme === '${theme}' && !!document.querySelector('.archive-shell')`)
      if (ready) break
    }
    check(`${theme} 主界面加载`, ready)

    await run(`(() => {
      document.querySelector('[data-update-dialog-probe]')?.remove()
      const overlay = document.createElement('div')
      overlay.dataset.updateDialogProbe = 'true'
      overlay.className = 'overlay fixed inset-0 z-[500] flex items-center justify-center p-4'
      const lines = Array.from({ length: 80 }, (_, index) => '· 更新内容第 ' + String(index + 1).padStart(2, '0') + ' 条：这是一段用于验证长更新日志滚动与按钮固定位置的说明。').join('\\n')
      overlay.innerHTML = '<div role="dialog" aria-label="新版本 v9.9.9 已就绪" class="confirm-dialog dialog">' +
        '<header class="confirm-dialog__header"><h2>新版本 v9.9.9 已就绪</h2></header>' +
        '<div class="confirm-dialog__body modal-scroll"><p style="white-space:pre-wrap">更新内容：\\n' + lines + '\\n\\n更新已下载完成，重启应用后立即生效。</p></div>' +
        '<footer class="confirm-dialog__actions"><button class="btn-ghost">取消</button><button class="btn-primary">重启安装</button></footer>' +
        '</div>'
      document.body.appendChild(overlay)
    })()`)
    await sleep(80)

    const metrics = await run(`return (() => {
      const dialog = document.querySelector('[data-update-dialog-probe] .confirm-dialog')
      const header = dialog.querySelector('.confirm-dialog__header')
      const body = dialog.querySelector('.confirm-dialog__body')
      const actions = dialog.querySelector('.confirm-dialog__actions')
      const confirm = [...actions.querySelectorAll('button')].find((button) => button.textContent === '重启安装')
      const dr = dialog.getBoundingClientRect()
      const hr = header.getBoundingClientRect()
      const br = body.getBoundingClientRect()
      const ar = actions.getBoundingClientRect()
      const cr = confirm.getBoundingClientRect()
      return {
        viewport: [innerWidth, innerHeight],
        dialog: { top: dr.top, bottom: dr.bottom, height: dr.height },
        header: { top: hr.top, bottom: hr.bottom },
        body: { top: br.top, bottom: br.bottom, client: body.clientHeight, scroll: body.scrollHeight },
        actions: { top: ar.top, bottom: ar.bottom },
        button: { top: cr.top, bottom: cr.bottom },
        display: getComputedStyle(dialog).display,
        bodyOverflow: getComputedStyle(body).overflowY
      }
    })()`)
    const within = metrics.dialog.top >= 16 && metrics.dialog.bottom <= metrics.viewport[1] - 16
    const stacked = metrics.header.bottom <= metrics.body.top + 1 && metrics.body.bottom <= metrics.actions.top + 1
    const buttonVisible = metrics.button.top >= 0 && metrics.button.bottom <= metrics.viewport[1]
    check(`${theme} 长日志弹窗不越界`, within && metrics.display === 'flex', JSON.stringify(metrics))
    check(`${theme} 标题正文按钮分区`, stacked && buttonVisible)
    check(`${theme} 更新内容独立滚动`, metrics.body.scroll > metrics.body.client && metrics.bodyOverflow === 'auto', `${metrics.body.client}/${metrics.body.scroll}`)

    const fixedAfterScroll = await run(`return (() => {
      const body = document.querySelector('[data-update-dialog-probe] .confirm-dialog__body')
      const actions = document.querySelector('[data-update-dialog-probe] .confirm-dialog__actions')
      const before = actions.getBoundingClientRect().top
      body.scrollTop = body.scrollHeight
      return { before, after: actions.getBoundingClientRect().top, scrollTop: body.scrollTop }
    })()`)
    check(`${theme} 滚动后安装按钮位置固定`, fixedAfterScroll.scrollTop > 0 && Math.abs(fixedAfterScroll.before - fixedAfterScroll.after) < 0.5, JSON.stringify(fixedAfterScroll))

    await run(`document.querySelector('[data-update-dialog-probe]').remove()`)

    await run(`(() => {
      const card = document.createElement('div')
      card.dataset.updateCardProbe = 'true'
      card.className = 'update-card menu fixed bottom-6 right-6 z-[500] w-72 p-3.5'
      const lines = Array.from({ length: 80 }, (_, index) => '· 下载前更新说明 ' + (index + 1)).join('\\n')
      card.innerHTML = '<p>发现新版本 <span class="mono">v9.9.9</span></p>' +
        '<div class="update-card__notes modal-scroll mt-2 max-h-28 overflow-y-auto" style="white-space:pre-wrap">' + lines + '</div>' +
        '<p class="mt-1.5">下载后重启即可完成安装</p>' +
        '<div class="mt-2.5 flex gap-2"><button class="btn-primary flex-1">立即下载</button><button class="btn-ghost">稍后</button></div>'
      document.body.appendChild(card)
    })()`)
    const cardMetrics = await run(`return (() => {
      const card = document.querySelector('[data-update-card-probe]')
      const notes = card.querySelector('.update-card__notes')
      const button = [...card.querySelectorAll('button')].find((item) => item.textContent === '立即下载')
      const cardRect = card.getBoundingClientRect()
      const buttonRect = button.getBoundingClientRect()
      return {
        cardTop: cardRect.top,
        cardBottom: cardRect.bottom,
        viewportHeight: innerHeight,
        buttonTop: buttonRect.top,
        buttonBottom: buttonRect.bottom,
        notesClient: notes.clientHeight,
        notesScroll: notes.scrollHeight,
        overflow: getComputedStyle(notes).overflowY
      }
    })()`)
    check(`${theme} 下载前更新卡片不越界`, cardMetrics.cardTop >= 16 && cardMetrics.cardBottom <= cardMetrics.viewportHeight - 16 && cardMetrics.buttonBottom <= cardMetrics.viewportHeight, JSON.stringify(cardMetrics))
    check(`${theme} 下载前说明独立滚动`, cardMetrics.notesScroll > cardMetrics.notesClient && cardMetrics.overflow === 'auto', `${cardMetrics.notesClient}/${cardMetrics.notesScroll}`)
    await run(`document.querySelector('[data-update-card-probe]').remove()`)
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
