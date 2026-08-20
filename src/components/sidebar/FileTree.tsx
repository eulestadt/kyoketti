import { useEffect, useState, type DragEvent } from 'react'
import { ancestorIds, collectFolderIds, findVaultNode } from '../../lib/vaultTree'
import {
  FilePlus,
  FolderPlus,
  ChevronRight,
  ChevronDown,
  FileText,
  Folder,
  MoreHorizontal,
  Table2,
  LayoutDashboard,
  Image,
} from 'lucide-react'
import { useApp } from '../../hooks/useApp'
import { displayNoteName, ensureMarkdownFileName } from '../../lib/noteNames'
import { ensureBaseFileName, isBaseFileName } from '../../lib/bases'
import { ensureCanvasFileName, isCanvasFileName } from '../../lib/canvas'
import { isImageFileName } from '../../lib/media'
import type { VaultNode } from '../../types'
import { compactItems, ContextMenu, useContextMenu, type ContextMenuItem } from '../ui/ContextMenu'
import { noteMenuItems, promptFileRename } from '../ui/noteMenu'
import './FileTree.css'

const VAULT_DND = 'application/x-kyoketti-node'

type MenuTarget =
  | { kind: 'file'; node: VaultNode }
  | { kind: 'folder'; node: VaultNode }

export function FileTree() {
  const {
    tree,
    vault,
    openFile,
    activeFileId,
    createNote,
    createBase,
    createCanvas,
    createDirectory,
    renameNode,
    moveNode,
    deleteNode,
    duplicateFile,
    loadingVault,
    index,
    revealRequest,
    treeExpandRequest,
  } = useApp()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const { menu, open, close } = useContextMenu<MenuTarget>()

  useEffect(() => {
    if (vault?.folderId) {
      setExpanded(new Set([vault.folderId]))
    }
  }, [vault?.folderId])

  useEffect(() => {
    if (!revealRequest || !tree) return
    const ancestors = ancestorIds(tree, revealRequest.id)
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const id of ancestors) next.add(id)
      return next
    })
    const timer = window.setTimeout(() => {
      const el = document.querySelector(`[data-file-id="${CSS.escape(revealRequest.id)}"]`)
      el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }, 40)
    return () => window.clearTimeout(timer)
  }, [revealRequest, tree])

  useEffect(() => {
    if (!treeExpandRequest || !tree) return
    if (treeExpandRequest.mode === 'expand') {
      setExpanded(new Set(collectFolderIds(tree)))
      return
    }
    setExpanded(new Set(vault?.folderId ? [vault.folderId] : []))
  }, [treeExpandRequest, tree, vault?.folderId])

  if (!tree) {
    return <div className="file-tree empty">{loadingVault ? 'Loading files…' : 'No vault loaded'}</div>
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function onCreateNote(parentId: string) {
    const name = window.prompt('New note name', 'Untitled')
    if (!name?.trim()) return
    await createNote(parentId, ensureMarkdownFileName(name))
  }

  async function onCreateBase(parentId: string) {
    const name = window.prompt('New base name', 'Untitled')
    if (!name?.trim()) return
    await createBase(parentId, ensureBaseFileName(name))
  }

  async function onCreateCanvas(parentId: string) {
    const name = window.prompt('New canvas name', 'Untitled')
    if (!name?.trim()) return
    await createCanvas(parentId, ensureCanvasFileName(name))
  }

  async function onCreateFolder(parentId: string) {
    const name = window.prompt('New folder name', 'New folder')
    if (!name) return
    await createDirectory(parentId, name)
  }

  async function onRename(node: VaultNode) {
    const nextName = promptFileRename(node.name, node.isFolder)
    if (!nextName) return
    await renameNode(node.id, nextName)
  }

  async function onDelete(node: VaultNode) {
    const label = node.isFolder ? node.name : displayNoteName(node.name)
    if (!window.confirm(`Move “${label}” to trash?`)) return
    await deleteNode(node.id)
  }

  function vaultDragId(event: DragEvent<HTMLElement>): string {
    return event.dataTransfer.getData(VAULT_DND) || dragId || ''
  }

  function canDropOnFolder(sourceId: string, folderId: string): boolean {
    if (!sourceId || sourceId === folderId || !tree) return false
    const source = findVaultNode(tree, sourceId)
    if (!source) return false
    if (source.parentId === folderId) return false
    if (source.isFolder && (findVaultNode(source, folderId) || folderId === source.id)) return false
    return true
  }

  function onFolderDragOver(event: DragEvent<HTMLElement>, folderId: string) {
    const types = [...event.dataTransfer.types]
    if (!dragId && !types.includes(VAULT_DND)) return
    const sourceId = dragId || ''
    if (sourceId && !canDropOnFolder(sourceId, folderId)) {
      event.dataTransfer.dropEffect = 'none'
      return
    }
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setDropTargetId(folderId)
    setExpanded((prev) => {
      if (prev.has(folderId)) return prev
      const next = new Set(prev)
      next.add(folderId)
      return next
    })
  }

  async function onFolderDrop(event: DragEvent<HTMLElement>, folderId: string) {
    event.preventDefault()
    event.stopPropagation()
    const sourceId = vaultDragId(event)
    setDropTargetId(null)
    setDragId(null)
    if (!sourceId || !canDropOnFolder(sourceId, folderId)) return
    await moveNode(sourceId, folderId)
  }

  function folderItems(node: VaultNode): ContextMenuItem[] {
    const isRoot = node.id === vault?.folderId
    return compactItems([
      { label: 'New note', onClick: () => void onCreateNote(node.id) },
      { label: 'New folder', onClick: () => void onCreateFolder(node.id) },
      { label: 'New base', onClick: () => void onCreateBase(node.id) },
      { label: 'New canvas', onClick: () => void onCreateCanvas(node.id) },
      !isRoot && { type: 'separator' as const },
      !isRoot && { label: 'Rename', onClick: () => void onRename(node) },
      !isRoot && {
        label: 'Delete',
        danger: true,
        onClick: () => void onDelete(node),
      },
    ])
  }

  function fileItems(node: VaultNode): ContextMenuItem[] {
    return noteMenuItems(
      node,
      { openFile, renameNode, deleteNode, duplicateFile, index },
      { open: true, rename: true, duplicate: true, remove: true },
    )
  }

  function renderNode(node: VaultNode, depth: number) {
    const isOpen = expanded.has(node.id)
    const isActive = activeFileId === node.id

    if (node.isFolder) {
      const isDropTarget = dropTargetId === node.id
      return (
        <div key={node.id} className="tree-node">
          <div
            className={`tree-row folder ${isActive ? 'active' : ''} ${isDropTarget ? 'drop-target' : ''} ${dragId === node.id ? 'is-dragging' : ''}`}
            data-file-id={node.id}
            style={{ paddingLeft: 8 + depth * 12 }}
            draggable={node.id !== vault?.folderId}
            onDragStart={(e) => {
              if ((e.target as HTMLElement).closest('.tree-actions')) {
                e.preventDefault()
                return
              }
              e.dataTransfer.setData(VAULT_DND, node.id)
              e.dataTransfer.effectAllowed = 'move'
              setDragId(node.id)
            }}
            onDragEnd={() => {
              setDragId(null)
              setDropTargetId(null)
            }}
            onDragOver={(e) => onFolderDragOver(e, node.id)}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setDropTargetId((cur) => (cur === node.id ? null : cur))
              }
            }}
            onDrop={(e) => void onFolderDrop(e, node.id)}
            onContextMenu={(e) => open(e, { kind: 'folder', node })}
          >
            <button className="tree-main" onClick={() => toggle(node.id)}>
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <Folder size={14} />
              <span>{node.name || vault?.folderName}</span>
            </button>
            <div className="tree-actions">
              <button title="New note" onClick={() => void onCreateNote(node.id)}>
                <FilePlus size={13} />
              </button>
              <button title="New base" onClick={() => void onCreateBase(node.id)}>
                <Table2 size={13} />
              </button>
              <button title="New canvas" onClick={() => void onCreateCanvas(node.id)}>
                <LayoutDashboard size={13} />
              </button>
              <button title="New folder" onClick={() => void onCreateFolder(node.id)}>
                <FolderPlus size={13} />
              </button>
              <button
                title="More"
                onClick={(e) => open(e, { kind: 'folder', node })}
              >
                <MoreHorizontal size={13} />
              </button>
            </div>
          </div>
          {isOpen && (node.children ?? []).map((child) => renderNode(child, depth + 1))}
        </div>
      )
    }

    const Icon = isCanvasFileName(node.name)
      ? LayoutDashboard
      : isBaseFileName(node.name)
        ? Table2
        : isImageFileName(node.name)
          ? Image
          : FileText

    return (
      <div key={node.id} className="tree-node">
        <div
          className={`tree-row file ${isActive ? 'active' : ''} ${dragId === node.id ? 'is-dragging' : ''}`}
          data-file-id={node.id}
          style={{ paddingLeft: 8 + depth * 12 }}
          draggable
          onDragStart={(e) => {
            if ((e.target as HTMLElement).closest('.tree-actions')) {
              e.preventDefault()
              return
            }
            e.dataTransfer.setData(VAULT_DND, node.id)
            e.dataTransfer.effectAllowed = 'move'
            setDragId(node.id)
          }}
          onDragEnd={() => {
            setDragId(null)
            setDropTargetId(null)
          }}
          onDragOver={(e) => {
            const parentId = node.parentId ?? vault?.folderId
            if (parentId) onFolderDragOver(e, parentId)
          }}
          onDrop={(e) => {
            const parentId = node.parentId ?? vault?.folderId
            if (parentId) void onFolderDrop(e, parentId)
          }}
          onContextMenu={(e) => open(e, { kind: 'file', node })}
        >
          <button className="tree-main" onClick={() => void openFile(node.id)}>
            <span className="tree-spacer" />
            <Icon size={14} />
            <span>{displayNoteName(node.name)}</span>
          </button>
          <div className="tree-actions">
            <button title="More" onClick={(e) => open(e, { kind: 'file', node })}>
              <MoreHorizontal size={13} />
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="file-tree"
      onDragOver={(e) => {
        if (tree) onFolderDragOver(e, tree.id)
      }}
      onDrop={(e) => {
        if (tree) void onFolderDrop(e, tree.id)
      }}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('.tree-row')) return
        open(e, { kind: 'folder', node: tree })
      }}
    >
      {renderNode(tree, 0)}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.data.kind === 'folder' ? folderItems(menu.data.node) : fileItems(menu.data.node)}
          onClose={close}
        />
      )}
    </div>
  )
}
