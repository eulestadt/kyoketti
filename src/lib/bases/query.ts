import type { NoteMeta } from '../../types'
import {
  compareValues,
  evaluateExpression,
  evaluateFilter,
  formatCellValue,
  isDate,
  isFile,
  isLink,
} from './expression'
import type { EvalScope } from './expression'
import { computeSummary } from './summaries'
import type {
  BaseConfig,
  BaseFileRef,
  BaseQueryResult,
  BaseRow,
  BaseView,
  FilterNode,
} from './types'

export type ThisContext = {
  file?: BaseFileRef
  note?: Record<string, unknown>
}

function folderOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i === -1 ? '' : name.slice(i + 1).toLowerCase()
}

function basenameOf(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

function extractEmbeds(content: string): string[] {
  const out: string[] = []
  for (const m of content.matchAll(/!\[\[([^\]|#]+)/g)) {
    out.push(m[1]!.trim())
  }
  return out
}

function coerceFrontmatterDates(fm: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...fm }
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
      const d = new Date(v.replace(' ', 'T'))
      if (!Number.isNaN(d.getTime())) out[k] = d
    }
  }
  return out
}

export function noteToFileRef(note: NoteMeta): BaseFileRef {
  const mtime = note.modifiedTime ? new Date(note.modifiedTime) : new Date()
  const size = new TextEncoder().encode(note.content).length
  return {
    __type: 'file',
    id: note.id,
    name: note.name,
    basename: basenameOf(note.name),
    path: note.path,
    folder: folderOf(note.path),
    ext: extOf(note.name),
    size,
    ctime: mtime,
    mtime,
    tags: note.tags,
    links: note.links,
    embeds: extractEmbeds(note.content),
    properties: note.frontmatter,
    content: note.content,
  }
}

function matchesFilter(filter: FilterNode | undefined, scope: EvalScope): boolean {
  if (filter == null) return true
  if (typeof filter === 'string') return evaluateFilter(filter, scope)
  if ('and' in filter) return filter.and.every((f) => matchesFilter(f, scope))
  if ('or' in filter) return filter.or.some((f) => matchesFilter(f, scope))
  if ('not' in filter) return !filter.not.some((f) => matchesFilter(f, scope))
  return true
}

function computeFormulas(
  formulas: Record<string, string> | undefined,
  scope: EvalScope,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!formulas) return out
  // Allow formulas to reference earlier ones by iterating in key order with a few passes
  const keys = Object.keys(formulas)
  for (let pass = 0; pass < keys.length + 1; pass++) {
    let changed = false
    for (const key of keys) {
      const expr = formulas[key]!
      const nextScope = { ...scope, formula: { ...scope.formula, ...out } }
      const value = evaluateExpression(expr, nextScope)
      if (out[key] !== value) {
        out[key] = value
        changed = true
      }
    }
    if (!changed) break
  }
  return out
}

function resolveProperty(prop: string, row: BaseRow): unknown {
  if (prop.startsWith('formula.')) return row.formulas[prop.slice('formula.'.length)]
  if (prop.startsWith('file.')) {
    const key = prop.slice('file.'.length)
    return (row.file as unknown as Record<string, unknown>)[key]
  }
  if (prop.startsWith('note.')) return row.note[prop.slice('note.'.length)]
  if (prop in row.formulas) return row.formulas[prop]
  if (prop in row.note) return row.note[prop]
  if (prop in row.file) return (row.file as unknown as Record<string, unknown>)[prop]
  return row.values[prop]
}

export function getPropertyDisplayName(config: BaseConfig, prop: string): string {
  const custom = config.properties?.[prop]?.displayName
  if (custom) return custom
  if (prop.startsWith('formula.')) return prop.slice('formula.'.length)
  if (prop.startsWith('file.')) return prop.slice('file.'.length)
  if (prop.startsWith('note.')) return prop.slice('note.'.length)
  return prop
}

export function buildRows(
  notes: NoteMeta[],
  config: BaseConfig,
  view: BaseView,
  thisCtx?: ThisContext,
): BaseRow[] {
  const rows: BaseRow[] = []
  for (const note of notes) {
    const file = noteToFileRef(note)
    const noteProps = coerceFrontmatterDates({ ...note.frontmatter })
    const baseScope: EvalScope = {
      file,
      note: noteProps,
      formula: {},
      thisFile: thisCtx?.file,
      thisNote: thisCtx?.note,
    }
    if (!matchesFilter(config.filters, baseScope)) continue
    if (!matchesFilter(view.filters, baseScope)) continue
    const formulas = computeFormulas(config.formulas, baseScope)
    const scopeWithFormula = { ...baseScope, formula: formulas }
    // Re-check filters that may use formulas (rare at global level)
    if (config.filters && !matchesFilter(config.filters, scopeWithFormula)) continue
    if (view.filters && !matchesFilter(view.filters, scopeWithFormula)) continue

    const order = view.order?.length
      ? view.order
      : ['file.name', 'file.mtime', 'file.size']
    const values: Record<string, unknown> = {}
    for (const prop of order) {
      values[prop] = resolveProperty(prop, {
        id: note.id,
        file,
        note: noteProps,
        formulas,
        values: {},
      })
    }
    rows.push({ id: note.id, file, note: noteProps, formulas, values })
  }
  return rows
}

function sortRows(rows: BaseRow[], view: BaseView): BaseRow[] {
  const sorts =
    view.sort?.length
      ? view.sort
      : view.order?.length
        ? [{ property: view.order[0]!, direction: 'ASC' as const }]
        : [{ property: 'file.name', direction: 'ASC' as const }]

  return [...rows].sort((a, b) => {
    for (const s of sorts) {
      const dir = String(s.direction ?? 'ASC').toUpperCase() === 'DESC' ? -1 : 1
      const cmp = compareValues(resolveProperty(s.property, a), resolveProperty(s.property, b))
      if (cmp !== 0) return cmp * dir
    }
    return 0
  })
}

export function runBaseQuery(
  notes: NoteMeta[],
  config: BaseConfig,
  view: BaseView,
  options?: {
    thisCtx?: ThisContext
    search?: string
  },
): BaseQueryResult {
  let rows = buildRows(notes, config, view, options?.thisCtx)
  const q = options?.search?.trim().toLowerCase()
  if (q) {
    rows = rows.filter((row) => {
      const hay = [
        row.file.name,
        row.file.path,
        ...Object.values(row.values).map(formatCellValue),
        ...Object.values(row.formulas).map(formatCellValue),
      ]
        .join('\n')
        .toLowerCase()
      return hay.includes(q)
    })
  }

  rows = sortRows(rows, view)
  const total = rows.length
  let limited = false
  if (typeof view.limit === 'number' && view.limit >= 0 && rows.length > view.limit) {
    rows = rows.slice(0, view.limit)
    limited = true
  }

  const groups: BaseQueryResult['groups'] = []
  const groupBy =
    typeof view.groupBy === 'string'
      ? { property: view.groupBy, direction: 'ASC' }
      : view.groupBy

  if (groupBy?.property) {
    const map = new Map<string, BaseRow[]>()
    for (const row of rows) {
      const raw = resolveProperty(groupBy.property, row)
      const key = formatCellValue(raw) || '(empty)'
      const list = map.get(key) ?? []
      list.push(row)
      map.set(key, list)
    }
    const entries = [...map.entries()]
    const dir = String(groupBy.direction ?? 'ASC').toUpperCase() === 'DESC' ? -1 : 1
    entries.sort((a, b) => a[0].localeCompare(b[0]) * dir)
    for (const [key, groupRows] of entries) {
      groups.push({ key, label: key, rows: groupRows })
    }
  } else {
    groups.push({ key: '', label: '', rows })
  }

  const summaries: Record<string, unknown> = {}
  if (view.summaries) {
    const scopeBase = {
      file: options?.thisCtx?.file ?? (rows[0]?.file as BaseFileRef),
      note: options?.thisCtx?.note ?? {},
      formula: {},
      thisFile: options?.thisCtx?.file,
      thisNote: options?.thisCtx?.note,
    }
    for (const [prop, summaryName] of Object.entries(view.summaries)) {
      const values = rows.map((r) => resolveProperty(prop, r))
      summaries[prop] = computeSummary(summaryName, values, config.summaries, scopeBase)
    }
  }

  return { rows, groups, summaries, total, limited }
}

export function rowsToCsv(rows: BaseRow[], props: string[]): string {
  const escape = (v: string) => {
    if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`
    return v
  }
  const header = props.map(escape).join(',')
  const lines = rows.map((row) =>
    props.map((p) => escape(formatCellValue(resolveProperty(p, row)))).join(','),
  )
  return [header, ...lines].join('\n')
}

export function cellIsLink(value: unknown): value is { path: string; display?: string } {
  return isLink(value) || isFile(value)
}

export function cellLinkPath(value: unknown): string | null {
  if (isLink(value)) return value.path
  if (isFile(value)) return value.path
  return null
}

export { resolveProperty, formatCellValue, isDate }
