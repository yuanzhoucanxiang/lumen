/* 截 guide.html 验证 PDF 排版（同一份 HTML/CSS） */
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 794, // A4 @96dpi
    height: 1123,
    show: false,
    webPreferences: { offscreen: true }
  })
  await win.loadFile(path.join(__dirname, 'guide.html'))
  await new Promise((r) => setTimeout(r, 1000))
  const img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(__dirname, 'guide-preview.png'), img.toPNG())
  console.log('preview saved')
  app.exit(0)
})
