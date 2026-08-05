/* 把 使用说明.md 转成打印风 PDF（Chromium 渲染，中文完美）
   用法：npx electron .ui-shot/make-guide-pdf.cjs → 输出 LUMEN-使用说明.pdf */
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

/* ---- 极简 Markdown 解析（覆盖本文档用到的语法） ---- */
function inline(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>')
}

function mdToHtml(md) {
  const lines = md.split(/\r?\n/)
  const out = []
  let i = 0
  let inList = null // 'ul' | 'ol'
  const closeList = () => {
    if (inList) {
      out.push(inList === 'ul' ? '</ul>' : '</ol>')
      inList = null
    }
  }
  while (i < lines.length) {
    const line = lines[i]

    // 表格
    if (/^\|.+\|$/.test(line.trim()) && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
      closeList()
      const headers = line.split('|').slice(1, -1).map((c) => c.trim())
      i += 2
      const rows = []
      while (i < lines.length && /^\|.+\|$/.test(lines[i].trim())) {
        rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim()))
        i++
      }
      out.push(
        '<table><thead><tr>' +
          headers.map((h) => `<th>${inline(h)}</th>`).join('') +
          '</tr></thead><tbody>' +
          rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
          '</tbody></table>'
      )
      continue
    }

    const t = line.trim()
    if (t === '') {
      closeList()
      i++
      continue
    }
    if (t === '---') {
      closeList()
      out.push('<hr/>')
      i++
      continue
    }
    if (t.startsWith('> ')) {
      closeList()
      out.push(`<blockquote>${inline(t.slice(2))}</blockquote>`)
      i++
      continue
    }
    const h = t.match(/^(#{1,3})\s+(.*)$/)
    if (h) {
      closeList()
      const level = h[1].length
      out.push(`<h${level}>${inline(h[2])}</h${level}>`)
      i++
      continue
    }
    if (/^- /.test(t)) {
      if (inList !== 'ul') {
        closeList()
        out.push('<ul>')
        inList = 'ul'
      }
      out.push(`<li>${inline(t.slice(2))}</li>`)
      i++
      continue
    }
    if (/^\d+\.\s/.test(t)) {
      if (inList !== 'ol') {
        closeList()
        out.push('<ol>')
        inList = 'ol'
      }
      out.push(`<li>${inline(t.replace(/^\d+\.\s/, ''))}</li>`)
      i++
      continue
    }
    closeList()
    out.push(`<p>${inline(t)}</p>`)
    i++
  }
  closeList()
  return out.join('\n')
}

const CSS = `
  * { box-sizing: border-box; }
  body {
    font-family: 'Microsoft YaHei', 'PingFang SC', 'Segoe UI', sans-serif;
    color: #1f2430;
    font-size: 12.5px;
    line-height: 1.75;
    margin: 0;
  }
  .page { padding: 8px 4px; }
  h1 {
    font-size: 22px;
    margin: 0 0 4px;
    letter-spacing: 0.04em;
    color: #0d1117;
    border-bottom: 3px solid #4da9e9;
    padding-bottom: 10px;
  }
  h2 {
    font-size: 15.5px;
    margin: 22px 0 8px;
    padding-left: 9px;
    border-left: 4px solid #4da9e9;
    color: #0d1117;
  }
  h3 { font-size: 13.5px; margin: 14px 0 6px; }
  p { margin: 6px 0; }
  blockquote {
    margin: 8px 0;
    padding: 8px 12px;
    background: #f0f7ff;
    border-left: 4px solid #4da9e9;
    color: #40536b;
  }
  ul, ol { margin: 6px 0; padding-left: 22px; }
  li { margin: 3px 0; }
  code {
    background: #eef1f5;
    border: 1px solid #dde3ea;
    border-radius: 3px;
    padding: 0 4px;
    font-family: Consolas, monospace;
    font-size: 11.5px;
    color: #b0403a;
  }
  a { color: #2b7ab8; text-decoration: none; word-break: break-all; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 8px 0;
    font-size: 12px;
  }
  th, td {
    border: 1px solid #d7dee8;
    padding: 5px 8px;
    text-align: left;
    vertical-align: top;
  }
  th { background: #f0f7ff; color: #2b5a80; white-space: nowrap; }
  tr:nth-child(even) td { background: #fafbfc; }
  hr { border: none; border-top: 1px solid #dde3ea; margin: 18px 0; }
  .footer { text-align: center; color: #8a94a3; margin-top: 16px; font-size: 11px; }
  strong { color: #0d1117; }
`

app.whenReady().then(async () => {
  const md = fs.readFileSync(path.join(__dirname, '..', '使用说明.md'), 'utf-8')
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${CSS}</style></head>
<body><div class="page">${mdToHtml(md)}</div></body></html>`
  const htmlPath = path.join(__dirname, 'guide.html')
  fs.writeFileSync(htmlPath, html, 'utf-8')

  const win = new BrowserWindow({
    width: 900,
    height: 1200,
    show: false,
    webPreferences: { offscreen: true }
  })
  await win.loadFile(htmlPath)
  await new Promise((r) => setTimeout(r, 1200))
  const pdf = await win.webContents.printToPDF({
    pageSize: 'A4',
    printBackground: true,
    margins: { marginType: 'custom', top: 1.4, bottom: 1.4, left: 1.6, right: 1.6 }
  })
  const out = path.join(__dirname, '..', 'LUMEN-使用说明.pdf')
  fs.writeFileSync(out, pdf)
  console.log('PDF written:', out, pdf.length, 'bytes')
  app.exit(0)
})
