import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../../hooks/useApp'
import { fuzzyMatch } from '../../lib/vaultIndex'
import './QuickSwitcher.css'

export type SwitcherItem = {
  id: string
  title: string
  path: string
}

type Props = {
  open: boolean
  onClose: () => void
  placeholder?: string
  items?: SwitcherItem[]
  emptyText?: string
  onChoose?: (id: string) => void | Promise<void>
}

export function QuickSwitcher({
  open,
  onClose,
  placeholder = 'Quick switcher — jump to a note',
  items,
  emptyText = 'No matching notes',
  onChoose,
}: Props) {
  const { index, openFile } = useApp()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)

  const catalog = useMemo<SwitcherItem[]>(() => {
    if (items) return items
    return [...index.notesById.values()].map((n) => ({
      id: n.id,
      title: n.title,
      path: n.path,
    }))
  }, [items, index.notesById])

  const filtered = useMemo(() => {
    return catalog
      .filter((n) => fuzzyMatch(query, `${n.title} ${n.path}`))
      .slice(0, 50)
  }, [catalog, query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
    }
  }, [open])

  useEffect(() => {
    setSelected(0)
  }, [query])

  if (!open) return null

  async function choose(id: string) {
    if (onChoose) await onChoose(id)
    else await openFile(id)
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="quick-switcher"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setSelected((s) => Math.min(s + 1, filtered.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setSelected((s) => Math.max(s - 1, 0))
          } else if (e.key === 'Enter' && filtered[selected]) {
            e.preventDefault()
            void choose(filtered[selected].id)
          } else if (e.key === 'Escape') {
            onClose()
          }
        }}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
        />
        <ul>
          {filtered.map((note, i) => (
            <li key={note.id}>
              <button
                className={i === selected ? 'selected' : ''}
                onMouseEnter={() => setSelected(i)}
                onClick={() => void choose(note.id)}
              >
                <span>{note.title}</span>
                <small>{note.path}</small>
              </button>
            </li>
          ))}
          {filtered.length === 0 && <li className="empty">{emptyText}</li>}
        </ul>
      </div>
    </div>
  )
}
