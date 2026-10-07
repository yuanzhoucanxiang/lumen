const fs = require('fs')
const f = 'src/renderer/src/stores/libraryStore.ts'
let s = fs.readFileSync(f, 'utf-8')

// 1) AgentMsg 加 resultIds（以图搜图结果：无检索条件但有素材 id 清单）
const mOld = "  /** assistant：可保存为智能文件夹的条件（null = 该轮无条件） */\n  smart?: SmartConditions | null"
if (!s.includes(mOld)) { console.error('AgentMsg anchor miss'); process.exit(1) }
s = s.replace(
  mOld,
  mOld + "\n  /** assistant：以图搜图结果素材 id（图库查看用；里程碑 178） */\n  resultIds?: string[]"
)

// 2) 接口加 agentAppendMessage
const iOld = "  agentClearChat: () => void"
if (!s.includes(iOld)) { console.error('iface anchor miss'); process.exit(1) }
s = s.replace(
  iOld,
  "  agentClearChat: () => void\n  /** 追加一条助手消息（以图搜图等旁路结果，里程碑 178） */\n  agentAppendMessage: (msg: AgentMsg) => void"
)

// 3) 实现
const implOld = "  agentClearChat: () => {\n    set({ agentMessages: [], agentHistory: [] })\n    persistAgentChat([], [])\n  },"
if (!s.includes(implOld)) { console.error('impl anchor miss'); process.exit(1) }
s = s.replace(
  implOld,
  implOld +
    "\n\n  agentAppendMessage: (msg) =>\n    set((s2) => {\n      const messages = [...s2.agentMessages, msg]\n      persistAgentChat(messages, s2.agentHistory)\n      return { agentMessages: messages }\n    }),"
)
fs.writeFileSync(f, s)

// 4) IPC 补 agentByIds（按 id 取完整素材，图库查看用）
let i = fs.readFileSync('src/main/ipc/ai.ts', 'utf-8')
const iAnchor = "  // 以图搜图（里程碑 178）"
if (!i.includes(iAnchor)) { console.error('ipc anchor miss'); process.exit(1) }
i = i.replace(
  iAnchor,
  "  // 按 id 取完整素材（以图搜图结果铺进图库用，里程碑 178）\n  ipcMain.handle('ai:agentByIds', (_e, ids: string[]) => {\n    const list = Array.isArray(ids) ? ids.filter((x) => typeof x === 'string').slice(0, 500) : []\n    return list.map((id) => getAssetById(id)).filter((a): a is NonNullable<typeof a> => !!a && a.deletedAt == null)\n  })\n\n" + iAnchor
)
i = i.replace(
  "import { isUnnamedName, queryAssets } from '../repository'",
  "import { getAssetById, isUnnamedName, queryAssets } from '../repository'"
)
fs.writeFileSync('src/main/ipc/ai.ts', i)

// 5) preload 补 agentByIds
let p = fs.readFileSync('src/preload/index.ts', 'utf-8')
const pAnchor = "  /** Agent 操作记录（含能否回退） */"
p = p.replace(
  pAnchor,
  "  /** 按 id 取完整素材（以图搜图结果铺进图库用） */\n  agentByIds: (ids: string[]): Promise<Asset[]> => ipcRenderer.invoke('ai:agentByIds', ids),\n\n" + pAnchor
)
fs.writeFileSync('src/preload/index.ts', p)
console.log('store + IPC + preload 已更新')
