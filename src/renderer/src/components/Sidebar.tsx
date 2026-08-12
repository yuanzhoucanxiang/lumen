import { useEffect, useMemo, useState } from 'react'
import { useLibraryStore } from '@renderer/stores/libraryStore'
import SmartFolderDialog from './SmartFolderDialog'
import SettingsModal from './SettingsModal'
import MergeTagDialog from './MergeTagDialog'
import TagManagerDialog from './TagManagerDialog'
import Icon from './Icon'
import ScrambleText from './ScrambleText'
import type { IconName } from './Icon'
import type { Folder, Tag } from '@shared/types'

/** 标签可选颜色 */
const TAG_COLORS = [
  '#e2604d', '#e8a33d', '#f5d76e', '#7fb069', '#46b8a0',
  '#4da9e9', '#7b8cde', '#b07cc6', '#e8a0b4', '#9aa0a9'
]

function NavItem({
  active,
  icon,
  label,
  count,
  dot,
  priority,
  excluded,
  onClick,
  onContextMenu
}: {
  active: boolean
  icon: IconName
  label: string
  count?: number
  /** 颜色点（标签颜色），设置时替代默认图标 */
  dot?: string
  /** 优先标签标记（⭐） */
  priority?: boolean
  /** 排除标签（AI 不使用，置灰 + ⊘） */
  excluded?: boolean
  onClick: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}) {
  return (
    <button
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`relative flex w-full cursor-pointer items-center gap-2.5 px-2.5 py-[7px] text-left text-[13px] transition-colors duration-100 ${
        active
          ? 'bg-[var(--accent-soft)] font-medium text-[var(--accent-text)]'
          : 'text-[var(--text-main)] hover:bg-[var(--bg-hover)]'
      }`}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-0 h-full w-[2px] bg-[var(--accent)]"
        />
      )}
      {dot ? (
        <span
          aria-hidden="true"
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: dot }}
        />
      ) : (
        <Icon
          name={icon}
          size={15}
          className={active ? 'text-[var(--accent-text)]' : 'text-[var(--text-dim)]'}
        />
      )}
      <span className={`min-w-0 flex-1 truncate ${excluded ? 'opacity-50' : ''}`}>
        {excluded && (
          <span className="mr-1 text-[10px] text-[var(--text-faint)]" aria-label="已排除">
            ⊘
          </span>
        )}
        {label}
      </span>
      {priority && (
        <span aria-label="优先标签" title="优先标签" className="text-[10px] text-[var(--accent)]">
          ⭐
        </span>
      )}
      {count !== undefined && count > 0 && (
        <span className="tnum mono text-[10px] text-[var(--text-faint)]">{count}</span>
      )}
    </button>
  )
}

