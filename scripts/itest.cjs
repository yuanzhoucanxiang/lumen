/**
 * 集成测试运行器：启动 dev（CDP 9333）→ 依次运行 .ui-shot/itest*.cjs → 关闭 dev。
 *
 * 用法：
 *   npm run test:itest                 # 跑全部 itest 测试文件
 *   npm run test:itest -- --only ai    # 只跑 itest-ai.cjs
 *
 * 说明：
 *   - 测试文件会通过 CDP 驱动渲染进程做真实断言（部分依赖真实素材库内容，
 *     纯环境差异导致的失败与代码无关,可单独跑 itest-ai.cjs 做确定性验证）。
 *   - dev 实例以 detached 方式启动,测试结束后按进程树整体关闭。
 */
const { spawn, execSync } = require('child_process')
const { readdirSync } = require('fs')
const { join } = require('path')
const http = require('http')

const ROOT = join(__dirname, '..')
const CDP_PORT = 9333
const onlyArg = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null

const ok = (m) => console.log('  ✓', m)
const fail = (m) => {
  console.error('  ✗', m)
  process.exit(1)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 轮询 CDP 端点,直到 dev 就绪或超时 */
async function waitForCdp(timeoutMs = 90_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const targets = await new Promise((resolve, reject) => {
        http
          .get(`http://127.0.0.1:${CDP_PORT}/json/list`, (r) => {
            let d = ''
            r.on('data', (c) => (d += c))
            r.on('end', () => resolve(JSON.parse(d)))
          })
          .on('error', reject)
      })
      if (targets.some((t) => t.type === 'page')) return
    } catch {
      /* dev 尚未就绪,继续等 */
    }
    await sleep(1000)
  }
  fail(`dev 启动超时（${timeoutMs / 1000}s 内 CDP ${CDP_PORT} 无响应）`)
}

function killTree(pid) {
  if (!pid) return
  try {
    if (process.platform === 'win32') execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' })
    else process.kill(-pid, 'SIGTERM')
  } catch {
    /* 进程已退出 */
  }
}

async function main() {
  const files = readdirSync(join(ROOT, '.ui-shot'))
    .filter((f) => /^itest(-[\w-]+)?\.cjs$/.test(f))
    .filter((f) => (onlyArg ? f.includes(onlyArg) : true))
    .sort()
  if (files.length === 0) fail(`未找到匹配的测试文件（--only ${onlyArg}）`)
  console.log(`将运行 ${files.length} 个测试文件: ${files.join(', ')}`)

  console.log('启动 dev (CDP 9333)…')
  const dev = spawn('npm', ['run', 'dev', '--', `--remote-debugging-port=${CDP_PORT}`], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    detached: process.platform !== 'win32'
  })
  let failed = 0
  try {
    await waitForCdp()
    ok('dev 已就绪')
    for (const f of files) {
      console.log(`\n----- 运行 ${f} -----`)
      const r = spawn('node', [join(ROOT, '.ui-shot', f)], { cwd: ROOT, stdio: 'inherit', shell: true })
      const code = await new Promise((resolve) => r.on('exit', resolve))
      if (code !== 0) {
        console.error(`  ✗ ${f} 失败 (exit ${code})`)
        failed++
      }
    }
  } finally {
    console.log('\n关闭 dev…')
    killTree(dev.pid)
    await sleep(1500)
  }

  if (failed > 0) {
    console.error(`\n${failed} 个测试文件失败`)
    process.exit(1)
  }
  console.log('\n🎉 全部测试通过')
}

main().catch((e) => {
  console.error('TEST CRASH:', e.message)
  process.exit(1)
})
