import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { BaseConfig, BaseView, FilterNode, PropertyConfig } from './types'
import { DEFAULT_BASE_YAML } from './types'

function asFilter(value: unknown): FilterNode | undefined {
  if (value == null) return undefined
  if (typeof value === 'string') return value
  if (typeof value !== 'object') return undefined
  const obj = value as Record<string, unknown>
  if (Array.isArray(obj.and)) return { and: obj.and.map((x) => asFilter(x)).filter(Boolean) as FilterNode[] }
  if (Array.isArray(obj.or)) return { or: obj.or.map((x) => asFilter(x)).filter(Boolean) as FilterNode[] }
  if (Array.isArray(obj.not)) return { not: obj.not.map((x) => asFilter(x)).filter(Boolean) as FilterNode[] }
  return undefined
}

function asView(raw: unknown, index: number): BaseView | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Record<string, unknown>
  const type = typeof v.type === 'string' ? v.type : 'table'
  const name = typeof v.name === 'string' && v.name.trim() ? v.name : `View ${index + 1}`
  const view: BaseView = { type, name }
  if (typeof v.limit === 'number') view.limit = v.limit
  const filters = asFilter(v.filters)
  if (filters) view.filters = filters
  if (typeof v.groupBy === 'string') view.groupBy = v.groupBy
  else if (v.groupBy && typeof v.groupBy === 'object') {
    const g = v.groupBy as Record<string, unknown>
    if (typeof g.property === 'string') {
      view.groupBy = {
        property: g.property,
        direction: typeof g.direction === 'string' ? g.direction : 'ASC',
      }
    }
  }
  if (Array.isArray(v.order)) view.order = v.order.map(String)
  if (v.summaries && typeof v.summaries === 'object') {
    view.summaries = Object.fromEntries(
      Object.entries(v.summaries as Record<string, unknown>).map(([k, val]) => [k, String(val)]),
    )
  }
  if (Array.isArray(v.sort)) {
    view.sort = v.sort
      .map((s) => {
        if (!s || typeof s !== 'object') return null
        const item = s as Record<string, unknown>
        if (typeof item.property !== 'string') return null
        return {
          property: item.property,
          direction: typeof item.direction === 'string' ? item.direction : 'ASC',
        }
      })
      .filter(Boolean) as BaseView['sort']
  }
  for (const [key, val] of Object.entries(v)) {
    if (['type', 'name', 'limit', 'filters', 'groupBy', 'order', 'summaries', 'sort'].includes(key)) continue
    view[key] = val
  }
  return view
}

export function parseBaseConfig(raw: string): { config: BaseConfig; error?: string } {
  const text = raw.trim()
  if (!text) {
    return { config: parseBaseConfig(DEFAULT_BASE_YAML).config }
  }
  try {
    const doc = parseYaml(text) as unknown
    if (!doc || typeof doc !== 'object') {
      return { config: { views: [{ type: 'table', name: 'Table', order: ['file.name'] }] }, error: 'Base must be a YAML object' }
    }
    const root = doc as Record<string, unknown>
    const formulas =
      root.formulas && typeof root.formulas === 'object'
        ? Object.fromEntries(
            Object.entries(root.formulas as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]),
          )
        : {}
    const properties: Record<string, PropertyConfig> = {}
    if (root.properties && typeof root.properties === 'object') {
      for (const [key, val] of Object.entries(root.properties as Record<string, unknown>)) {
        if (val && typeof val === 'object') properties[key] = val as PropertyConfig
        else properties[key] = { displayName: String(val ?? key) }
      }
    }
    const summaries =
      root.summaries && typeof root.summaries === 'object'
        ? Object.fromEntries(
            Object.entries(root.summaries as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]),
          )
        : {}
    const viewsRaw = Array.isArray(root.views) ? root.views : []
    const views = viewsRaw.map(asView).filter(Boolean) as BaseView[]
    if (!views.length) {
      views.push({ type: 'table', name: 'Table', order: ['file.name', 'file.mtime'] })
    }
    return {
      config: {
        filters: asFilter(root.filters),
        formulas,
        properties,
        summaries,
        views,
      },
    }
  } catch (err) {
    return {
      config: { views: [{ type: 'table', name: 'Table', order: ['file.name'] }] },
      error: err instanceof Error ? err.message : 'Invalid base YAML',
    }
  }
}

export function serializeBaseConfig(config: BaseConfig): string {
  const doc: Record<string, unknown> = {}
  if (config.filters) doc.filters = config.filters
  if (config.formulas && Object.keys(config.formulas).length) doc.formulas = config.formulas
  if (config.properties && Object.keys(config.properties).length) doc.properties = config.properties
  if (config.summaries && Object.keys(config.summaries).length) doc.summaries = config.summaries
  doc.views = config.views.map((v) => {
    const out: Record<string, unknown> = { type: v.type, name: v.name }
    if (v.limit != null) out.limit = v.limit
    if (v.filters) out.filters = v.filters
    if (v.groupBy) out.groupBy = v.groupBy
    if (v.order?.length) out.order = v.order
    if (v.summaries && Object.keys(v.summaries).length) out.summaries = v.summaries
    if (v.sort?.length) out.sort = v.sort
    for (const [key, val] of Object.entries(v)) {
      if (['type', 'name', 'limit', 'filters', 'groupBy', 'order', 'summaries', 'sort'].includes(key)) continue
      out[key] = val
    }
    return out
  })
  return stringifyYaml(doc, { lineWidth: 0 })
}

export function isBaseFileName(name: string): boolean {
  return /\.base$/i.test(name)
}

export function ensureBaseFileName(name: string): string {
  const trimmed = name.trim() || 'Untitled'
  if (/\.base$/i.test(trimmed)) return trimmed
  return `${trimmed.replace(/\.(md|markdown)$/i, '')}.base`
}

export function displayBaseName(name: string): string {
  return name.replace(/\.base$/i, '')
}

export function defaultBaseContent(): string {
  return DEFAULT_BASE_YAML
}

/** Extract view name from wiki target like `Projects.base#Table` */
export function splitBaseEmbedTarget(target: string): { file: string; view?: string } {
  const hash = target.indexOf('#')
  if (hash === -1) return { file: target.trim() }
  return { file: target.slice(0, hash).trim(), view: target.slice(hash + 1).trim() || undefined }
}
