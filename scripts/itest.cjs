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

  console.log('启动 dev (CDP 9333)…')
  const dev = spawn('npm', ['run', 'dev', '--', `--remote-debugging-port=${CDP_PORT}`], {
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
  let failed = 0
  try {
    await waitForCdp()
    ok('dev 已就绪')
    for (const f of files) {
      console.log(`\n----- 运行 ${f} -----`)
      const r = spawn('node', [join(ROOT, '.ui-shot', f)], {
        cwd: ROOT,
        stdio: 'inherit',
        shell: true,
        env: { ...process.env, LUMEN_CLIP_PORT: '45679', ...(cfgDir ? { LUMEN_CONFIG_DIR: cfgDir } : {}) }
      })
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
