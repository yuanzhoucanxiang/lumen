const status = document.getElementById('status')

function run(btnId, msg, okText) {
  const btn = document.getElementById(btnId)
  btn.addEventListener('click', () => {
    btn.disabled = true
    status.className = ''
    status.textContent = '处理中…'
    chrome.runtime.sendMessage(msg(), (resp) => {
      btn.disabled = false
      if (!resp) {
        status.className = 'err'
        status.textContent = '扩展通信失败，请重试'
        return
      }
      if (resp.ok) {
        status.className = 'ok'
        status.textContent = okText(resp)
      } else {
        status.className = 'err'
        status.textContent = resp.error || '失败'
      }
    })
  })
}

run('clip', () => {
  const minW = Number(document.getElementById('minW').value)
  const exts = [...document.querySelectorAll('.fmt:checked')].map((c) => c.value)
  return { type: 'clipPage', minW, exts }
}, (r) => `完成：发现 ${r.total} 张，成功导入 ${r.imported} 张`)

run('region', () => ({ type: 'regionClip' }), (r) =>
  r.canceled ? '已取消' : `区域截图已导入（${r.w} × ${r.h}）`
)

run('fullpage', () => ({ type: 'fullPageClip' }), (r) =>
  `长截图已导入（共 ${r.shots} 段拼接）`
)
