// 图库方向键导航(里程碑 246):Gallery 在布局变化时发布 {mode, items},
// App 的方向键分支按布局模式计算目标项——网格按列数跨行、瀑布流按列几何最近邻,
// 列表/元数据缺失时回退平铺 ±1(与旧版行为一致)。
// 不放进 store:布局是 Gallery 的派生值,每次布局变化全量写入 store 只会让
// 所有订阅者跟着重渲染,模块级单例即可(App 是唯一读者)。
import type { LayoutMode } from './stores/libraryStore'

export interface GalleryNavItem {
  id: string
  /** 列号(列表恒 0;网格/瀑布流由布局写入) */
  dev: number
  y: number
  h: number
}

export interface GalleryNavMeta {
  mode: LayoutMode
  items: GalleryNavItem[]
}

let meta: GalleryNavMeta | null = null
/** Shift+方向键扩选的锚点:最近一次不带 Shift 的移动落点 */
let anchor: string | null = null
/** 方向键刚移动过选中:Gallery 的滚动进视口只在此时介入
 *  (点选/程序化选中的目标必然可见或来自测试合成点击,不该拽动滚动位置) */
let navJustMoved = false

export function setGalleryNavMeta(m: GalleryNavMeta | null): void {
  meta = m
}

/** 图库 effect 消费:方向键移动过才滚动,取走即清 */
export function consumeNavJustMoved(): boolean {
  const v = navJustMoved
  navJustMoved = false
  return v
}

const flatStep = (key: string): number => (key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1)

/** 从 items 推列数(列表恒 1;网格/瀑布流取最大 dev+1,末行不满也正确) */
function inferCols(items: GalleryNavItem[]): number {
  let max = 0
  for (const it of items) if (it.dev > max) max = it.dev
  return max + 1
}

/** 瀑布流跨列:目标列取与当前项 y 重叠最大者,无重叠取中心距最近者 */
function neighborByColumn(items: GalleryNavItem[], cur: GalleryNavItem, dev: number): GalleryNavItem | null {
  let best: GalleryNavItem | null = null
  let bestScore = -Infinity
  for (const it of items) {
    if (it.dev !== dev) continue
    const overlap = Math.min(it.y + it.h, cur.y + cur.h) - Math.max(it.y, cur.y)
    const score = overlap > 0 ? overlap : -Math.abs(it.y + it.h / 2 - (cur.y + cur.h / 2))
    if (score > bestScore) {
      best = it
      bestScore = score
    }
  }
  return best
}

/** 不带扩选的方向键移动:返回目标 id(无可移动目标返回 null) */
function stepTarget(key: string, curId: string, flat: { id: string }[]): string | null {
  const idx = flat.findIndex((a) => a.id === curId)
  if (idx === -1) return flat[0]?.id ?? null
  const clampStep = (d: number): string | null =>
    flat[Math.min(Math.max(idx + d, 0), flat.length - 1)]?.id ?? null
  const cur = meta?.items.find((it) => it.id === curId)
  if (!meta || meta.items.length === 0 || !cur || meta.mode === 'list') return clampStep(flatStep(key))
  if (meta.mode === 'grid') {
    const cols = inferCols(meta.items)
    const d = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : key === 'ArrowDown' ? cols : -cols
    return clampStep(d)
  }
  // 瀑布流:上下沿同列,左右跨相邻列(几何最近邻);该方向没有邻居则原地不动
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    const col = meta.items.filter((it) => it.dev === cur.dev).sort((a, b) => a.y - b.y)
    const i = col.findIndex((it) => it.id === curId)
    return col[i + (key === 'ArrowDown' ? 1 : -1)]?.id ?? null
  }
  return neighborByColumn(meta.items, cur, cur.dev + (key === 'ArrowRight' ? 1 : -1))?.id ?? null
}

/**
 * 方向键导航统一入口。extend=false:移动选中并刷新锚点;
 * extend=true:从锚点(失效时退化为当前末位选中)到目标按平铺顺序扩选,锚点保持不动。
 * 平铺顺序在网格/列表下即视觉顺序;瀑布流的列序与平铺序不同,扩选按平铺序取区间(可接受)。
 */
export function galleryNavMove(
  key: string,
  selection: string[],
  flat: { id: string }[],
  extend: boolean
): string[] {
  if (flat.length === 0) return selection
  const curId = selection[selection.length - 1] ?? ''
  const target = curId ? stepTarget(key, curId, flat) : (flat[0]?.id ?? null)
  // 目标必须是现行列表里的 id(元数据在布局变化后短暂滞后,防串到已消失的素材)
  if (!target || (curId && !flat.some((a) => a.id === target))) return selection
  if (!extend) {
    anchor = target
    navJustMoved = true
    return [target]
  }
  const anchorValid = anchor !== null && flat.some((a) => a.id === anchor)
  const startId = anchorValid ? anchor : curId
  if (!anchorValid) anchor = curId || target
  const ai = flat.findIndex((a) => a.id === startId)
  const bi = flat.findIndex((a) => a.id === target)
  if (ai === -1 || bi === -1) return [target]
  const [lo, hi] = ai <= bi ? [ai, bi] : [bi, ai]
  navJustMoved = true
  return flat.slice(lo, hi + 1).map((a) => a.id)
}