function SectionHeader({
  title,
  onAdd,
  addLabel,
  onManage,
  manageLabel,
  collapsed,
  onToggle
}: {
  title: string
  onAdd?: () => void
  addLabel?: string
  onManage?: () => void
  manageLabel?: string
  /** 折叠态（整区可点击折叠） */
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <div className="mb-1 flex items-center justify-between border-b border-[var(--border)] px-1 pb-1.5 pt-0">
      <button
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? '展开' : '折叠'}${title}`}
        className="flex min-w-0 flex-1 items-center gap-1 text-left"
        onClick={onToggle}
      >
        <Icon
          name={collapsed ? 'chevronRight' : 'chevronDown'}
          size={10}
          className="shrink-0 text-[var(--text-faint)]"
        />
        <h3 className="section-title truncate">
          <span aria-hidden="true" className="pixel-dot" />
          {title}
        </h3>
      </button>
      {onManage && (
        <button
          aria-label={manageLabel ?? `管理${title}`}
          title={manageLabel ?? `管理${title}`}
          className="flex h-5 w-5 items-center justify-center text-[var(--text-dim)] transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)]"
          onClick={(e) => {
            e.stopPropagation()
            onManage()
          }}
        >
          <Icon name="settings" size={12} />
        </button>
      )}
      {onAdd && (
        <button
          aria-label={addLabel ?? `新建${title}`}
          title={addLabel ?? `新建${title}`}
          className="flex h-5 w-5 items-center justify-center text-[var(--text-dim)] transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)]"
          onClick={(e) => {
            e.stopPropagation()
            onAdd()
          }}
        >
          <Icon name="plus" size={13} strokeWidth={2} />
        </button>
      )}
    </div>
  )
}

export default function Sidebar() {
  const view = useLibraryStore((s) => s.view)
  const setView = useLibraryStore((s) => s.setView)
  const tags = useLibraryStore((s) => s.tags)
  const tagGroups = useLibraryStore((s) => s.tagGroups)
  const folders = useLibraryStore((s) => s.folders)
  const stats = useLibraryStore((s) => s.stats)
  const [addingFolder, setAddingFolder] = useState<false | { parentId: number | null }>(false)
  const [addingTag, setAddingTag] = useState(false)
  const [inputVal, setInputVal] = useState('')
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(new Set())
  const [renaming, setRenaming] = useState<{ kind: 'tag' | 'group'; id: number } | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [pendingAssign, setPendingAssign] = useState<number | null>(null) // 等待新建分组并移入的标签 id
  const [groupInput, setGroupInput] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; kind: 'folder' | 'tag' | 'tagGroup'; id: number } | null>(null)
  /** 待合并的源标签 id（打开 MergeTagDialog） */
  const [mergeSource, setMergeSource] = useState<number | null>(null)
  /** 标签管理对话框开关 */
  const [tagManagerOpen, setTagManagerOpen] = useState(false)
  const [smartDialog, setSmartDialog] = useState<{ open: boolean; edit: Folder | null }>({ open: false, edit: null })
  const [libs, setLibs] = useState<{ libraries: { name: string; path: string }[]; current: string } | null>(null)
  const [libMenuOpen, setLibMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [dropTargetFolder, setDropTargetFolder] = useState<number | null>(null)

  /* 分区折叠状态（localStorage 持久化）：文件夹/智能文件夹/标签 */
  type SectionKey = 'folders' | 'smart' | 'tags'
  const [sectionFold, setSectionFold] = useState<Record<SectionKey, boolean>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('lumen.sidebar.fold') ?? '{}') as Partial<
        Record<SectionKey, boolean>
      >
      return { folders: !!saved.folders, smart: !!saved.smart, tags: !!saved.tags }
    } catch {
      return { folders: false, smart: false, tags: false }
    }
  })
  const toggleSection = (key: SectionKey): void => {
    setSectionFold((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      try {
        localStorage.setItem('lumen.sidebar.fold', JSON.stringify(next))
      } catch {
        /* 隐私模式等场景忽略 */
      }
      return next
    })
  }
  /** 展开的分区：平分空间 + 内容独立滚动；折叠：只占标题 */
  const sectionCls = (collapsed: boolean): string =>
    collapsed ? 'mt-3 shrink-0 px-2' : 'mt-3 flex min-h-0 flex-1 flex-col px-2'

  const ASSET_MIME = 'application/x-eaglelike-assets'

  /** 拖拽素材放入文件夹 */
  const dropOnFolder = async (e: React.DragEvent, folderId: number, folderName: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDropTargetFolder(null)
    const data = e.dataTransfer.getData(ASSET_MIME)
    if (!data) return
    try {
      const ids = JSON.parse(data) as string[]
      if (ids.length === 0) return
      await window.api.addAssetsToFolder(ids, folderId)
      useLibraryStore.getState().showToast(`已将 ${ids.length} 个素材添加到「${folderName}」`)
      await useLibraryStore.getState().refreshFolders()
      const v = useLibraryStore.getState().view
      if (v.type === 'folder' && v.id === folderId) {
        await useLibraryStore.getState().refreshAssets()
      }
    } catch {
      /* 非法拖拽数据忽略 */
    }
  }

  useEffect(() => {
    void window.api.listLibraries().then(setLibs)
  }, [])

  const currentLib = libs?.libraries.find((l) => l.path === libs.current)

  const switchTo = async (path: string) => {
    setLibMenuOpen(false)
    if (path === libs?.current) return
    await window.api.switchLibrary(path)
    setLibs(await window.api.listLibraries())
    useLibraryStore.getState().setView({ type: 'all' })
    await useLibraryStore.getState().refreshAll()
  }

  const openNewLib = async () => {
    setLibMenuOpen(false)
    const info = await window.api.chooseLibrary()
    if (info) {
      setLibs(await window.api.listLibraries())
      useLibraryStore.getState().setView({ type: 'all' })
      await useLibraryStore.getState().refreshAll()
    }
  }

  const normalFolders = folders.filter((f) => !f.isSmart)
  const smartFolders = folders
    .filter((f) => f.isSmart)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))

  /* 标签按分组聚合（含空分组，便于管理），组内按 count 降序 */
  const { grouped, ungroupedTags } = useMemo(() => {
    const byCount = (a: Tag, b: Tag) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN')
    const byGroup = new Map<number, Tag[]>()
    const ungrouped: Tag[] = []
    for (const t of tags) {
      if (t.groupId != null) {
        const list = byGroup.get(t.groupId) ?? []
        list.push(t)
        byGroup.set(t.groupId, list)
      } else {
        ungrouped.push(t)
      }
    }
    return {
      grouped: tagGroups.map((g) => ({ group: g, tags: (byGroup.get(g.id) ?? []).sort(byCount) })),
      ungroupedTags: ungrouped.sort(byCount)
    }
  }, [tags, tagGroups])

  const toggleGroupCollapse = (id: number) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const submitRename = async () => {
    const name = renameVal.trim()
    if (name && renaming) {
      if (renaming.kind === 'tag') {
        await window.api.renameTag(renaming.id, name)
        await useLibraryStore.getState().refreshTags()
      } else {
        await window.api.renameTagGroup(renaming.id, name)
        await useLibraryStore.getState().refreshTagGroups()
      }
    }
    setRenaming(null)
    setRenameVal('')
  }

  /** 新建分组（可顺带把某个标签移入） */
  const submitNewGroup = async () => {
    const name = groupInput.trim()
    if (name) {
      const g = await window.api.createTagGroup(name)
      if (pendingAssign != null) {
        await window.api.assignTagToGroup(pendingAssign, g.id)
      }
      await useLibraryStore.getState().refreshTags()
      await useLibraryStore.getState().refreshTagGroups()
    }
    setPendingAssign(null)
    setGroupInput('')
  }

  const submitAdd = async () => {
    const name = inputVal.trim()
    if (name) {
      if (addingFolder) {
        await window.api.createFolder(name, addingFolder.parentId)
        await useLibraryStore.getState().refreshFolders()
      } else if (addingTag) {
        await window.api.createTag(name)
        await useLibraryStore.getState().refreshTags()
      }
    }
    setAddingFolder(false)
    setAddingTag(false)
    setInputVal('')
  }

  const toggleCollapse = (id: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /* 多级文件夹树：平铺列表 → 树（按名称排序，含折叠状态） */
  type FolderNode = Folder & { children: FolderNode[] }
  const folderTree = useMemo<FolderNode[]>(() => {
    const map = new Map<number, FolderNode>()
    for (const f of normalFolders) map.set(f.id, { ...f, children: [] })
    const roots: FolderNode[] = []
    for (const n of map.values()) {
      const parent = n.parentId != null ? map.get(n.parentId) : undefined
      if (parent) parent.children.push(n)
      else roots.push(n)
    }
    const sortRec = (list: FolderNode[]): void => {
      // 按包含素材数量降序（多的在上），数量相同按名称
      list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))
      list.forEach((l) => sortRec(l.children))
    }
    sortRec(roots)
    return roots
  }, [normalFolders])

  const addFolderInput = (
    <input
      autoFocus
      aria-label="新文件夹名称"
      className="field-input w-full"
      placeholder="文件夹名称…"
      value={inputVal}
      onChange={(e) => setInputVal(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void submitAdd()
        if (e.key === 'Escape') setAddingFolder(false)
      }}
      onBlur={() => void submitAdd()}
    />
  )

  /** 递归渲染文件夹节点（缩进 + 折叠箭头 + 可拖放） */
  const renderFolderNode = (node: FolderNode, depth: number): React.ReactNode => {
    const hasKids = node.children.length > 0
    const isCollapsed = collapsed.has(node.id)
    return (
      <div key={node.id}>
        <div
          className={`flex items-center transition-shadow duration-100 ${
            dropTargetFolder === node.id
              ? 'bg-[var(--accent-soft)] outline outline-1 outline-[var(--accent)]'
              : ''
          }`}
          style={{ paddingLeft: depth * 14 }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(ASSET_MIME)) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
              if (dropTargetFolder !== node.id) setDropTargetFolder(node.id)
            }
          }}
          onDragLeave={() => {
            if (dropTargetFolder === node.id) setDropTargetFolder(null)
          }}
          onDrop={(e) => void dropOnFolder(e, node.id, node.name)}
        >
          {hasKids ? (
            <button
              aria-label={isCollapsed ? `展开 ${node.name}` : `折叠 ${node.name}`}
              className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--text-faint)] transition-colors duration-100 hover:text-[var(--text-main)]"
              onClick={(e) => {
                e.stopPropagation()
                toggleCollapse(node.id)
              }}
            >
              <Icon name={isCollapsed ? 'chevronRight' : 'chevronDown'} size={10} />
            </button>
          ) : (
            <span aria-hidden="true" className="w-4 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <NavItem
              active={view.type === 'folder' && view.id === node.id}
              icon="folder"
              label={node.name}
              count={node.count}
              onClick={() => setView({ type: 'folder', id: node.id })}
              onContextMenu={(e) => openMenu(e, 'folder', node.id)}
            />
          </div>
        </div>
        {addingFolder && addingFolder.parentId === node.id && (
          <div style={{ paddingLeft: (depth + 1) * 14 + 16 }}>{addFolderInput}</div>
        )}
        {!isCollapsed && node.children.map((c) => renderFolderNode(c, depth + 1))}
      </div>
    )
  }

  /** 打开右键菜单（按菜单高度钳制，避免超出视口） */
  const MENU_H: Record<'folder' | 'tag' | 'tagGroup', number> = { folder: 130, tag: 290, tagGroup: 110 }
  const openMenu = (e: React.MouseEvent, kind: 'folder' | 'tag' | 'tagGroup', id: number): void => {
    e.preventDefault()
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - 200),
      y: Math.min(e.clientY, window.innerHeight - MENU_H[kind]),
      kind,
      id
    })
  }

  /** 标签行（或重命名输入） */
  const renderTag = (t: Tag): React.ReactNode => {
    if (renaming?.kind === 'tag' && renaming.id === t.id) {
      return (
        <input
          key={t.id}
          autoFocus
          aria-label="重命名标签"
          className="field-input w-full px-1.5 py-0.5 text-[11px]"
          value={renameVal}
          onChange={(e) => setRenameVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submitRename()
            if (e.key === 'Escape') setRenaming(null)
          }}
          onBlur={() => void submitRename()}
        />
      )
    }
    return (
      <NavItem
        key={t.id}
        active={view.type === 'tag' && view.id === t.id}
        icon="tag"
        dot={t.color || undefined}
        label={t.name}
        priority={t.priority === 1}
        excluded={t.excluded === 1}
        count={t.count}
        onClick={() => setView({ type: 'tag', id: t.id })}
        onContextMenu={(e) => openMenu(e, 'tag', t.id)}
      />
    )
  }

  return (
    <nav
      aria-label="素材库导航"
      className="flex w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-panel)]"
      onClick={() => setMenu(null)}
    >
      {/* 品牌区 */}
      <header className="border-b border-[var(--border)] px-4 py-3.5">
        <h1 className="glitch text-[15px] font-semibold leading-4 tracking-[0.35em]" data-text="LUMEN">
          LUMEN
        </h1>
        <ScrambleText
          className="mono mt-1.5 block text-[10px] uppercase tracking-[0.14em] text-[var(--text-faint)]"
          text={`ARCHIVE // ${String(stats.total).padStart(3, '0')}`}
        />
      </header>

      {/* 主导航 */}
      <div className="mt-2 space-y-px px-2">
        <NavItem
          active={view.type === 'all'}
          icon="grid"
          label="全部素材"
          count={stats.total}
          onClick={() => setView({ type: 'all' })}
        />
        <NavItem
          active={view.type === 'starred'}
          icon="star"
          label="已收藏"
          onClick={() => setView({ type: 'starred' })}
        />
        <NavItem
          active={view.type === 'trash'}
          icon="trash"
          label="回收站"
          count={stats.deleted}
          onClick={() => setView({ type: 'trash' })}
        />
      </div>

      {/* 文件夹 */}
      <section className={sectionCls(sectionFold.folders)} aria-label="文件夹">
        <SectionHeader
          title="文件夹"
          addLabel="新建文件夹"
          collapsed={sectionFold.folders}
          onToggle={() => toggleSection('folders')}
          onAdd={() => {
            setAddingFolder({ parentId: null })
            setAddingTag(false)
            setInputVal('')
          }}
        />
        {!sectionFold.folders && (
          <div className="modal-scroll min-h-0 flex-1 space-y-px overflow-y-auto">
          {addingFolder && addingFolder.parentId === null && addFolderInput}
          {folderTree.map((node) => renderFolderNode(node, 0))}
          {folderTree.length === 0 && !addingFolder && (
            <p className="px-2.5 py-1 text-[11px] text-[var(--text-faint)]">暂无文件夹</p>
          )}
          </div>
        )}
      </section>

      {/* 智能文件夹 */}
      <section className={sectionCls(sectionFold.smart)} aria-label="智能文件夹">
        <SectionHeader
          title="智能文件夹"
          addLabel="新建智能文件夹"
          collapsed={sectionFold.smart}
          onToggle={() => toggleSection('smart')}
          onAdd={() => setSmartDialog({ open: true, edit: null })}
        />
        {!sectionFold.smart && (
          <div className="modal-scroll min-h-0 flex-1 space-y-px overflow-y-auto">
          {smartFolders.map((f) => (
            <NavItem
              key={f.id}
              active={view.type === 'folder' && view.id === f.id}
              icon="sparkles"
              label={f.name}
              count={f.count}
              onClick={() => setView({ type: 'folder', id: f.id })}
              onContextMenu={(e) => openMenu(e, 'folder', f.id)}
            />
          ))}
          {smartFolders.length === 0 && (
            <p className="px-2.5 py-1 text-[11px] text-[var(--text-faint)]">按条件自动聚合素材</p>
          )}
          </div>
        )}
      </section>

      {/* 标签 */}
      <section className={`${sectionCls(sectionFold.tags)} pb-2`} aria-label="标签">
        <SectionHeader
          title="标签"
          addLabel="新建标签"
          collapsed={sectionFold.tags}
          onToggle={() => toggleSection('tags')}
          onManage={() => setTagManagerOpen(true)}
          manageLabel="管理标签"
          onAdd={() => {
            setAddingTag(true)
            setAddingFolder(false)
            setInputVal('')
          }}
        />
        {!sectionFold.tags && (
          <div className="modal-scroll min-h-0 flex-1 space-y-px overflow-y-auto">
          {addingTag && (
            <input
              autoFocus
              aria-label="新标签名称"
              className="field-input w-full"
              placeholder="标签名称…"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitAdd()
                if (e.key === 'Escape') setAddingTag(false)
              }}
              onBlur={() => void submitAdd()}
            />
          )}
          {pendingAssign !== null && (
            <input
              autoFocus
              aria-label="新分组名称"
              className="field-input w-full"
              placeholder="新建分组并移入…"
              value={groupInput}
              onChange={(e) => setGroupInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitNewGroup()
                if (e.key === 'Escape') {
                  setPendingAssign(null)
                  setGroupInput('')
                }
              }}
              onBlur={() => void submitNewGroup()}
            />
          )}

          {/* 分组 */}
          {grouped.map(({ group, tags: gts }) => (
            <div key={group.id}>
              <div className="flex items-center">
                <button
                  aria-label={collapsedGroups.has(group.id) ? `展开分组 ${group.name}` : `折叠分组 ${group.name}`}
                  className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--text-faint)] transition-colors duration-100 hover:text-[var(--text-main)]"
                  onClick={() => toggleGroupCollapse(group.id)}
                >
                  <Icon name={collapsedGroups.has(group.id) ? 'chevronRight' : 'chevronDown'} size={10} />
                </button>
                {renaming?.kind === 'group' && renaming.id === group.id ? (
                  <input
                    autoFocus
                    aria-label="重命名分组"
                    className="field-input min-w-0 flex-1 px-1.5 py-0.5 text-[11px]"
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void submitRename()
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                    onBlur={() => void submitRename()}
                  />
                ) : (
                  <button
                    className="flex min-w-0 flex-1 items-center gap-1.5 px-1 py-0.5 text-left"
                    onClick={() => toggleGroupCollapse(group.id)}
                    onContextMenu={(e) => openMenu(e, 'tagGroup', group.id)}
                  >
                    <span className="section-title truncate">{group.name}</span>
                    <span className="mono ml-auto text-[10px] text-[var(--text-faint)]">{gts.length}</span>
                  </button>
                )}
              </div>
              {!collapsedGroups.has(group.id) && (
                <div style={{ paddingLeft: 14 }}>
                  {gts.map((t) => renderTag(t))}
                  {gts.length === 0 && (
                    <p className="px-2.5 py-0.5 text-[10px] text-[var(--text-faint)]">空分组</p>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* 未分组标签 */}
          {ungroupedTags.map((t) => renderTag(t))}

          {tags.length === 0 && !addingTag && (
            <p className="px-2.5 py-1 text-[11px] text-[var(--text-faint)]">暂无标签</p>
          )}
          </div>
        )}
      </section>

      {/* 右键菜单 */}
      {menu && (
        <div
          role="menu"
          className="anim-menu menu fixed z-[300] py-1"
          style={{ left: menu.x, top: menu.y, width: menu.kind === 'tag' ? 176 : 144 }}
        >
          {/* 文件夹菜单 */}
          {menu.kind === 'folder' && folders.find((f) => f.id === menu.id)?.isSmart === 1 && (
            <button
              role="menuitem"
              className="block w-full cursor-pointer px-4 py-1.5 text-left text-[12px] hover:bg-[var(--bg-hover)]"
              onClick={() => {
                const f = folders.find((x) => x.id === menu.id) ?? null
                setSmartDialog({ open: true, edit: f })
                setMenu(null)
              }}
            >
              编辑条件
            </button>
          )}
          {menu.kind === 'folder' && folders.find((f) => f.id === menu.id)?.isSmart === 0 && (
            <button
              role="menuitem"
              className="block w-full cursor-pointer px-4 py-1.5 text-left text-[12px] hover:bg-[var(--bg-hover)]"
              onClick={() => {
                const pid = menu.id
                setCollapsed((prev) => {
                  const next = new Set(prev)
                  next.delete(pid)
                  return next
                })
                setAddingFolder({ parentId: pid })
                setAddingTag(false)
                setInputVal('')
                setMenu(null)
              }}
            >
              新建子文件夹
            </button>
          )}
          {menu.kind === 'folder' && (
            <button
              role="menuitem"
              className="block w-full cursor-pointer px-4 py-1.5 text-left text-[12px] text-[var(--danger)] hover:bg-[var(--bg-hover)]"
              onClick={async () => {
                await window.api.deleteFolder(menu.id)
                await useLibraryStore.getState().refreshFolders()
                if (view.type === 'folder' && view.id === menu.id) setView({ type: 'all' })
                setMenu(null)
              }}
            >
              删除
            </button>
          )}

          {/* 标签菜单：颜色 / 重命名 / 移动到分组 / 删除 */}
          {menu.kind === 'tag' && (
            <>
              <div className="flex items-center gap-1.5 px-3.5 py-2">
                {TAG_COLORS.map((c) => {
                  const cur = tags.find((t) => t.id === menu.id)?.color === c
                  return (
                    <button
                      key={c}
                      aria-label={`设置标签颜色 ${c}`}
                      aria-pressed={cur}
                      className={`h-4 w-4 rounded-full transition-transform duration-100 hover:scale-110 ${
                        cur ? 'ring-2 ring-white/70 ring-offset-1 ring-offset-transparent' : ''
                      }`}
                      style={{ background: c }}
                      onClick={async () => {
                        await window.api.setTagColor(menu.id, c)
                        await useLibraryStore.getState().refreshTags()
                        setMenu(null)
                      }}
                    />
                  )
                })}
                <button
                  aria-label="清除颜色"
                  title="清除颜色"
                  className="flex h-4 w-4 items-center justify-center rounded-full border border-[var(--border-strong)] text-[9px] text-[var(--text-faint)] hover:text-[var(--text-main)]"
                  onClick={async () => {
                    await window.api.setTagColor(menu.id, '')
                    await useLibraryStore.getState().refreshTags()
                    setMenu(null)
                  }}
                >
                  ×
                </button>
              </div>
              <div className="my-1 border-t border-[var(--border)]" />
              <button
                role="menuitem"
                className="block w-full cursor-pointer px-4 py-1.5 text-left text-[12px] hover:bg-[var(--bg-hover)]"
                onClick={() => {
                  setRenaming({ kind: 'tag', id: menu.id })
                  setRenameVal(tags.find((t) => t.id === menu.id)?.name ?? '')
                  setMenu(null)
                }}
              >
                重命名
              </button>
              <button
                role="menuitem"
                className="block w-full cursor-pointer px-4 py-1.5 text-left text-[12px] hover:bg-[var(--bg-hover)]"
                onClick={async () => {
                  const cur = tags.find((t) => t.id === menu.id)
                  await window.api.setTagPriority(menu.id, cur?.priority === 1 ? 0 : 1)
                  await useLibraryStore.getState().refreshTags()
                  setMenu(null)
                }}
              >
                {tags.find((t) => t.id === menu.id)?.priority === 1 ? '取消优先' : '设为优先标签 ⭐'}
              </button>
              <button
                role="menuitem"
                className="block w-full cursor-pointer px-4 py-1.5 text-left text-[12px] hover:bg-[var(--bg-hover)]"
                onClick={async () => {
                  const cur = tags.find((t) => t.id === menu.id)
                  await window.api.setTagExcluded(menu.id, cur?.excluded === 1 ? 0 : 1)
                  await useLibraryStore.getState().refreshTags()
                  setMenu(null)
                }}
              >
                {tags.find((t) => t.id === menu.id)?.excluded === 1 ? '取消排除' : '排除标签 ⊘（AI 不使用）'}
              </button>
              <button
                role="menuitem"
                className="block w-full cursor-pointer px-4 py-1.5 text-left text-[12px] hover:bg-[var(--bg-hover)]"
                onClick={() => {
                  setMergeSource(menu.id)
                  setMenu(null)
                }}
              >
                合并到其他标签…
              </button>
              <div className="relative group/tg">
                <button
                  role="menuitem"
                  className="block w-full cursor-pointer px-4 py-1.5 text-left text-[12px] hover:bg-[var(--bg-hover)]"
                >
                  移动到分组 ▸
                </button>
                <div className="menu absolute left-full top-0 hidden w-40 py-1 group-hover/tg:block">
                  <button
                    className="block w-full cursor-pointer px-3 py-1.5 text-left text-[12px] hover:bg-[var(--bg-hover)]"
                    onClick={async () => {
                      await window.api.assignTagToGroup(menu.id, null)
                      await useLibraryStore.getState().refreshTags()
                      setMenu(null)
                    }}
                  >
                    未分组
                  </button>
                  {tagGroups.map((g) => (
                    <button
                      key={g.id}
                      className="block w-full cursor-pointer truncate px-3 py-1.5 text-left text-[12px] hover:bg-[var(--bg-hover)]"
                      onClick={async () => {
                        await window.api.assignTagToGroup(menu.id, g.id)
                        await useLibraryStore.getState().refreshTags()
                        setMenu(null)
                      }}
                    >
                      {g.name}
                    </button>
                  ))}
                  <div className="my-1 border-t border-[var(--border)]" />
                  <button
                    className="block w-full cursor-pointer px-3 py-1.5 text-left text-[12px] text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                    onClick={() => {
                      setPendingAssign(menu.id)
                      setGroupInput('')
                      setMenu(null)
                    }}
                  >
                    ＋ 新建分组并移入…
                  </button>
                </div>
              </div>
              <div className="my-1 border-t border-[var(--border)]" />
              <button
                role="menuitem"
                className="block w-full cursor-pointer px-4 py-1.5 text-left text-[12px] text-[var(--danger)] hover:bg-[var(--bg-hover)]"
                onClick={async () => {
                  await window.api.deleteTag(menu.id)
                  await useLibraryStore.getState().refreshTags()
                  if (view.type === 'tag' && view.id === menu.id) setView({ type: 'all' })
                  setMenu(null)
                }}
              >
                删除
              </button>
            </>
          )}

          {/* 分组菜单 */}
          {menu.kind === 'tagGroup' && (
            <>
              <button
                role="menuitem"
                className="block w-full cursor-pointer px-4 py-1.5 text-left text-[12px] hover:bg-[var(--bg-hover)]"
                onClick={() => {
                  setRenaming({ kind: 'group', id: menu.id })
                  setRenameVal(tagGroups.find((g) => g.id === menu.id)?.name ?? '')
                  setMenu(null)
                }}
              >
                重命名
              </button>
              <button
                role="menuitem"
                className="block w-full cursor-pointer px-4 py-1.5 text-left text-[12px] text-[var(--danger)] hover:bg-[var(--bg-hover)]"
                onClick={async () => {
                  await window.api.deleteTagGroup(menu.id)
                  await useLibraryStore.getState().refreshTags()
                  await useLibraryStore.getState().refreshTagGroups()
                  setMenu(null)
                }}
              >
                删除分组（标签保留）
              </button>
            </>
          )}
        </div>
      )}

      {smartDialog.open && (
        <SmartFolderDialog editFolder={smartDialog.edit} onClose={() => setSmartDialog({ open: false, edit: null })} />
      )}

      {/* 状态行 */}
      <div className="mono flex items-center gap-1.5 border-t border-[var(--border)] px-3.5 pt-2 text-[9.5px] uppercase tracking-[0.16em] text-[var(--text-faint)]">
        <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
        SYNC · LOCAL DB · OK
      </div>

      {/* 库切换器 + 设置 */}
      <footer className="relative flex items-center gap-1 p-2">
        {libMenuOpen && libs && (
          <div className="anim-menu menu absolute bottom-full left-2 right-2 z-[250] mb-1.5 py-1">
            {libs.libraries.map((l) => (
              <div
                key={l.path}
                className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-[var(--bg-hover)] ${
                  l.path === libs.current ? 'text-[var(--accent-text)]' : ''
                }`}
                onClick={() => void switchTo(l.path)}
              >
                <span className="min-w-0 truncate">
                  {l.path === libs.current ? '● ' : ''}
                  {l.name}
                </span>
                {libs.libraries.length > 1 && (
                  <button
                    aria-label={`从列表移除 ${l.name}`}
                    className="ml-auto flex items-center text-[var(--text-dim)] hover:text-[var(--danger)]"
                    title="从列表移除（不删除文件）"
                    onClick={async (e) => {
                      e.stopPropagation()
                      await window.api.removeLibrary(l.path)
                      setLibs(await window.api.listLibraries())
                      await useLibraryStore.getState().refreshAll()
                    }}
                  >
                    <Icon name="close" size={12} />
                  </button>
                )}
              </div>
            ))}
            <div className="my-1 border-t border-[var(--border)]" />
            <button
              className="block w-full cursor-pointer px-3 py-1.5 text-left text-[12px] text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
              onClick={() => void openNewLib()}
            >
              + 新建 / 打开其他库…
            </button>
          </div>
        )}
        <button
          aria-label="切换素材库"
          className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-[12px] transition-colors duration-100 hover:bg-[var(--bg-hover)]"
          onClick={() => setLibMenuOpen(!libMenuOpen)}
          title={libs?.current ?? ''}
        >
          <Icon name="library" size={15} className="text-[var(--text-dim)]" />
          <span className="min-w-0 flex-1 truncate text-left">{currentLib?.name ?? '…'}</span>
          <Icon
            name={libMenuOpen ? 'chevronDown' : 'chevronUp'}
            size={13}
            className="text-[var(--text-faint)]"
          />
        </button>
        <button
          aria-label="打开设置"
          className="flex items-center px-2 py-1.5 text-[var(--text-dim)] transition-colors duration-100 hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)]"
          title="设置"
          onClick={() => setSettingsOpen(true)}
        >
          <Icon name="settings" size={15} />
        </button>
      </footer>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {mergeSource !== null && (
        <MergeTagDialog
          sourceId={mergeSource}
          onClose={() => setMergeSource(null)}
        />
      )}
      {tagManagerOpen && <TagManagerDialog onClose={() => setTagManagerOpen(false)} />}
    </nav>
  )
}
