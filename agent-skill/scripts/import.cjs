#!/usr/bin/env node
/* LUMEN 本地导入脚本:把文件/目录批量导入 LUMEN 素材库(可打标签/归文件夹/写备注/查相似)。
   用法:
     node import.cjs --paths <文件或目录>... [--tags 标签1,标签2] [--folder "A/B"] [--move]
                     [--note "prompt:... 模型:..."] [--check-similar]
   退出码: 0=成功 1=有失败项 2=LUMEN 未运行 3=LUMEN 版本过旧(无 /import) */
'use strict'
const http = require('http')

function parseArgs(argv) {
  const args = { paths: [], tags: [], folder: '', move: false, note: '', checkSimilar: false, validate: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--paths' || a === '--path') {
      // 连续收集路径,直到遇到下一个 -- 开头的参数(路径可能含空格,由 shell 传参保证)
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) args.paths.push(argv[++i])
    } else if (a === '--tags') {
      args.tags = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    } else if (a === '--folder') {
      args.folder = argv[++i] ?? ''
    } else if (a === '--note') {
      args.note = argv[++i] ?? ''
    } else if (a === '--check-similar') {
      args.checkSimilar = true
    } else if (a === '--dry-run') {
      args.validate = true
    } else if (a === '--move') {
      args.move = true
    } else if (!a.startsWith('--')) {
      args.paths.push(a) // 容错:裸路径也算 paths
    }
  }
  return args
}

function post(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload)
    const req = http.request(
      { host: '127.0.0.1', port: 45678, path: '/import', method: 'POST', agent: false,
        headers: { 'x-lumen-client': 'lumen-clip/1', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        let d = ''
        res.on('data', (c) => (d += c))
        res.on('end', () => resolve({ status: res.statusCode, body: d }))
      }
    )
    req.on('error', reject)
    // 大批量导入(几百个文件要生成缩略图/哈希)可能超过 2 分钟,放宽到 5 分钟
    req.setTimeout(300000, () => req.destroy(new Error('请求超时(300s)')))
    req.end(body)
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.paths.length === 0) {
    console.error('用法: node import.cjs --paths <文件或目录>... [--tags 标签1,标签2] [--folder "A/B"] [--move]')
    process.exit(1)
  }
  let res
  try {
    res = await post({ paths: args.paths, tags: args.tags, folder: args.folder, move: args.move, note: args.note, checkSimilar: args.checkSimilar, validate: args.validate })
  } catch (e) {
    console.error('LUMEN 未运行或无法连接(127.0.0.1:45678):', e.message)
    console.error('请先启动 LUMEN 桌面应用后重试。')
    process.exit(2)
  }
  if (res.status === 404) {
    console.error('LUMEN 的 /import 端点不存在:安装的 LUMEN 版本过旧,请更新后重试。')
    process.exit(3)
  }
  if (res.status === 403) {
    console.error('LUMEN 拒绝了请求(403):鉴权头缺失或错误。')
    process.exit(1)
  }
  let json = null
  try { json = JSON.parse(res.body) } catch { /* 落到下面的未知响应分支 */ }
  if (!json || json.ok !== true) {
    console.error(`导入失败(HTTP ${res.status}):`, res.body.slice(0, 300))
    process.exit(1)
  }
  console.log(JSON.stringify(json))
  if (json.failed > 0 || (json.missing && json.missing.length > 0)) process.exit(1)
}

main()
