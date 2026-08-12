import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Copy,
  Download,
  ListFilter,
  Plus,
  Search,
  ArrowUpDown,
  Columns3,
  Code2,
  LayoutGrid,
} from 'lucide-react'
import { useApp } from '../../hooks/useApp'
import {
  parseBaseConfig,
  serializeBaseConfig,
  runBaseQuery,
  getPropertyDisplayName,
  formatCellValue,
  resolveProperty,
  rowsToCsv,
  cellLinkPath,
  isLink,
  isFile,
  defaultBaseContent,
} from '../../lib/bases'
import type { BaseConfig, BaseRow, BaseView } from '../../lib/bases'
import { setFrontmatterProperty } from '../../lib/bases/frontmatter'
import { countFilterConditions } from '../../lib/bases/filterUi'
import { resolveNoteRef } from '../../lib/vaultIndex'
import { FilterPanel, filterButtonLabel } from './FilterPanel'
import './BaseViewer.css'

type Props = {
  content: string
  onChange?: (content: string) => void
  /** When embedded, hide source toggle and use compact chrome */
  embedded?: boolean
  viewName?: string
  /** Optional this-context file id (embedding note / sidebar active) */
  thisFileId?: string
  readOnly?: boolean
}

function notePropKey(prop: string): string | null {
  if (prop.startsWith('file.') || prop.startsWith('formula.')) return null
  if (prop.startsWith('note.')) return prop.slice(5)
  return prop
}

