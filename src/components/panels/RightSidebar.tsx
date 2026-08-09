import { useMemo } from 'react'
import { useApp } from '../../hooks/useApp'
import { buildOutline } from '../../lib/markdown'
import './RightSidebar.css'

export function RightSidebar() {
  const { rightPanel, activeFileId, index, editorContent, openFile, setRightPanel } = useApp()

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
                <li key={note.id}>
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
              <li key={`${item.line}-${item.text}`} style={{ paddingLeft: (item.level - 1) * 12 }}>
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
              <li key={tag}>
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
    </aside>
  )
}
