import { memo } from 'react'
import SelectionActions from './SelectionActions'

/**
 * 选区操作条（里程碑 195）：多选时浮在图库底部。
 * 里程碑 232：动作本体抽到 <SelectionActions>，与右侧详情栏共用；
 * 这条底部条现在只在详情栏收起时出现（避免两处重复入口），位置按左右面板实际占用居中。
 */
function SelectionBar({ leftInset, rightInset }: { leftInset: number; rightInset: number }) {
  const width = `calc(100vw - ${leftInset}px - ${rightInset}px - 2rem)`
  const left = `calc(${leftInset}px + (100vw - ${leftInset}px - ${rightInset}px) / 2)`

  return (
    <div
      role="toolbar"
      aria-label="选区操作"
      data-testid="selection-bar"
      className="anim-dialog menu fixed bottom-5 z-[90] flex flex-wrap items-center gap-1.5 px-2.5 py-1.5"
      style={{ left, transform: 'translateX(-50%)', width, maxWidth: 760 }}
    >
      <SelectionActions layout="row" />
    </div>
  )
}

export default memo(SelectionBar)
