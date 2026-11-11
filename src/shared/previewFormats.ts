/**
 * 可由主进程按需生成多档 LOD 预览的静态图格式。
 * GIF（保留动画）与 SVG（矢量直接渲染更清晰）不生成 LOD，白板回退原图。
 * 主进程 preview.ts 与渲染层 BoardCanvas 共用，避免两边格式清单漂移。
 */
export const PREVIEW_LOD_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'avif', 'tif', 'tiff'])