export function BaseViewer({
  content,
  onChange,
  embedded = false,
  viewName,
  thisFileId,
  readOnly = false,
}: Props) {
  const { index, openFile, openNoteByTitle, createNote, vault, writeFileContent } = useApp()
  const parsed = useMemo(() => parseBaseConfig(content || defaultBaseContent()), [content])
  const [config, setConfig] = useState<BaseConfig>(parsed.config)
  const [activeViewIndex, setActiveViewIndex] = useState(0)
  const [search, setSearch] = useState('')
  const [showSource, setShowSource] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [propsOpen, setPropsOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const [editing, setEditing] = useState<{ rowId: string; prop: string } | null>(null)
  const [editDraft, setEditDraft] = useState('')

  useEffect(() => {
    setConfig(parsed.config)
  }, [parsed.config])

  useEffect(() => {
    if (!viewName) return
    const idx = config.views.findIndex((v) => v.name.toLowerCase() === viewName.toLowerCase())
    if (idx >= 0) setActiveViewIndex(idx)
  }, [viewName, config.views])

  const view: BaseView = config.views[activeViewIndex] ?? config.views[0] ?? {
    type: 'table',
    name: 'Table',
    order: ['file.name'],
  }

  const thisNote = thisFileId ? index.notesById.get(thisFileId) : undefined
  const thisCtx = useMemo(() => {
    if (!thisNote) return undefined
    const folder = thisNote.path.includes('/')
      ? thisNote.path.slice(0, thisNote.path.lastIndexOf('/'))
      : ''
    const ext = thisNote.name.includes('.')
      ? thisNote.name.slice(thisNote.name.lastIndexOf('.') + 1).toLowerCase()
      : ''
    return {
      file: {
        __type: 'file' as const,
        id: thisNote.id,
        name: thisNote.name,
        basename: thisNote.title,
        path: thisNote.path,
        folder,
        ext,
        size: new TextEncoder().encode(thisNote.content).length,
        ctime: thisNote.modifiedTime ? new Date(thisNote.modifiedTime) : new Date(),
        mtime: thisNote.modifiedTime ? new Date(thisNote.modifiedTime) : new Date(),
        tags: thisNote.tags,
        links: thisNote.links,
        embeds: [],
        properties: thisNote.frontmatter,
        content: thisNote.content,
      },
      note: thisNote.frontmatter,
    }
  }, [thisNote])

  const result = useMemo(() => {
    const notes = [...index.notesById.values()]
    return runBaseQuery(notes, config, view, { search, thisCtx })
  }, [index.notesById, config, view, search, thisCtx])

  const columns = view.order?.length ? view.order : ['file.name', 'file.mtime', 'file.size']

  const commitConfig = useCallback(
    (next: BaseConfig | ((prev: BaseConfig) => BaseConfig)) => {
      setConfig((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next
        if (onChange && !readOnly) onChange(serializeBaseConfig(resolved))
        return resolved
      })
    },
    [onChange, readOnly],
  )

  const updateView = useCallback(
    (patch: Partial<BaseView>) => {
      commitConfig((prev) => ({
        ...prev,
        views: prev.views.map((v, i) => (i === activeViewIndex ? { ...v, ...patch } : v)),
      }))
    },
    [activeViewIndex, commitConfig],
  )

  async function openRow(row: BaseRow) {
    await openFile(row.id, { name: row.file.name, path: row.file.path })
  }

  async function openValueLink(value: unknown) {
    const path = cellLinkPath(value)
    if (!path) return
    const title = path.replace(/^\[\[|\]\]$/g, '').replace(/\.(md|markdown|base)$/i, '')
    const byPath = resolveNoteRef(index, path) || resolveNoteRef(index, title)
    if (byPath) await openFile(byPath.id)
    else await openNoteByTitle(title)
  }

  async function onNewNote() {
    const parentId = vault?.folderId
    if (!parentId) return
    const name = window.prompt('New note name', 'Untitled')
    if (!name?.trim()) return
    await createNote(parentId, name.trim())
  }

  function copyResults() {
    const text = rowsToCsv(result.rows, columns)
    void navigator.clipboard.writeText(text)
  }

  function exportCsv() {
    const text = rowsToCsv(result.rows, columns)
    const blob = new Blob([text], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${view.name || 'base'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function commitCellEdit(row: BaseRow, prop: string) {
    const key = notePropKey(prop)
    if (!key) {
      setEditing(null)
      return
    }
    const note = index.notesById.get(row.id)
    if (!note) {
      setEditing(null)
      return
    }
    let value: unknown = editDraft
    if (editDraft === 'true') value = true
    else if (editDraft === 'false') value = false
    else if (editDraft === '') value = null
    else if (/^-?\d+(\.\d+)?$/.test(editDraft)) value = Number(editDraft)
    else if (editDraft.includes(',')) {
      value = editDraft.split(',').map((s) => s.trim()).filter(Boolean)
    }
    const nextContent = setFrontmatterProperty(note.content, key, value)
    await writeFileContent(note.id, nextContent)
    setEditing(null)
  }

  function renderCell(row: BaseRow, prop: string) {
    const value =
      prop in row.values ? row.values[prop] : resolveProperty(prop, row)
    const editingThis = editing?.rowId === row.id && editing.prop === prop
    const editable = Boolean(notePropKey(prop)) && !readOnly && !embedded

    if (editingThis) {
      return (
        <input
          className="cell-edit"
          autoFocus
          value={editDraft}
          onChange={(e) => setEditDraft(e.target.value)}
          onBlur={() => void commitCellEdit(row, prop)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commitCellEdit(row, prop)
            if (e.key === 'Escape') setEditing(null)
          }}
        />
      )
    }

    if (prop === 'file.name' || prop === 'file.path' || prop === 'file.basename') {
      return (
        <button type="button" className="cell-link" onClick={() => void openRow(row)}>
          {formatCellValue(value) || row.file.basename}
        </button>
      )
    }

    if (isLink(value) || isFile(value)) {
      return (
        <button type="button" className="cell-link" onClick={() => void openValueLink(value)}>
          {formatCellValue(value)}
        </button>
      )
    }

    const text = formatCellValue(value)
    if (editable) {
      return (
        <span
          onDoubleClick={() => {
            setEditing({ rowId: row.id, prop })
            setEditDraft(text)
          }}
          title="Double-click to edit"
        >
          {text}
        </span>
      )
    }
    return text
  }

  function renderTable(rows: BaseRow[]) {
    if (!rows.length) return <div className="base-empty">No results</div>
    return (
      <table className="base-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col}
                onClick={() => {
                  const cur = view.sort?.[0]
                  const nextDir =
                    cur?.property === col && String(cur.direction).toUpperCase() !== 'DESC'
                      ? 'DESC'
                      : 'ASC'
                  updateView({ sort: [{ property: col, direction: nextDir }] })
                }}
              >
                {getPropertyDisplayName(config, col)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((col) => (
                <td key={col}>{renderCell(row, col)}</td>
              ))}
            </tr>
          ))}
          {Object.keys(result.summaries).length > 0 && (
            <tr className="base-summary-row">
              {columns.map((col) => (
                <td key={col}>
                  {result.summaries[col] != null ? formatCellValue(result.summaries[col]) : ''}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    )
  }

  function renderList(rows: BaseRow[]) {
    if (!rows.length) return <div className="base-empty">No results</div>
    const metaCols = columns.filter((c) => c !== 'file.name' && c !== 'file.basename')
    return (
      <ul className="base-list">
        {rows.map((row) => (
          <li key={row.id} className="base-list-item">
            <button type="button" className="title" onClick={() => void openRow(row)}>
              {row.file.basename}
            </button>
            <div className="base-list-meta">
              {metaCols.slice(0, 4).map((col) => (
                <span key={col}>
                  {getPropertyDisplayName(config, col)}: {formatCellValue(resolveProperty(col, row))}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    )
  }

  function renderCards(rows: BaseRow[]) {
    if (!rows.length) return <div className="base-empty">No results</div>
    const metaCols = columns.filter((c) => c !== 'file.name' && c !== 'file.basename').slice(0, 5)
    return (
      <div className="base-cards">
        {rows.map((row) => (
          <button key={row.id} type="button" className="base-card" onClick={() => void openRow(row)}>
            <h3>{row.file.basename}</h3>
            <div className="card-props">
              {metaCols.map((col) => (
                <div key={col}>
                  {getPropertyDisplayName(config, col)}: {formatCellValue(resolveProperty(col, row))}
                </div>
              ))}
            </div>
          </button>
        ))}
      </div>
    )
  }

  function renderMap() {
    return (
      <div className="base-map-stub">
        <p>
          <strong>Map</strong> view requires geographic coordinates (lat/long properties).
        </p>
        <p>
          Configure <code>lat</code> / <code>long</code> on the view in source, or use Table / Cards /
          List.
        </p>
        <p>
          {result.total} matching file{result.total === 1 ? '' : 's'} in this view.
        </p>
      </div>
    )
  }

  function renderBody() {
    if (showSource && !embedded) {
      return (
        <textarea
          className="base-source"
          value={content}
          onChange={(e) => onChange?.(e.target.value)}
          spellCheck={false}
        />
      )
    }

    return (
      <div className="base-body">
        {parsed.error && <div className="base-error">YAML: {parsed.error}</div>}
        {result.groups.map((group) => (
          <div key={group.key || 'all'}>
            {group.label ? <div className="base-group-header">{group.label}</div> : null}
            {view.type === 'list'
              ? renderList(group.rows)
              : view.type === 'cards'
                ? renderCards(group.rows)
                : view.type === 'map'
                  ? renderMap()
                  : renderTable(group.rows)}
          </div>
        ))}
      </div>
    )
  }

  const filterCount = countFilterConditions(config.filters) + countFilterConditions(view.filters)
  const filterPropertyOptions = useMemo(() => {
    return collectKnownProps(config, index).map((prop) => ({
      value: prop,
      label: getPropertyDisplayName(config, prop),
    }))
  }, [config, index])

  return (
    <div className="base-viewer">
      <div className="base-toolbar">
        <div className="base-view-tabs">
          {config.views.map((v, i) => (
            <button
              key={`${v.name}-${i}`}
              type="button"
              className={`base-view-tab ${i === activeViewIndex ? 'active' : ''}`}
              onClick={() => setActiveViewIndex(i)}
            >
              {v.name}
            </button>
          ))}
          {!readOnly && !embedded && (
            <button
              type="button"
              className="base-view-tab"
              title="Add view"
              onClick={() => {
                const name = window.prompt('View name', `View ${config.views.length + 1}`)
                if (!name) return
                const type = window.prompt('View type (table|list|cards|map)', 'table') || 'table'
                commitConfig({
                  ...config,
                  views: [
                    ...config.views,
                    { type, name, order: columns },
                  ],
                })
                setActiveViewIndex(config.views.length)
              }}
            >
              +
            </button>
          )}
        </div>

        <div className="base-toolbar-actions">
          <span className="base-count">
            {result.limited ? `${result.rows.length} of ${result.total}` : result.total} result
            {result.total === 1 ? '' : 's'}
          </span>

          <div className="base-tool-wrap">
            <button
              type="button"
              className={`base-tool-btn ${filterOpen || filterCount > 0 ? 'active' : ''}`}
              onClick={() => {
                setFilterOpen((v) => !v)
                setPropsOpen(false)
                setSortOpen(false)
              }}
            >
              <ListFilter size={14} /> {filterButtonLabel(config.filters, view.filters)}
            </button>
            {filterOpen && (
              <FilterPanel
                globalFilters={config.filters}
                viewFilters={view.filters}
                propertyOptions={filterPropertyOptions}
                readOnly={readOnly}
                onClose={() => setFilterOpen(false)}
                onChangeGlobal={(filters) => commitConfig((prev) => ({ ...prev, filters }))}
                onChangeView={(filters) => updateView({ filters })}
              />
            )}
          </div>

          <div className="base-tool-wrap">
            <button
              type="button"
              className={`base-tool-btn ${sortOpen ? 'active' : ''}`}
              onClick={() => {
                setSortOpen((v) => !v)
                setFilterOpen(false)
                setPropsOpen(false)
              }}
            >
              <ArrowUpDown size={14} /> Sort
            </button>
            {sortOpen && (
              <div className="base-popover">
                <h4>Sort by</h4>
                <select
                  value={view.sort?.[0]?.property ?? columns[0]}
                  onChange={(e) =>
                    updateView({
                      sort: [
                        {
                          property: e.target.value,
                          direction: view.sort?.[0]?.direction ?? 'ASC',
                        },
                      ],
                    })
                  }
                >
                  {columns.map((c) => (
                    <option key={c} value={c}>
                      {getPropertyDisplayName(config, c)}
                    </option>
                  ))}
                </select>
                <select
                  value={String(view.sort?.[0]?.direction ?? 'ASC').toUpperCase()}
                  onChange={(e) =>
                    updateView({
                      sort: [
                        {
                          property: view.sort?.[0]?.property ?? columns[0]!,
                          direction: e.target.value,
                        },
                      ],
                    })
                  }
                >
                  <option value="ASC">Ascending</option>
                  <option value="DESC">Descending</option>
                </select>
                <h4>Group by</h4>
                <select
                  value={
                    typeof view.groupBy === 'string'
                      ? view.groupBy
                      : view.groupBy?.property ?? ''
                  }
                  onChange={(e) => {
                    const property = e.target.value
                    updateView({
                      groupBy: property
                        ? { property, direction: 'ASC' }
                        : undefined,
                    })
                  }}
                >
                  <option value="">None</option>
                  {columns.map((c) => (
                    <option key={c} value={c}>
                      {getPropertyDisplayName(config, c)}
                    </option>
                  ))}
                </select>
                <h4>Limit</h4>
                <input
                  type="text"
                  defaultValue={view.limit ?? ''}
                  placeholder="No limit"
                  onBlur={(e) => {
                    const n = e.target.value.trim()
                    updateView({ limit: n ? Number(n) : undefined })
                  }}
                />
              </div>
            )}
          </div>

          <div className="base-tool-wrap">
            <button
              type="button"
              className={`base-tool-btn ${propsOpen ? 'active' : ''}`}
              onClick={() => {
                setPropsOpen((v) => !v)
                setFilterOpen(false)
                setSortOpen(false)
              }}
            >
              <Columns3 size={14} /> Properties
            </button>
            {propsOpen && (
              <div className="base-popover">
                <h4>Visible properties</h4>
                {collectKnownProps(config, index).map((prop) => {
                  const checked = columns.includes(prop)
                  return (
                    <label key={prop}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const next = checked
                            ? columns.filter((c) => c !== prop)
                            : [...columns, prop]
                          updateView({ order: next })
                        }}
                      />
                      {getPropertyDisplayName(config, prop)}
                      <span style={{ opacity: 0.5, marginLeft: 'auto', fontSize: 11 }}>{prop}</span>
                    </label>
                  )
                })}
                {!readOnly && (
                  <>
                    <h4 style={{ marginTop: 10 }}>Add formula</h4>
                    <input
                      type="text"
                      placeholder="name"
                      id="base-formula-name"
                    />
                    <input
                      type="text"
                      placeholder='file.mtime.relative()'
                      id="base-formula-expr"
                    />
                    <button
                      type="button"
                      className="base-tool-btn"
                      onClick={() => {
                        const name = (document.getElementById('base-formula-name') as HTMLInputElement)
                          ?.value.trim()
                        const expr = (document.getElementById('base-formula-expr') as HTMLInputElement)
                          ?.value.trim()
                        if (!name || !expr) return
                        const formulas = { ...config.formulas, [name]: expr }
                        const order = columns.includes(`formula.${name}`)
                          ? columns
                          : [...columns, `formula.${name}`]
                        commitConfig({ ...config, formulas })
                        updateView({ order })
                      }}
                    >
                      Add formula
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <label className="base-tool-btn" style={{ cursor: 'text' }}>
            <Search size={14} />
            <input
              className="base-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              style={{ border: 'none', padding: 0, minWidth: 100, background: 'transparent' }}
            />
          </label>

          <button type="button" className="base-tool-btn" onClick={copyResults} title="Copy CSV">
            <Copy size={14} />
          </button>
          <button type="button" className="base-tool-btn" onClick={exportCsv} title="Export CSV">
            <Download size={14} />
          </button>
          {!embedded && (
            <button
              type="button"
              className={`base-tool-btn ${showSource ? 'active' : ''}`}
              onClick={() => setShowSource((v) => !v)}
              title="Edit base source"
            >
              <Code2 size={14} />
            </button>
          )}
          {!readOnly && !embedded && (
            <button type="button" className="base-tool-btn" onClick={() => void onNewNote()}>
              <Plus size={14} /> New
            </button>
          )}
          {view.type === 'cards' && (
            <span className="base-tool-btn" style={{ pointerEvents: 'none', opacity: 0.7 }}>
              <LayoutGrid size={14} />
            </span>
          )}
        </div>
      </div>
      {renderBody()}
    </div>
  )
}

function collectKnownProps(
  config: BaseConfig,
  index: { notesById: Map<string, { frontmatter: Record<string, unknown> }> },
): string[] {
  const set = new Set<string>([
    'file.name',
    'file.basename',
    'file.path',
    'file.folder',
    'file.ext',
    'file.size',
    'file.mtime',
    'file.ctime',
    'file.tags',
    'file.links',
  ])
  for (const key of Object.keys(config.formulas ?? {})) set.add(`formula.${key}`)
  for (const key of Object.keys(config.properties ?? {})) set.add(key)
  for (const note of index.notesById.values()) {
    for (const key of Object.keys(note.frontmatter)) set.add(key)
  }
  for (const view of config.views) {
    for (const p of view.order ?? []) set.add(p)
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

/** Compact embed host for markdown preview / reading view. */
export function BaseEmbed({
  content,
  viewName,
  thisFileId,
}: {
  content: string
  viewName?: string
  thisFileId?: string
}) {
  return (
    <div className="base-embed-wrap">
      <BaseViewer content={content} embedded readOnly viewName={viewName} thisFileId={thisFileId} />
    </div>
  )
}
