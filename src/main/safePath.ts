/**
 * 路径段清洗：素材名/标签名等会参与导出路径拼接（exporter original 命名）或写盘，
 * 而 .lumenboard manifest、AI 改名建议等来源可携带路径分隔符/控制字符，必须统一消毒。
 * 同时处理 Windows 保留设备名（CON.jpg/NUL 等会命中设备或写盘失败）。
 */
const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i

export function safePathSegment(s: string): string {
  let out = s
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/[. ]+$/g, '')
    .trim()
  if (!out) return '_'
  if (WINDOWS_RESERVED.test(out)) out = `_${out}`
  return out
}
