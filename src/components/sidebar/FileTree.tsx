import { useEffect, useState } from 'react'
import { ancestorIds, collectFolderIds } from '../../lib/vaultTree'
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
    deleteNode,
    duplicateFile,
    loadingVault,
    index,
    revealRequest,
    treeExpandRequest,
  } = useApp()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
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
      return (
        <div key={node.id} className="tree-node">
          <div
            className={`tree-row folder ${isActive ? 'active' : ''}`}
            data-file-id={node.id}
            style={{ paddingLeft: 8 + depth * 12 }}
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
          className={`tree-row file ${isActive ? 'active' : ''}`}
          data-file-id={node.id}
          style={{ paddingLeft: 8 + depth * 12 }}
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
