/* 白板独立工作区专项验证
   前置：npm run dev -- --remote-debugging-port=9333
   验证：文件夹只切参考来源 / 参考架拖入画布 / 外观抽屉向下展开并推动画布 / 双主题 */
const WebSocket = require('ws')
const http = require('http')
const fs = require('fs')

function getJson(url) {
  return new Promise((resolve, reject) =>
    http.get(url, (response) => {
      let data = ''
      response.on('data', (chunk) => (data += chunk))
      response.on('end', () => resolve(JSON.parse(data)))
    }).on('error', reject)
  )
}

async function main() {
  const targets = await getJson('http://127.0.0.1:9333/json/list')
  const page = targets.find((target) => target.type === 'page' && target.url.includes('localhost:5173') && !target.url.includes('floating'))
  if (!page) throw new Error('找不到主窗口页面')
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false })
  await new Promise((resolve, reject) => {
    ws.on('open', resolve)
    ws.on('error', reject)
  })
  let messageId = 0
  const pending = new Map()
  ws.on('message', (message) => {
    const payload = JSON.parse(message.toString())
    if (payload.id && pending.has(payload.id)) {
      pending.get(payload.id)(payload)
      pending.delete(payload.id)
    }
  })
  const command = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++messageId
      pending.set(id, (payload) => payload.error ? reject(new Error(JSON.stringify(payload.error))) : resolve(payload.result))
      ws.send(JSON.stringify({ id, method, params }))
    })
  const run = async (body) => {
    const result = await command('Runtime.evaluate', {
      expression: `(async () => { ${body} })()`,
      returnByValue: true,
      awaitPromise: true
    })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
  }
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  let pass = 0
  let fail = 0
  const check = (name, ok, detail = '') => {
    console.log(ok ? '  PASS' : '  FAIL', name, '—', detail)
    if (ok) pass++
    else fail++
  }

  await run(`
    const boards = await window.api.listBoards()
    for (const board of boards.filter((item) => item.name === 'itest-白板工作区')) await window.api.deleteBoard(board.id)
  `)
  const board = await run(`return await window.api.createBoard('itest-白板工作区')`)
  const boardId = board.id
  const folders = await run(`return await window.api.listFolders()`)
  const sourceFolder = folders.find((folder) => !folder.isSmart && folder.count > 0) ?? null

  for (const theme of ['silver-gelatin', 'pixel-glitch']) {
    console.log(`\n[${theme}]`)
    await run(`
      localStorage.setItem('lumen.theme', '${theme}')
      localStorage.setItem('lumen.board.libraryRailCollapsed', '0')
      localStorage.setItem('lumen.board.referenceTrayCollapsed', '0')
      location.reload()
    `)
    let ready = false
    for (let i = 0; i < 60; i++) {
      await sleep(250)
      ready = await run(`return !!document.querySelector('nav[aria-label="素材库导航"]')`)
      if (ready) break
    }
    check('应用重载就绪', ready)

    await run(`
      const whiteboard = [...document.querySelectorAll('nav[aria-label="素材库导航"] button[aria-label]')]
        .find((button) => button.getAttribute('aria-label')?.startsWith('白板'))
      whiteboard.click()
    `)
    await sleep(350)
    await run(`
      const select = document.querySelector('select[aria-label="切换白板"]')
      select.value = '${boardId}'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    `)
    await sleep(350)

    const workspace = await run(`return (() => {
      const nav = document.querySelector('nav[aria-label="素材库导航"]')
      const tray = document.querySelector('[data-board-reference-panel]')
      const canvas = document.querySelector('[data-board-frame]')
      return { mode: nav?.dataset.workspaceMode, tray: !!tray, canvas: !!canvas, inspector: !!document.querySelector('[data-inspector]') }
    })()`)
    check('进入白板专属界面', workspace.mode === 'board' && workspace.tray && workspace.canvas && !workspace.inspector, JSON.stringify(workspace))

    if (sourceFolder) {
      const clicked = await run(`return (() => {
        const target = [...document.querySelectorAll('section[aria-label="文件夹"] button[aria-label]')]
          .find((button) => button.getAttribute('aria-label') === ${JSON.stringify(sourceFolder.name)})
        if (!target) return false
        target.click()
        return true
      })()`)
      await sleep(350)
      const afterFolder = await run(`return {
        panel: !!document.querySelector('select[aria-label="切换白板"]'),
        tray: !!document.querySelector('[data-board-reference-panel]'),
        source: document.querySelector('[data-board-reference-panel] header strong')?.textContent?.trim() ?? '',
        count: document.querySelectorAll('[data-board-reference-asset]').length
      }`)
      check('文件夹入口可点击', clicked, sourceFolder.name)
      check('切换文件夹后白板不消失', afterFolder.panel && afterFolder.tray, JSON.stringify(afterFolder))
      check('参考素材架切换到目标文件夹', afterFolder.source === sourceFolder.name && afterFolder.count > 0, JSON.stringify(afterFolder))
    }

    const beforeItems = await run(`return (await window.api.listBoardItems(${boardId})).length`)
    const dragResult = await run(`return (() => {
      const source = document.querySelector('[data-board-reference-asset]')
      const canvas = document.querySelector('[data-board-frame]')
      if (!source || !canvas) return { ok: false, reason: 'missing source/canvas' }
      const data = new DataTransfer()
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: data }))
      const rect = canvas.getBoundingClientRect()
      const init = { bubbles: true, cancelable: true, dataTransfer: data, clientX: rect.left + rect.width * .58, clientY: rect.top + rect.height * .52 }
      canvas.dispatchEvent(new DragEvent('dragover', init))
      canvas.dispatchEvent(new DragEvent('drop', init))
      return { ok: true, types: [...data.types] }
    })()`)
    await sleep(500)
    const afterItems = await run(`return (await window.api.listBoardItems(${boardId})).length`)
    check('参考素材使用专用 MIME 拖入', dragResult.ok && dragResult.types.includes('application/x-eaglelike-assets'), JSON.stringify(dragResult))
    check('拖放后素材真实进入当前白板', afterItems > beforeItems, `${beforeItems} → ${afterItems}`)

    // 参考架「+」按钮发送(store 外部添加)也可撤销：Ctrl+Z 应移除该元素
    // (已放置的卡片按钮禁用,选一个未放置的)
    const beforeAddClick = await run(`return (await window.api.listBoardItems(${boardId})).length`)
    await run(`(() => {
      const cards = [...document.querySelectorAll('[data-board-reference-asset]')]
      const card = cards.find((c) => !c.querySelector('.board-reference-card__add').disabled)
      const btn = card?.querySelector('.board-reference-card__add')
      if (btn) btn.click()
    })()`)
    await sleep(600)
    const afterAddClick = await run(`return (await window.api.listBoardItems(${boardId})).length`)
    await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))`)
    await sleep(500)
    const afterUndoAdd = await run(`return (await window.api.listBoardItems(${boardId})).length`)
    check(
      '参考架添加可撤销(Ctrl+Z 移除)',
      afterAddClick === beforeAddClick + 1 && afterUndoAdd === beforeAddClick,
      `${beforeAddClick} → ${afterAddClick} → ${afterUndoAdd}`
    )

    const positionBeforePan = await run(`return (await window.api.listBoardItems(${boardId})).map((item) => ({ id: item.id, x: item.x, y: item.y }))`)
    const panResult = await run(`return (() => {
      const item = document.querySelector('[data-board-item]')
      const surface = item?.parentElement
      if (!item || !surface) return { ok: false }
      const rect = item.getBoundingClientRect()
      const x = rect.left + Math.min(30, rect.width / 2)
      const y = rect.top + Math.min(30, rect.height / 2)
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }))
      item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 77, clientX: x, clientY: y }))
      item.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 77, clientX: x + 140, clientY: y + 90 }))
      item.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, buttons: 0, pointerId: 77, clientX: x + 140, clientY: y + 90 }))
      window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }))
      return { ok: true, transform: surface.style.transform }
    })()`)
    await sleep(180)
    const positionAfterPan = await run(`return (await window.api.listBoardItems(${boardId})).map((item) => ({ id: item.id, x: item.x, y: item.y }))`)
    const persistedTransform = await run(`return document.querySelector('[data-board-item]')?.parentElement?.style.transform ?? ''`)
    check('从素材上空格拖动只平移画布', panResult.ok && panResult.transform.includes('140px') && persistedTransform.includes('140px'), `${panResult.transform} / ${persistedTransform}`)
    check('平移画布不会改写素材坐标', JSON.stringify(positionBeforePan) === JSON.stringify(positionAfterPan), `${JSON.stringify(positionBeforePan)} → ${JSON.stringify(positionAfterPan)}`)

    await run(`
      const search = document.querySelector('input[aria-label="搜索参考素材"]')
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setValue.call(search, '__itest_no_reference_match__')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    `)
    await sleep(350)
    const independentCanvas = await run(`return {
      trayAssets: document.querySelectorAll('[data-board-reference-asset]').length,
      boardImages: document.querySelectorAll('[data-board-item] img, [data-board-item] video').length
    }`)
    check('画布素材不受参考来源筛选影响', independentCanvas.trayAssets === 0 && independentCanvas.boardImages > 0, JSON.stringify(independentCanvas))

    // 原图切换(方案 B):放大超阈值 -> 视口内图片叠加原图 data-board-orig;缩回 -> 切回缩略图
    const surfaceScale = `(() => { const m = /scale\\(([\\d.]+)\\)/.exec(document.querySelector('[data-board-frame] div.absolute.left-0.top-0')?.style.transform ?? ''); return m ? Number(m[1]) : 1 })()`
    // 显式归位 scale=1(前序交互可能留下缩放,污染阈值断言)
    await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }))`)
    await sleep(300)
    const origBefore = await run(`return {
      scale: ${surfaceScale},
      orig: document.querySelectorAll('[data-board-orig]').length
    }`)
    await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }))`)
    await sleep(600)
    const origZoomed = await run(`return {
      scale: ${surfaceScale},
      orig: document.querySelectorAll('[data-board-orig]').length,
      loaded: document.querySelectorAll('[data-board-orig][style*="opacity: 1"]').length
    }`)
    await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }))`)
    await sleep(300)
    await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true }))`)
    await sleep(300)
    await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true }))`)
    await sleep(600)
    const origShrunk = await run(`return document.querySelectorAll('[data-board-orig]').length`)
    check('放大加载原图(叠加 data-board-orig 且淡入完成)', origZoomed.scale >= 1.25 && origZoomed.orig > 0 && origZoomed.loaded > 0, JSON.stringify(origZoomed))
    check('缩小后切回缩略图(原图层移除)', origShrunk === 0, `orig=${origShrunk}`)
    await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }))`)
    await sleep(300)

    await run(`
      const clear = document.querySelector('button[aria-label="清空参考素材搜索"]')
      if (clear) clear.click()
      else {
        const search = document.querySelector('input[aria-label="搜索参考素材"]')
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setValue.call(search, '')
        search.dispatchEvent(new Event('input', { bubbles: true }))
      }
    `)
    await sleep(300)

    const widthBeforeCollapse = await run(`return document.querySelector('[data-board-frame]').getBoundingClientRect().width`)
    await run(`
      document.querySelector('button[aria-label="收起参考素材架"]').click()
      document.querySelector('button[aria-label="收起素材库列表"]').click()
    `)
    await sleep(300)
    const collapsedLayout = await run(`return {
      width: document.querySelector('[data-board-frame]').getBoundingClientRect().width,
      library: document.querySelector('[data-board-library-collapsed]')?.dataset.boardLibraryCollapsed,
      tray: document.querySelector('[data-board-reference-panel]')?.dataset.collapsed
    }`)
    check('素材库列表与参考素材架可分别收成窄轨', collapsedLayout.library === 'true' && collapsedLayout.tray === 'true', JSON.stringify(collapsedLayout))
    check('双侧栏收起后真实扩大画布', collapsedLayout.width > widthBeforeCollapse + 350, `${widthBeforeCollapse} → ${collapsedLayout.width}`)
    const collapsedShot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    fs.writeFileSync(`.ui-shot/board-workspace-collapsed-${theme}.png`, Buffer.from(collapsedShot.data, 'base64'))
    await run(`
      document.querySelector('button[aria-label="展开素材库列表"]').click()
      document.querySelector('button[aria-label="展开参考素材架"]').click()
    `)
    await sleep(300)

    const drawerBefore = await run(`return (() => { const frame = document.querySelector('[data-board-frame]'); return { top: frame.getBoundingClientRect().top, height: document.querySelector('[data-board-appearance-drawer]').getBoundingClientRect().height } })()`)
    await run(`document.querySelector('button[aria-label="画布外观"]').click()`)
    // 后台 Electron 窗口可能节流 CSS transition 帧，轮询最终布局而非依赖固定延时。
    for (let i = 0; i < 20; i++) {
      await sleep(100)
      const height = await run(`return document.querySelector('[data-board-appearance-drawer]').getBoundingClientRect().height`)
      if (height >= 50) break
    }
    // CDP 控制的非前台窗口偶尔会把 transition 停在首帧；结束动画后断言最终布局。
    await run(`
      const drawer = document.querySelector('[data-board-appearance-drawer]')
      for (const animation of drawer.getAnimations()) animation.finish()
    `)
    const drawerAfter = await run(`return (() => { const frame = document.querySelector('[data-board-frame]'); const drawer = document.querySelector('[data-board-appearance-drawer]'); const r = drawer.getBoundingClientRect(); return { top: frame.getBoundingClientRect().top, height: r.height, bottom: r.bottom, frameTop: frame.getBoundingClientRect().top, expanded: document.querySelector('button[aria-label="画布外观"]').getAttribute('aria-expanded') } })()`)
    check('画布外观是内联向下抽屉', drawerAfter.height >= 50 && drawerAfter.expanded === 'true', JSON.stringify(drawerAfter))
    check('外观抽屉推动画布下移而非覆盖', drawerAfter.top > drawerBefore.top + 45 && Math.abs(drawerAfter.bottom - drawerAfter.frameTop) < 2, `${drawerBefore.top} → ${drawerAfter.top}`)

    const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    fs.writeFileSync(`.ui-shot/board-workspace-${theme}.png`, Buffer.from(shot.data, 'base64'))
    await run(`document.querySelector('button[aria-label="收起画布外观"]').click()`)
    await sleep(220)
    await run(`document.querySelector('button[aria-label="退出白板"]').click()`)
    await sleep(220)
  }

  await run(`await window.api.deleteBoard(${boardId})`)
  // 交付测试版停在默认银盐白板工作区，便于直接体验；两条侧轨默认展开。
  await run(`
    localStorage.setItem('lumen.theme', 'silver-gelatin')
    localStorage.setItem('lumen.board.libraryRailCollapsed', '0')
    localStorage.setItem('lumen.board.referenceTrayCollapsed', '0')
    location.reload()
  `)
  for (let i = 0; i < 60; i++) {
    await sleep(200)
    const ready = await run(`return !!document.querySelector('nav[aria-label="素材库导航"]')`)
    if (ready) break
  }
  await run(`
    const whiteboard = [...document.querySelectorAll('nav[aria-label="素材库导航"] button[aria-label]')]
      .find((button) => button.getAttribute('aria-label')?.startsWith('白板'))
    if (whiteboard) whiteboard.click()
  `)
  await sleep(300)
  console.log(`\n${pass} PASS / ${fail} FAIL`)
  ws.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error('TEST CRASH:', error.message)
  process.exit(1)
})
