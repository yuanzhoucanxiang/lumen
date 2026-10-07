const fs = require('fs')
const f = 'src/renderer/src/components/SettingsModal.tsx'
let s = fs.readFileSync(f, 'utf-8')
const NL = '\n'

// 1) 提供商预设常量（放组件外，文件顶部 UserGuide import 之后）
const constAnchor = "import RestoreDialog from './RestoreDialog'"
if (!s.includes(constAnchor)) { console.error('1 miss'); process.exit(1) }
s = s.replace(
  constAnchor,
  constAnchor +
    NL +
    NL +
    '/** AI 提供商预置（里程碑 178）：一键填 Base URL + 建议模型（OpenCode Go/Zen 为 OpenAI 兼容网关） */' +
    NL +
    'const AI_PROVIDERS: { name: string; baseUrl: string; models: string[] }[] = [' +
    NL +
    "  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4v-flash', 'glm-4v-plus'] }," +
    NL +
    "  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', models: ['deepseek-flash', 'deepseek-v4-pro'] }," +
    NL +
    "  { name: 'OpenCode Go', baseUrl: 'https://opencode.ai/zen/go/v1', models: ['glm-5.3-flash', 'grok-4.7', 'kimi-k3', 'deepseek-v4-pro', 'minimax-m3', 'qwen3.8-max', 'mimo-v2.6-pro'] }," +
    NL +
    "  { name: 'OpenCode Zen', baseUrl: 'https://opencode.ai/zen/v1', models: ['gpt-5.5', 'claude-opus-5', 'gemini-3.1-pro', 'grok-4.7'] }," +
    NL +
    "  { name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-vl-max', 'qwen-vl-plus'] }," +
    NL +
    "  { name: '本地 Ollama', baseUrl: 'http://127.0.0.1:11434/v1', models: ['llava', 'moondream'] }" +
    NL +
    ']'
)

// 2) Base URL 输入：加 datalist + 上方提供商预设行
const urlOld = `            <div>
              <label className="mb-0.5 block text-[11px] text-[var(--text-dim)]">Base URL</label>
              <input
                className="field-input w-full text-[12px]"
                value={settings.aiBaseUrl || ''}
                placeholder="https://open.bigmodel.cn/api/paas/v4"
                onChange={(e) => void update({ aiBaseUrl: e.target.value })}
              />
            </div>`
if (!s.includes(urlOld)) { console.error('2 miss'); process.exit(1) }
s = s.replace(
  urlOld,
  `            <div>
              <label className="mb-0.5 block text-[11px] text-[var(--text-dim)]">快速选择服务商</label>
              <div className="flex flex-wrap gap-1.5">
                {AI_PROVIDERS.map((p) => (
                  <button
                    key={p.name}
                    className={\`rounded-sm border px-2 py-0.5 text-[11px] transition-colors duration-100 \${
                      (settings.aiBaseUrl || '').startsWith(p.baseUrl)
                        ? 'border-[var(--accent)] text-[var(--accent-text)]'
                        : 'border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--accent)] hover:text-[var(--accent-text)]'
                    }\`}
                    title={p.baseUrl}
                    onClick={() =>
                      void update({
                        aiBaseUrl: p.baseUrl,
                        // 模型为空或不属于该服务商建议列表时，填入首个建议模型
                        ...(p.models.includes(settings.aiModel || '') ? {} : { aiModel: p.models[0] })
                      })
                    }
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-0.5 block text-[11px] text-[var(--text-dim)]">Base URL</label>
              <input
                className="field-input w-full text-[12px]"
                value={settings.aiBaseUrl || ''}
                placeholder="https://open.bigmodel.cn/api/paas/v4"
                list="ai-baseurl-presets"
                onChange={(e) => void update({ aiBaseUrl: e.target.value })}
              />
              <datalist id="ai-baseurl-presets">
                {AI_PROVIDERS.map((p) => (
                  <option key={p.baseUrl} value={p.baseUrl} />
                ))}
              </datalist>
            </div>`
)

// 3) 模型列表：并入各服务商建议模型
const modelListOld = `                {[
                  'glm-4v-flash',
                  'glm-4v-plus',
                  'glm-4v',
                  'qwen-vl-max',
                  'qwen-vl-plus',
                  'qwen2.5-vl-7b-instruct',
                  'llava',
                  'moondream'
                ].map((m) => (`
if (!s.includes(modelListOld)) { console.error('3 miss'); process.exit(1) }
s = s.replace(
  modelListOld,
  `                {[...new Set(AI_PROVIDERS.flatMap((p) => p.models))].map((m) => (`
)
fs.writeFileSync(f, s)
console.log('设置页服务商预设已加')
