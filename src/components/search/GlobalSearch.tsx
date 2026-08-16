import { useMemo, useState } from 'react'
import { useApp } from '../../hooks/useApp'
import { fuzzyMatch } from '../../lib/vaultIndex'
import { ContextMenu, useContextMenu } from '../ui/ContextMenu'
import { noteMenuItems } from '../ui/noteMenu'
import type { NoteMeta } from '../../types'
import './GlobalSearch.css'

export function GlobalSearch() {
  const { index, openFile, renameNode, deleteNode, duplicateFile } = useApp()
  const [query, setQuery] = useState('')
  const { menu, open, close } = useContextMenu<NoteMeta>()

  const results = useMemo(() => {
    const q = query.trim()
    if (!q) return []
    return [...index.notesById.values()]
      .filter((n) => fuzzyMatch(q, n.title) || n.content.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 100)
      .map((n) => {
        const lower = n.content.toLowerCase()
        const idx = lower.indexOf(q.toLowerCase())
        const snippet =
          idx >= 0
            ? n.content.slice(Math.max(0, idx - 40), idx + q.length + 60).replace(/\s+/g, ' ')
            : n.content.slice(0, 100).replace(/\s+/g, ' ')
        return { note: n, snippet }
      })
  }, [index.notesById, query])

  return (
    <div className="global-search">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search vault…"
        aria-label="Search vault"
      />
      <ul>
        {results.map(({ note, snippet }) => (
          <li key={note.id} onContextMenu={(e) => open(e, note)}>
            <button onClick={() => void openFile(note.id)}>
              <strong>{note.title}</strong>
              <span>{note.path}</span>
              <p>{snippet}</p>
            </button>
          </li>
        ))}
      </ul>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={close}
          items={noteMenuItems(menu.data, { openFile, renameNode, deleteNode, duplicateFile, index }, {
            open: true,
            rename: true,
            duplicate: true,
            remove: true,
          })}
        />
      )}
    </div>
  )
}
