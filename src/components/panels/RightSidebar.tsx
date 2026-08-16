import { useMemo } from 'react'
import { useApp } from '../../hooks/useApp'
import { buildOutline } from '../../lib/markdown'
import { compactItems, ContextMenu, useContextMenu } from '../ui/ContextMenu'
import { noteMenuItems } from '../ui/noteMenu'
import { copyText } from '../../lib/clipboard'
import type { NoteMeta } from '../../types'
import './RightSidebar.css'

type SidebarMenu =
  | { kind: 'note'; note: NoteMeta }
  | { kind: 'heading'; text: string }
  | { kind: 'tag'; tag: string; ids: string[] }

export function RightSidebar() {
  const {
    rightPanel,
    activeFileId,
    index,
    editorContent,
    openFile,
    setRightPanel,
    renameNode,
    deleteNode,
    duplicateFile,
  } = useApp()
  const { menu, open, close } = useContextMenu<SidebarMenu>()

  const backlinks = useMemo(() => {
    if (!activeFileId) return []
    const ids = index.backlinks.get(activeFileId) ?? []
    return ids.map((id) => index.notesById.get(id)).filter(Boolean)
  }, [activeFileId, index])

  const outline = useMemo(() => buildOutline(editorContent), [editorContent])

  const tags = useMemo(() => {
    return [...index.tags.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([tag, ids]) => ({ tag, count: ids.length, ids }))
  }, [index.tags])

  if (!rightPanel) return null

  return (
    <aside className="right-sidebar">
      <div className="right-tabs">
        <button className={rightPanel === 'backlinks' ? 'active' : ''} onClick={() => setRightPanel('backlinks')}>
          Backlinks
        </button>
        <button className={rightPanel === 'outline' ? 'active' : ''} onClick={() => setRightPanel('outline')}>
          Outline
        </button>
        <button className={rightPanel === 'tags' ? 'active' : ''} onClick={() => setRightPanel('tags')}>
          Tags
        </button>
      </div>

      {rightPanel === 'backlinks' && (
        <div className="right-body">
          <h3>Linked mentions</h3>
          {backlinks.length === 0 && <p className="muted">No backlinks yet.</p>}
          <ul>
            {backlinks.map((note) =>
              note ? (
                <li key={note.id} onContextMenu={(e) => open(e, { kind: 'note', note })}>
                  <button onClick={() => void openFile(note.id)}>{note.title}</button>
                </li>
              ) : null,
            )}
          </ul>
        </div>
      )}

      {rightPanel === 'outline' && (
        <div className="right-body">
          <h3>Outline</h3>
          {outline.length === 0 && <p className="muted">No headings in this note.</p>}
          <ul className="outline-list">
            {outline.map((item) => (
              <li
                key={`${item.line}-${item.text}`}
                style={{ paddingLeft: (item.level - 1) * 12 }}
                onContextMenu={(e) => open(e, { kind: 'heading', text: item.text })}
              >
                {item.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {rightPanel === 'tags' && (
        <div className="right-body">
          <h3>Tags</h3>
          {tags.length === 0 && <p className="muted">No tags in this vault.</p>}
          <ul className="tag-list">
            {tags.map(({ tag, count, ids }) => (
              <li key={tag} onContextMenu={(e) => open(e, { kind: 'tag', tag, ids })}>
                <button
                  onClick={() => {
                    const first = ids[0]
                    if (first) void openFile(first)
                  }}
                >
                  #{tag}
                  <span>{count}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={close}
          items={sidebarMenuItems(menu.data, {
            openFile,
            renameNode,
            deleteNode,
            duplicateFile,
            index,
          })}
        />
      )}
    </aside>
  )
}

function sidebarMenuItems(
  data: SidebarMenu,
  actions: {
    openFile: (id: string) => Promise<void> | void
    renameNode: (id: string, name: string) => Promise<void> | void
    deleteNode: (id: string) => Promise<void> | void
    duplicateFile: (id: string) => Promise<void> | void
    index: ReturnType<typeof useApp>['index']
  },
) {
  if (data.kind === 'note') {
    return noteMenuItems(data.note, actions, {
      open: true,
      rename: true,
      duplicate: true,
      remove: true,
    })
  }
  if (data.kind === 'heading') {
    return compactItems([{ label: 'Copy heading', onClick: () => void copyText(data.text) }])
  }
  return compactItems([
    {
      label: 'Open first note',
      onClick: () => {
        const first = data.ids[0]
        if (first) void actions.openFile(first)
      },
    },
    { label: 'Copy tag', onClick: () => void copyText(`#${data.tag}`) },
  ])
}
