/* 本地更新源：把 dist/ 挂在 http://127.0.0.1:8899/updates/ 下，供 electron-updater 拉取 */
const http = require('http')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', 'dist')

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]).replace(/^\/updates\/?/, '/')
    const file = path.normalize(path.join(root, urlPath))
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    res.writeHead(200, { 'content-length': fs.statSync(file).size })
    fs.createReadStream(file).pipe(res)
  })
  .listen(8899, '127.0.0.1', () => console.log('update server on http://127.0.0.1:8899/updates/'))
