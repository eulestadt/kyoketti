import { useEffect, useState } from 'react'
import {
  FilePlus,
  FolderPlus,
  ChevronRight,
  ChevronDown,
  FileText,
  Folder,
  MoreHorizontal,
} from 'lucide-react'
import { useApp } from '../../hooks/useApp'
import type { VaultNode } from '../../types'
import './FileTree.css'

export function FileTree() {
  const { tree, vault, openFile, activeFileId, createNote, createDirectory, renameNode, deleteNode, loadingVault } =
    useApp()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [menuId, setMenuId] = useState<string | null>(null)

  useEffect(() => {
    if (vault?.folderId) {
      setExpanded(new Set([vault.folderId]))
    }
  }, [vault?.folderId])

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
    if (!name) return
    await createNote(parentId, name)
  }

  async function onCreateFolder(parentId: string) {
    const name = window.prompt('New folder name', 'New folder')
    if (!name) return
    await createDirectory(parentId, name)
  }

  async function onRename(node: VaultNode) {
    const name = window.prompt('Rename', node.name)
    if (!name || name === node.name) return
    await renameNode(node.id, name)
  }

  async function onDelete(node: VaultNode) {
    if (!window.confirm(`Move “${node.name}” to Drive trash?`)) return
    await deleteNode(node.id)
  }

  function renderNode(node: VaultNode, depth: number) {
    const isOpen = expanded.has(node.id)
    const isActive = activeFileId === node.id

    if (node.isFolder) {
      return (
        <div key={node.id} className="tree-node">
          <div className={`tree-row folder ${isActive ? 'active' : ''}`} style={{ paddingLeft: 8 + depth * 12 }}>
            <button className="tree-main" onClick={() => toggle(node.id)}>
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <Folder size={14} />
              <span>{node.name || vault?.folderName}</span>
            </button>
            <div className="tree-actions">
              <button title="New note" onClick={() => void onCreateNote(node.id)}>
                <FilePlus size={13} />
              </button>
              <button title="New folder" onClick={() => void onCreateFolder(node.id)}>
                <FolderPlus size={13} />
              </button>
              {node.id !== vault?.folderId && (
                <button title="More" onClick={() => setMenuId(menuId === node.id ? null : node.id)}>
                  <MoreHorizontal size={13} />
                </button>
              )}
            </div>
            {menuId === node.id && (
              <div className="tree-menu">
                <button onClick={() => { setMenuId(null); void onRename(node) }}>Rename</button>
                <button onClick={() => { setMenuId(null); void onDelete(node) }}>Delete</button>
              </div>
            )}
          </div>
          {isOpen && (node.children ?? []).map((child) => renderNode(child, depth + 1))}
        </div>
      )
    }

    return (
      <div key={node.id} className="tree-node">
        <div className={`tree-row file ${isActive ? 'active' : ''}`} style={{ paddingLeft: 8 + depth * 12 }}>
          <button className="tree-main" onClick={() => void openFile(node.id)}>
            <span className="tree-spacer" />
            <FileText size={14} />
            <span>{node.name}</span>
          </button>
          <div className="tree-actions">
            <button title="More" onClick={() => setMenuId(menuId === node.id ? null : node.id)}>
              <MoreHorizontal size={13} />
            </button>
          </div>
          {menuId === node.id && (
            <div className="tree-menu">
              <button onClick={() => { setMenuId(null); void onRename(node) }}>Rename</button>
              <button onClick={() => { setMenuId(null); void onDelete(node) }}>Delete</button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return <div className="file-tree">{renderNode(tree, 0)}</div>
}
