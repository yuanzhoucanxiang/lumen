import { existsSync, readFileSync } from 'fs'
import { mkdir, readFile, readdir, writeFile } from 'fs/promises'
import { dirname, join, relative } from 'path'
import { homedir } from 'os'
import { app, shell } from 'electron'
import { logger } from './logger'

/**
 * Agent 技能随包分发与安装。
 * 技能源文件随安装包放在 resources/skill/（dev 下为仓库根 agent-skill/），
 * 用户在设置页点「安装技能」后复制到本机 agent 的技能目录——
 * 不做启动时自动写入：不是每台机器都装了 agent，被动安装不打扰无 agent 的用户。
 */

/** 技能源目录:打包后位于 resources/skill(electron-builder extraResources),dev 下取仓库根 agent-skill/ */
export function agentSkillSourceDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'skill') : join(app.getAppPath(), 'agent-skill')
}

/** 递归收集目录下全部文件的相对路径(正斜杠,跨平台稳定) */
async function listFilesRel(dir: string, base = dir): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await listFilesRel(p, base)))
    else out.push(relative(base, p).replace(/\\/g, '/'))
  }
  return out
}

/**
 * 把技能文件安装到本机 agent 的技能目录。
 * 候选目录:~/.agents/skills/lumen(ZCode 等)与 ~/.claude/skills/lumen(Claude Code,仅当 ~/.claude 存在);
 * 两者都不存在时落到 ~/.agents/skills/lumen(用户点了安装,创建即合理)。
 * 内容与源一致的文件跳过写盘(幂等);已安装的返回目录列表,供 UI 反馈。
 */
export async function installAgentSkill(): Promise<{ installed: string[]; source: string }> {
  const src = agentSkillSourceDir()
  const skm = join(src, 'SKILL.md')
  if (!existsSync(skm)) throw new Error(`技能资源缺失: ${skm}`)
  const rels = await listFilesRel(src)

  const home = homedir()
  const candidates = [join(home, '.agents'), join(home, '.claude')].filter((p) => existsSync(p))
  const roots = candidates.length > 0 ? candidates : [join(home, '.agents')]
  const installed: string[] = []
  for (const root of roots) {
    const dir = join(root, 'skills', 'lumen')
    let changed = 0
    for (const rel of rels) {
      const srcFile = join(src, rel)
      const dstFile = join(dir, ...rel.split('/'))
      const content = await readFile(srcFile)
      try {
        if ((await readFile(dstFile)).equals(content)) continue // 内容相同跳过,不折腾 mtime
      } catch {
        /* 目标不存在,正常写入 */
      }
      await mkdir(dirname(dstFile), { recursive: true })
      await writeFile(dstFile, content)
      changed++
    }
    installed.push(dir)
    logger.info('[agent-skill]', `技能安装 ${dir} (更新 ${changed} 个文件)`)
  }
  return { installed, source: src }
}

/** 在资源管理器中打开随包分发的技能文件夹(供手动复制到未支持的 agent 目录) */
export async function openAgentSkillFolder(): Promise<void> {
  const src = agentSkillSourceDir()
  if (!existsSync(src)) {
    logger.warn('[agent-skill]', `技能源目录不存在: ${src}`)
    return
  }
  await shell.openPath(src)
}

/** 技能安装状态(设置页提示用,只读不写):已装目录里的 SKILL.md 是否与随包版本一致 */
export function agentSkillStatus(): { installed: boolean; upToDate: boolean; dirs: string[] } {
  const skm = join(agentSkillSourceDir(), 'SKILL.md')
  if (!existsSync(skm)) return { installed: false, upToDate: false, dirs: [] }
  const bundled = readFileSync(skm)
  const home = homedir()
  const dirs = [join(home, '.agents'), join(home, '.claude')]
    .filter((p) => existsSync(p))
    .map((root) => join(root, 'skills', 'lumen'))
    .filter((d) => existsSync(join(d, 'SKILL.md')))
  const upToDate =
    dirs.length > 0 &&
    dirs.every((d) => {
      try {
        return readFileSync(join(d, 'SKILL.md')).equals(bundled)
      } catch {
        return false
      }
    })
  return { installed: dirs.length > 0, upToDate, dirs }
}
