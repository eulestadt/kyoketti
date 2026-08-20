import { useEffect, useRef, useState, type RefObject } from 'react'
import { displayNoteName } from '../../lib/noteNames'
import { fileNameFromRenameInput } from '../ui/noteMenu'
import type { OpenTab } from '../../types'

type Props = {
  tabs: OpenTab[]
  activeFileId: string | null
  tabsRef: RefObject<HTMLDivElement | null>
  activeTabRef: RefObject<HTMLDivElement | null>
  onOpen: (id: string) => void
  onClose: (id: string) => void
  onRename: (id: string, name: string) => void | Promise<void>
  onContextMenu: (e: React.MouseEvent, tab: OpenTab) => void
}

export function TabBar({
  tabs,
  activeFileId,
  tabsRef,
  activeTabRef,
  onOpen,
  onClose,
  onRename,
  onContextMenu,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const skipBlurCommit = useRef(false)

  useEffect(() => {
    if (!editingId) return
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [editingId])

  function startRename(tab: OpenTab) {
    setEditingId(tab.id)
    setDraft(displayNoteName(tab.name))
  }

  function cancelRename() {
    skipBlurCommit.current = true
    setEditingId(null)
    setDraft('')
  }

  function commitRename(tab: OpenTab) {
    const next = fileNameFromRenameInput(draft, tab.name)
    setEditingId(null)
    setDraft('')
    if (next) void onRename(tab.id, next)
  }

  return (
    <div className="tabs" ref={tabsRef}>
      {tabs.map((tab) => {
        const editing = editingId === tab.id
        return (
          <div
            key={tab.id}
            ref={tab.id === activeFileId ? activeTabRef : undefined}
            className={`tab ${tab.id === activeFileId ? 'active' : ''} ${editing ? 'renaming' : ''}`}
            onClick={() => {
              if (!editing) onOpen(tab.id)
            }}
            onContextMenu={(e) => onContextMenu(e, tab)}
          >
            {editing ? (
              <input
                ref={inputRef}
                className="tab-rename-input"
                value={draft}
                aria-label="Rename file"
                onChange={(e) => setDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    skipBlurCommit.current = true
                    commitRename(tab)
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    cancelRename()
                  }
                }}
                onBlur={() => {
                  if (skipBlurCommit.current) {
                    skipBlurCommit.current = false
                    return
                  }
                  commitRename(tab)
                }}
              />
            ) : (
              <span
                className="tab-label"
                title={displayNoteName(tab.name)}
                onDoubleClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  startRename(tab)
                }}
              >
                {tab.dirty ? '• ' : ''}
                {displayNoteName(tab.name)}
              </span>
            )}
            <button
              type="button"
              className="tab-close"
              aria-label={`Close ${displayNoteName(tab.name)}`}
              onClick={(e) => {
                e.stopPropagation()
                onClose(tab.id)
              }}
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}
