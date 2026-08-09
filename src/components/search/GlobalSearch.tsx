import { useMemo, useState } from 'react'
import { useApp } from '../../hooks/useApp'
import { fuzzyMatch } from '../../lib/vaultIndex'
import './GlobalSearch.css'

export function GlobalSearch() {
  const { index, openFile } = useApp()
  const [query, setQuery] = useState('')

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
          <li key={note.id}>
            <button onClick={() => void openFile(note.id)}>
              <strong>{note.title}</strong>
              <span>{note.path}</span>
              <p>{snippet}</p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
