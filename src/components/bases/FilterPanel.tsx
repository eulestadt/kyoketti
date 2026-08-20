import { useMemo, useState } from 'react'
import { Code2, Plus, Trash2, X } from 'lucide-react'
import type { FilterNode } from '../../lib/bases'
import {
  BUILTIN_FILTER_PROPERTIES,
  FILTER_PRESETS,
  countFilterConditions,
  emptyFilterGroup,
  filterNodeToAdvancedText,
  newFilterRowId,
  operatorsForProperty,
  parseFilterNodeToUi,
  serializeUiFilterGroup,
  type FilterConjunction,
  type UiFilterGroup,
  type UiFilterRow,
} from '../../lib/bases/filterUi'

type Props = {
  globalFilters?: FilterNode
  viewFilters?: FilterNode
  propertyOptions: Array<{ value: string; label: string }>
  readOnly?: boolean
  onChangeGlobal: (filters: FilterNode | undefined) => void
  onChangeView: (filters: FilterNode | undefined) => void
  onClose?: () => void
}

const CONJUNCTION_LABELS: Record<FilterConjunction, string> = {
  and: 'All the following are true',
  or: 'Any of the following are true',
  not: 'None of the following are true',
}

function FilterSection({
  title,
  hint,
  group,
  propertyOptions,
  readOnly,
  onChange,
}: {
  title: string
  hint: string
  group: UiFilterGroup
  propertyOptions: Array<{ value: string; label: string }>
  readOnly?: boolean
  onChange: (next: UiFilterGroup) => void
}) {
  const props = useMemo(() => {
    const seen = new Set<string>()
    const out: Array<{ value: string; label: string }> = []
    for (const p of [...BUILTIN_FILTER_PROPERTIES, ...propertyOptions]) {
      if (seen.has(p.value)) continue
      seen.add(p.value)
      out.push(p)
    }
    return out
  }, [propertyOptions])

  function updateRow(id: string, patch: Partial<UiFilterRow>) {
    onChange({
      ...group,
      advanced: false,
      rows: group.rows.map((r) => {
        if (r.id !== id) return r
        const next = { ...r, ...patch }
        if (patch.property && patch.property !== r.property) {
          const ops = operatorsForProperty(patch.property)
          if (!ops.some((o) => o.id === next.operator)) {
            next.operator = ops[0]?.id ?? 'eq'
          }
        }
        return next
      }),
    })
  }

  function removeRow(id: string) {
    onChange({
      ...group,
      advanced: false,
      rows: group.rows.filter((r) => r.id !== id),
    })
  }

  function addRow(partial?: Partial<UiFilterRow>) {
    const property = partial?.property ?? 'file.name'
    const ops = operatorsForProperty(property)
    onChange({
      ...group,
      advanced: false,
      rows: [
        ...group.rows,
        {
          id: newFilterRowId(),
          property,
          operator: partial?.operator ?? ops[0]?.id ?? 'eq',
          value: partial?.value ?? '',
        },
      ],
    })
  }

  if (group.advanced) {
    return (
      <section className="filter-section">
        <header className="filter-section-head">
          <div>
            <strong>{title}</strong>
            <p>{hint}</p>
          </div>
          {!readOnly && (
            <button
              type="button"
              className="base-tool-btn"
              title="Switch to simple filters"
              onClick={() => {
                const parsed = parseFilterNodeToUi(group.advancedText.trim() || undefined)
                if (parsed.advanced) {
                  onChange({ ...emptyFilterGroup(), rows: [] })
                } else {
                  onChange(parsed)
                }
              }}
            >
              Simple
            </button>
          )}
        </header>
        <textarea
          className="filter-advanced"
          rows={4}
          value={group.advancedText}
          readOnly={readOnly}
          placeholder='file.hasTag("book") && status != "done"'
          onChange={(e) =>
            onChange({
              ...group,
              advanced: true,
              advancedText: e.target.value,
            })
          }
        />
        <p className="filter-hint">
          Advanced expression. Use Simple if your filter is a list of property conditions.
        </p>
      </section>
    )
  }

  return (
    <section className="filter-section">
      <header className="filter-section-head">
        <div>
          <strong>{title}</strong>
          <p>{hint}</p>
        </div>
        {!readOnly && (
          <button
            type="button"
            className="base-tool-btn"
            title="Edit as expression"
            onClick={() => {
              const node = serializeUiFilterGroup(group)
              onChange({
                ...group,
                advanced: true,
                advancedText: node ? filterNodeToAdvancedText(node) : '',
              })
            }}
          >
            <Code2 size={13} />
          </button>
        )}
      </header>

      {(group.rows.length > 0 || !readOnly) && (
        <label className="filter-conjunction">
          <select
            value={group.conjunction}
            disabled={readOnly}
            onChange={(e) =>
              onChange({
                ...group,
                conjunction: e.target.value as FilterConjunction,
              })
            }
          >
            {(Object.keys(CONJUNCTION_LABELS) as FilterConjunction[]).map((key) => (
              <option key={key} value={key}>
                {CONJUNCTION_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="filter-rows">
        {group.rows.map((row) => {
          const ops = operatorsForProperty(row.property)
          const opMeta = ops.find((o) => o.id === row.operator) ?? ops[0]
          return (
            <div key={row.id} className="filter-row">
              <select
                value={row.property}
                disabled={readOnly}
                aria-label="Property"
                onChange={(e) => updateRow(row.id, { property: e.target.value })}
              >
                {props.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
                {!props.some((p) => p.value === row.property) && (
                  <option value={row.property}>{row.property}</option>
                )}
              </select>
              <select
                value={row.operator}
                disabled={readOnly}
                aria-label="Operator"
                onChange={(e) =>
                  updateRow(row.id, {
                    operator: e.target.value as UiFilterRow['operator'],
                  })
                }
              >
                {ops.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              {opMeta?.needsValue !== false && (
                <input
                  type="text"
                  value={row.value}
                  disabled={readOnly}
                  placeholder={
                    row.operator === 'has_tag'
                      ? 'tag'
                      : row.operator === 'in_folder'
                        ? 'folder/path'
                        : 'value'
                  }
                  aria-label="Value"
                  onChange={(e) => updateRow(row.id, { value: e.target.value })}
                />
              )}
              {!readOnly && (
                <button
                  type="button"
                  className="filter-remove"
                  title="Remove filter"
                  onClick={() => removeRow(row.id)}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {!readOnly && (
        <div className="filter-actions">
          <button type="button" className="base-tool-btn" onClick={() => addRow()}>
            <Plus size={13} /> Filter
          </button>
          {group.rows.length > 0 && (
            <button
              type="button"
              className="base-tool-btn"
              onClick={() => onChange(emptyFilterGroup())}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {!readOnly && group.rows.length === 0 && (
        <div className="filter-presets">
          {FILTER_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="filter-chip"
              onClick={() => onChange(preset.apply(group))}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

export function FilterPanel({
  globalFilters,
  viewFilters,
  propertyOptions,
  readOnly,
  onChangeGlobal,
  onChangeView,
  onClose,
}: Props) {
  // Local state only — remount when the popover opens so we don't steal focus while typing.
  const [globalGroup, setGlobalGroup] = useState(() => parseFilterNodeToUi(globalFilters))
  const [viewGroup, setViewGroup] = useState(() => parseFilterNodeToUi(viewFilters))

  function commitGlobal(next: UiFilterGroup) {
    setGlobalGroup(next)
    onChangeGlobal(serializeUiFilterGroup(next))
  }

  function commitView(next: UiFilterGroup) {
    setViewGroup(next)
    onChangeView(serializeUiFilterGroup(next))
  }

  const globalCount = countFilterConditions(serializeUiFilterGroup(globalGroup))
  const viewCount = countFilterConditions(serializeUiFilterGroup(viewGroup))

  return (
    <div className="base-popover filter-panel">
      <header className="filter-panel-head">
        <div>
          <strong>Filters</strong>
          <span>
            {globalCount + viewCount === 0
              ? 'Showing all matching files'
              : `${globalCount + viewCount} condition${globalCount + viewCount === 1 ? '' : 's'}`}
          </span>
        </div>
        {onClose && (
          <button type="button" className="filter-remove" onClick={onClose} title="Close">
            <X size={14} />
          </button>
        )}
      </header>

      <FilterSection
        title="All views"
        hint="Applies everywhere in this base"
        group={globalGroup}
        propertyOptions={propertyOptions}
        readOnly={readOnly}
        onChange={commitGlobal}
      />

      <FilterSection
        title="This view"
        hint="Only for the active view"
        group={viewGroup}
        propertyOptions={propertyOptions}
        readOnly={readOnly}
        onChange={commitView}
      />
    </div>
  )
}

export function filterButtonLabel(globalFilters?: FilterNode, viewFilters?: FilterNode): string {
  const n = countFilterConditions(globalFilters) + countFilterConditions(viewFilters)
  return n > 0 ? `Filter (${n})` : 'Filter'
}
