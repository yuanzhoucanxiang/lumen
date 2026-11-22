/**
 * 拖拽载荷约定（里程碑 251 归一）。
 * 图库、侧栏、白板画布、参考素材架共用同一组 MIME 常量与解析函数——
 * 此前四个文件各写一份字符串常量、各自 JSON.parse 后强转，
 * 改一处形态（例如素材拖拽从 id 数组改成对象）就会漏改另一处。
 */

/** 素材拖拽：值为 id 数组的 JSON（图库卡片 / 参考架 → 画布、文件夹、标签、白板项） */
export const ASSET_MIME = 'application/x-eaglelike-assets'
/** 标签拖拽：值为标签名（侧栏标签行 ↔ 图库卡片/空白） */
export const TAG_MIME = 'application/x-eaglelike-tag'
/** 文件夹层级拖拽：值为文件夹 id（与素材拖入的 copy 语义区分，避免两套 drop 逻辑互相误判） */
export const FOLDER_MIME = 'application/x-eaglelike-folder'

/** 拖拽内容是否为素材（dragover 阶段判定用；不解析数据） */
export function isAssetDrag(dt: DataTransfer | null | undefined): boolean {
  return !!dt && dt.types.includes(ASSET_MIME)
}

/** 读取素材拖拽的 id 列表：不存在/非法/空数据一律返回 [] */
export function readAssetIds(dt: DataTransfer | null | undefined): string[] {
  if (!dt) return []
  const raw = dt.getData(ASSET_MIME)
  if (!raw) return []
  try {
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return []
    return v.filter((x): x is string => typeof x === 'string' && x.length > 0)
  } catch {
    return []
  }
}

/** 写入素材拖拽载荷（copy 语义，与文件夹层级移动区分） */
export function writeAssetDrag(dt: DataTransfer, ids: string[]): void {
  dt.setData(ASSET_MIME, JSON.stringify(ids))
  dt.effectAllowed = 'copy'
}

/** 读取文件夹拖拽的 id（非法返回 null） */
export function readFolderId(dt: DataTransfer | null | undefined): number | null {
  const raw = dt?.getData(FOLDER_MIME) ?? ''
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

/** 读取标签拖拽的名称（非法返回空串） */
export function readTagName(dt: DataTransfer | null | undefined): string {
  return (dt?.getData(TAG_MIME) ?? '').trim()
}
