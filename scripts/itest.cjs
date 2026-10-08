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
const { mkdirSync, readdirSync, rmSync } = require('fs')
const { join } = require('path')
const { tmpdir } = require('os')
const http = require('http')

const ROOT = join(__dirname, '..')
const CDP_PORT = 9333
const onlyArg = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null
/** CI 用:ITEST_EXCLUDE=itest-ai,itest-update-dialog 跳过依赖外部服务的测试 */
const excludeArg = process.env.ITEST_EXCLUDE || ''

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
    if (await cdpAlive(1500)) return
    await sleep(1000)
  }
  fail(`dev 启动超时（${timeoutMs / 1000}s 内 CDP ${CDP_PORT} 无响应）`)
}

/** dev 是否还活着（套件之间与套件失败后都靠它判断，里程碑 186） */
async function cdpAlive(timeoutMs = 3000) {
  try {
    const targets = await new Promise((resolve, reject) => {
      const req = http
        .get(`http://127.0.0.1:${CDP_PORT}/json/list`, (r) => {
          let d = ''
          r.on('data', (c) => (d += c))
          r.on('end', () => resolve(JSON.parse(d)))
        })
        .on('error', reject)
      req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')))
    })
    return Array.isArray(targets) && targets.some((t) => t.type === 'page')
  } catch {
    return false
  }
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
  const excluded = excludeArg
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const files = readdirSync(join(ROOT, '.ui-shot'))
    .filter((f) => /^itest(-[\w-]+)?\.cjs$/.test(f))
    .filter((f) => (onlyArg ? f.includes(onlyArg) : true))
    .filter((f) => !excluded.some((x) => f.includes(x)))
    .sort()
  if (files.length === 0) fail(`未找到匹配的测试文件（--only ${onlyArg}）`)
  console.log(`将运行 ${files.length} 个测试文件: ${files.join(', ')}`)
  if (excluded.length > 0) console.log(`(已排除: ${excluded.join(', ')})`)

  // 配置隔离（里程碑 185）：默认让 dev 用一份临时配置跑，测试就碰不到用户真实的设置
  // （此前测试能改到用户的 Agent 开关/可写范围，中途崩溃还会把设置留在测试态）。
  // 素材库不受影响：临时配置里没有库记录，应用会落到默认库路径（即用户平时用的那个）。
  // 想用真实配置跑（例如手动验证 AI 相关设置）：LUMEN_ITEST_REAL_CONFIG=1
  let cfgDir = ''
  if (process.env.LUMEN_ITEST_REAL_CONFIG === '1') {
    console.log('(使用真实配置: LUMEN_ITEST_REAL_CONFIG=1)')
  } else {
    cfgDir = join(tmpdir(), 'lumen-itest-config')
    rmSync(cfgDir, { recursive: true, force: true })
    mkdirSync(cfgDir, { recursive: true })
    console.log(`(配置已隔离: ${cfgDir})`)
  }

  // 抗崩溃（里程碑 186）：无头 CI 上应用偶发在某个套件里挂起/死掉，此前会让其后所有套件
  // 连锁失败（ECONNREFUSED，一次事故 8~12 条）。现在：套件之间探活、死了就重启；
  // 单个套件超时（默认 8 分钟）判失败并重启应用；失败套件再原地重试一次（真 bug 仍会失败）。
  const suiteTimeoutMs = Number(process.env.ITEST_SUITE_TIMEOUT_MS) || 8 * 60 * 1000
  const maxRestarts = Number(process.env.ITEST_MAX_RESTARTS) || 6
  const spawnDev = () =>
    spawn('npm', ['run', 'dev', '--', `--remote-debugging-port=${CDP_PORT}`], {
      cwd: ROOT,
      stdio: 'inherit',
      shell: true,
      detached: process.platform !== 'win32',
      // 测试逃生门:用户正式版 LUMEN 持有单实例锁时,dev 仍可启动(里程碑 105)
      env: {
        ...process.env,
        LUMEN_ALLOW_MULTI: '1',
        LUMEN_CLIP_PORT: '45679',
        ...(cfgDir ? { LUMEN_CONFIG_DIR: cfgDir } : {})
      }
    })
  let restarts = 0
  let dev = spawnDev()
  let restarted = 0

  /** 确保 dev 可用：不可用就按进程树杀掉重启（有次数上限，避免无限循环） */
  const ensureDev = async (reason) => {
    if (await cdpAlive()) return
    if (restarts >= maxRestarts) fail(`dev 反复不可用（已重启 ${restarts} 次，原因：${reason}）`)
    console.log(`\n↻ dev 不可用（${reason}），重启中…（第 ${restarts + 1} 次）`)
    killTree(dev.pid)
    await sleep(2000)
    dev = spawnDev()
    restarts++
    restarted++
    await waitForCdp()
    console.log('  ✓ dev 已重新就绪')
  }

  /** 跑一个套件，带超时；返回 { code, timedOut } */
  const runSuiteOnce = (f) =>
    new Promise((resolve) => {
      const r = spawn('node', [join(ROOT, '.ui-shot', f)], {
        cwd: ROOT,
        stdio: 'inherit',
        shell: true,
        env: { ...process.env, LUMEN_CLIP_PORT: '45679', ...(cfgDir ? { LUMEN_CONFIG_DIR: cfgDir } : {}) }
      })
      const timer = setTimeout(() => {
        console.error(`  ⏱ ${f} 超时（${Math.round(suiteTimeoutMs / 1000)}s），中止该套件`)
        killTree(r.pid)
        resolve({ code: 'timeout', timedOut: true })
      }, suiteTimeoutMs)
      r.on('exit', (code) => {
        clearTimeout(timer)
        resolve({ code, timedOut: false })
      })
    })

  let failed = 0
  try {
    await waitForCdp()
    ok('dev 已就绪')
    for (const f of files) {
      // 关键：每个套件开跑前先探活——上一个套件把应用搞死了也不会连累这个套件（里程碑 186）
      await ensureDev(`进入 ${f} 前探活失败`)
      console.log(`\n----- 运行 ${f} -----`)
      let passed = false
      for (let attempt = 1; attempt <= 2 && !passed; attempt++) {
        const { code, timedOut } = await runSuiteOnce(f)
        if (code === 0) {
          if (attempt > 1) console.log(`  ✓ ${f} 重试通过`)
          passed = true
          break
        }
        const why = timedOut ? '超时' : `exit ${code}`
        console.error(`  ✗ ${f} 第 ${attempt} 次失败（${why}）`)
        if (timedOut) {
          // 超时基本等于"应用卡住了"：直接重启，别把烂状态带给后面的套件
          if (restarts >= maxRestarts) break
          killTree(dev.pid)
          await sleep(2000)
          dev = spawnDev()
          restarts++
          restarted++
          await waitForCdp().catch(() => {})
        } else {
          // 断言失败通常应用还活着；只有应用真没了才重启
          await ensureDev(`${f} 失败后 CDP 无响应`).catch(() => {})
        }
      }
      if (!passed) failed++
    }
  } finally {
    console.log('\n关闭 dev…')
    killTree(dev.pid)
    await sleep(1500)
  }

  if (restarted > 0) console.log(`\n(本次共重启 dev ${restarted} 次)`)
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
