/**
 * 路径段清洗：素材名/标签名等会参与导出路径拼接（exporter original 命名）或写盘，
 * 而 .lumenboard manifest、AI 改名建议等来源可携带路径分隔符/控制字符，必须统一消毒。
 */
export function safePathSegment(s: string): string {
  return (
    s
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/[. ]+$/g, '')
      .trim() || '_'
  )
}
