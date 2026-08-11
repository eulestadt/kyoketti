/** Obsidian Bases schema types (YAML .base / ```base). */

export type BaseViewType = 'table' | 'list' | 'cards' | 'map'

export type FilterNode =
  | string
  | { and: FilterNode[] }
  | { or: FilterNode[] }
  | { not: FilterNode[] }

export type PropertyConfig = {
  displayName?: string
  [key: string]: unknown
}

export type GroupByConfig = {
  property: string
  direction?: 'ASC' | 'DESC' | string
}

export type SortConfig = {
  property: string
  direction?: 'ASC' | 'DESC' | string
}

export type BaseView = {
  type: BaseViewType | string
  name: string
  limit?: number
  filters?: FilterNode
  groupBy?: GroupByConfig | string
  order?: string[]
  summaries?: Record<string, string>
  sort?: SortConfig[]
  /** Cards / list optional display props */
  columns?: number
  imageProperty?: string
  /** Map view stubs */
  lat?: string
  long?: string
  title?: string
  [key: string]: unknown
}

export type BaseConfig = {
  filters?: FilterNode
  formulas?: Record<string, string>
  properties?: Record<string, PropertyConfig>
  summaries?: Record<string, string>
  views: BaseView[]
}

export type BaseLink = {
  __type: 'link'
  path: string
  display?: string
}

export type BaseFileRef = {
  __type: 'file'
  id: string
  name: string
  basename: string
  path: string
  folder: string
  ext: string
  size: number
  ctime: Date
  mtime: Date
  tags: string[]
  links: string[]
  embeds: string[]
  properties: Record<string, unknown>
  content: string
}

export type BaseRow = {
  id: string
  file: BaseFileRef
  note: Record<string, unknown>
  formulas: Record<string, unknown>
  /** Resolved display values keyed by property id */
  values: Record<string, unknown>
}

export type BaseQueryResult = {
  rows: BaseRow[]
  groups: Array<{ key: string; label: string; rows: BaseRow[] }>
  summaries: Record<string, unknown>
  total: number
  limited: boolean
}

export const DEFAULT_BASE_YAML = `filters:
  and:
    - 'file.ext == "md"'
formulas: {}
properties:
  file.name:
    displayName: Name
  file.mtime:
    displayName: Modified
  file.size:
    displayName: Size
views:
  - type: table
    name: Table
    order:
      - file.name
      - file.mtime
      - file.size
  - type: list
    name: List
    order:
      - file.name
  - type: cards
    name: Cards
    order:
      - file.name
`
