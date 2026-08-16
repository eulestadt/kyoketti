import { LayoutDashboard, Plus } from 'lucide-react'
import { useApp } from '../../hooks/useApp'
import { displayCanvasName, ensureCanvasFileName, isCanvasFileName } from '../../lib/canvas'
import { collectVaultNodes } from '../../lib/vaultTree'
import { ContextMenu, useContextMenu } from '../ui/ContextMenu'
import { noteMenuItems } from '../ui/noteMenu'
import type { VaultNode } from '../../types'
import './CanvasList.css'

export function CanvasList() {
  const {
    tree,
    vault,
    openFile,
    activeFileId,
    createCanvas,
    loadingVault,
    renameNode,
    deleteNode,
    duplicateFile,
    index,
  } = useApp()
  const { menu, open, close } = useContextMenu<VaultNode>()
  const canvases = collectVaultNodes(tree, (node) => !node.isFolder && isCanvasFileName(node.name))

  async function onCreate() {
    const parentId = vault?.folderId
    if (!parentId) return
    const name = window.prompt('New canvas name', 'Untitled')
    if (!name?.trim()) return
    await createCanvas(parentId, ensureCanvasFileName(name))
  }

  if (!tree) {
    return <div className="canvas-list empty">{loadingVault ? 'Loading canvases…' : 'No vault loaded'}</div>
  }

  return (
    <div className="canvas-list">
      <div className="canvas-list-toolbar">
        <button type="button" onClick={() => void onCreate()}>
          <Plus size={14} />
          New canvas
        </button>
      </div>
      {canvases.length === 0 ? (
        <p className="canvas-list-empty">
          Canvases live as <code>.canvas</code> files in your vault. Create one here, or from the Files tree.
          Open a board to add notes, images, and connections in the main pane.
        </p>
      ) : (
        canvases.map((node) => (
          <button
            key={node.id}
            type="button"
            className={`canvas-list-row ${activeFileId === node.id ? 'active' : ''}`}
            onClick={() => void openFile(node.id, { name: node.name, path: node.path })}
            onContextMenu={(e) => open(e, node)}
          >
            <LayoutDashboard size={15} />
            <span>
              <strong>{displayCanvasName(node.name)}</strong>
              {node.path && node.path !== node.name ? <em>{node.path}</em> : null}
            </span>
          </button>
        ))
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={close}
          items={noteMenuItems(
            menu.data,
            { openFile, renameNode, deleteNode, duplicateFile, index },
            { open: true, rename: true, duplicate: true, remove: true },
          )}
        />
      )}
    </div>
  )
}
