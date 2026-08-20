import type { FilterNode } from './types'

export type FilterConjunction = 'and' | 'or' | 'not'

export type FilterOperatorId =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'is_empty'
  | 'is_not_empty'
  | 'has_tag'
  | 'in_folder'
  | 'has_link'
  | 'has_property'
  | 'is_true'
  | 'is_false'

export type UiFilterRow = {
  id: string
  property: string
  operator: FilterOperatorId
  value: string
}

export type UiFilterGroup = {
  conjunction: FilterConjunction
  rows: UiFilterRow[]
  /** Raw expression mode when the filter can't be represented as simple rows */
  advanced: boolean
  advancedText: string
}

export type OperatorOption = {
  id: FilterOperatorId
  label: string
  needsValue: boolean
}

const COMMON_OPS: OperatorOption[] = [
  { id: 'eq', label: 'is', needsValue: true },
  { id: 'neq', label: 'is not', needsValue: true },
  { id: 'contains', label: 'contains', needsValue: true },
  { id: 'not_contains', label: 'does not contain', needsValue: true },
  { id: 'starts_with', label: 'starts with', needsValue: true },
  { id: 'ends_with', label: 'ends with', needsValue: true },
  { id: 'is_empty', label: 'is empty', needsValue: false },
  { id: 'is_not_empty', label: 'is not empty', needsValue: false },
]

const NUMBER_OPS: OperatorOption[] = [
  { id: 'eq', label: '=', needsValue: true },
  { id: 'neq', label: '≠', needsValue: true },
  { id: 'gt', label: '>', needsValue: true },
  { id: 'gte', label: '≥', needsValue: true },
  { id: 'lt', label: '<', needsValue: true },
  { id: 'lte', label: '≤', needsValue: true },
  { id: 'is_empty', label: 'is empty', needsValue: false },
  { id: 'is_not_empty', label: 'is not empty', needsValue: false },
]

const BOOL_OPS: OperatorOption[] = [
  { id: 'is_true', label: 'is true', needsValue: false },
  { id: 'is_false', label: 'is false', needsValue: false },
  { id: 'is_empty', label: 'is empty', needsValue: false },
]

const TAG_OPS: OperatorOption[] = [
  { id: 'has_tag', label: 'has tag', needsValue: true },
  { id: 'contains', label: 'contains', needsValue: true },
  { id: 'is_empty', label: 'is empty', needsValue: false },
  { id: 'is_not_empty', label: 'is not empty', needsValue: false },
]

const FOLDER_OPS: OperatorOption[] = [
  { id: 'in_folder', label: 'is in folder', needsValue: true },
  { id: 'eq', label: 'is exactly', needsValue: true },
  { id: 'starts_with', label: 'starts with', needsValue: true },
  { id: 'is_empty', label: 'is vault root', needsValue: false },
]

const FILE_LINK_OPS: OperatorOption[] = [
  { id: 'has_link', label: 'has link to', needsValue: true },
  { id: 'contains', label: 'contains', needsValue: true },
  { id: 'is_empty', label: 'is empty', needsValue: false },
  { id: 'is_not_empty', label: 'is not empty', needsValue: false },
]

let idCounter = 0
export function newFilterRowId(): string {
  idCounter += 1
  return `fr-${Date.now()}-${idCounter}`
}

export function emptyFilterGroup(): UiFilterGroup {
  return { conjunction: 'and', rows: [], advanced: false, advancedText: '' }
}

export function operatorsForProperty(property: string): OperatorOption[] {
  if (property === 'file.tags' || property === 'tags') return TAG_OPS
  if (property === 'file.folder') return FOLDER_OPS
  if (property === 'file.links' || property === 'file.backlinks') return FILE_LINK_OPS
  if (property === 'file.size' || property === 'file.mtime' || property === 'file.ctime') return NUMBER_OPS
  if (property.startsWith('formula.')) return [...COMMON_OPS, ...NUMBER_OPS.filter((o) => !COMMON_OPS.some((c) => c.id === o.id))]
  // Heuristic: boolean-ish names
  if (/^(done|completed|checked|published|draft)$/i.test(property.replace(/^note\./, ''))) {
    return BOOL_OPS
  }
  return COMMON_OPS
}

export function quoteLiteral(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === '') return '""'
  if (trimmed === 'true' || trimmed === 'false' || trimmed === 'null') return trimmed
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed
  // already a function / expression
  if (/^(now|today|date|duration|if|list|link|file)\(/.test(trimmed)) return trimmed
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed
  }
  return JSON.stringify(trimmed)
}

function unquote(raw: string): string {
  const t = raw.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1)
  }
  return t
}

export function serializeFilterRow(row: UiFilterRow): string {
  const prop = row.property.trim() || 'file.name'
  const val = row.value
  switch (row.operator) {
    case 'eq':
      return `${prop} == ${quoteLiteral(val)}`
    case 'neq':
      return `${prop} != ${quoteLiteral(val)}`
    case 'gt':
      return `${prop} > ${quoteLiteral(val)}`
    case 'gte':
      return `${prop} >= ${quoteLiteral(val)}`
    case 'lt':
      return `${prop} < ${quoteLiteral(val)}`
    case 'lte':
      return `${prop} <= ${quoteLiteral(val)}`
    case 'contains':
      return `${prop}.contains(${quoteLiteral(val)})`
    case 'not_contains':
      return `!${prop}.contains(${quoteLiteral(val)})`
    case 'starts_with':
      return `${prop}.startsWith(${quoteLiteral(val)})`
    case 'ends_with':
      return `${prop}.endsWith(${quoteLiteral(val)})`
    case 'is_empty':
      return `${prop}.isEmpty()`
    case 'is_not_empty':
      return `!${prop}.isEmpty()`
    case 'has_tag':
      return `file.hasTag(${quoteLiteral(val.replace(/^#/, ''))})`
    case 'in_folder':
      return `file.inFolder(${quoteLiteral(val)})`
    case 'has_link':
      return `file.hasLink(${quoteLiteral(val)})`
    case 'has_property':
      return `file.hasProperty(${quoteLiteral(val || prop)})`
    case 'is_true':
      return `${prop} == true`
    case 'is_false':
      return `${prop} == false`
    default:
      return `${prop} == ${quoteLiteral(val)}`
  }
}

export function serializeUiFilterGroup(group: UiFilterGroup): FilterNode | undefined {
  if (group.advanced) {
    const text = group.advancedText.trim()
    return text || undefined
  }
  const exprs = group.rows
    .map(serializeFilterRow)
    .map((s) => s.trim())
    .filter(Boolean)
  if (!exprs.length) return undefined
  if (exprs.length === 1) return exprs[0]
  if (group.conjunction === 'and') return { and: exprs }
  if (group.conjunction === 'or') return { or: exprs }
  return { not: exprs }
}

/** Flatten a FilterNode into a UI group when possible. */
export function parseFilterNodeToUi(node: FilterNode | undefined): UiFilterGroup {
  if (node == null) return emptyFilterGroup()

  if (typeof node === 'string') {
    const row = parseExpressionToRow(node)
    if (row) return { conjunction: 'and', rows: [row], advanced: false, advancedText: '' }
    return { conjunction: 'and', rows: [], advanced: true, advancedText: node }
  }

  let conjunction: FilterConjunction = 'and'
  let items: FilterNode[] = []
  if ('and' in node) {
    conjunction = 'and'
    items = node.and
  } else if ('or' in node) {
    conjunction = 'or'
    items = node.or
  } else if ('not' in node) {
    conjunction = 'not'
    items = node.not
  }

  // Nested groups → advanced
  if (items.some((item) => typeof item !== 'string')) {
    return {
      conjunction,
      rows: [],
      advanced: true,
      advancedText: filterNodeToAdvancedText(node),
    }
  }

  const rows: UiFilterRow[] = []
  for (const item of items as string[]) {
    const row = parseExpressionToRow(item)
    if (!row) {
      return {
        conjunction,
        rows: [],
        advanced: true,
        advancedText: filterNodeToAdvancedText(node),
      }
    }
    rows.push(row)
  }
  return { conjunction, rows, advanced: false, advancedText: '' }
}

export function filterNodeToAdvancedText(node: FilterNode): string {
  if (typeof node === 'string') return node
  if ('and' in node) return node.and.map(filterNodeToAdvancedText).join(' && ')
  if ('or' in node) return node.or.map(filterNodeToAdvancedText).join(' || ')
  if ('not' in node) return `!(${node.not.map(filterNodeToAdvancedText).join(' || ')})`
  return ''
}

export function parseExpressionToRow(expr: string): UiFilterRow | null {
  const s = expr.trim()
  if (!s) return null

  let m =
    /^file\.hasTag\(\s*(['"])(.*?)\1\s*\)$/.exec(s) ||
    /^file\.hasTag\(\s*(.+?)\s*\)$/.exec(s)
  if (m) {
    return {
      id: newFilterRowId(),
      property: 'file.tags',
      operator: 'has_tag',
      value: unquote(m[2] ?? m[1] ?? ''),
    }
  }

  m = /^file\.inFolder\(\s*(['"])(.*?)\1\s*\)$/.exec(s) || /^file\.inFolder\(\s*(.+?)\s*\)$/.exec(s)
  if (m) {
    return {
      id: newFilterRowId(),
      property: 'file.folder',
      operator: 'in_folder',
      value: unquote(m[2] ?? m[1] ?? ''),
    }
  }

  m = /^file\.hasLink\(\s*(['"])(.*?)\1\s*\)$/.exec(s) || /^file\.hasLink\(\s*(.+?)\s*\)$/.exec(s)
  if (m) {
    return {
      id: newFilterRowId(),
      property: 'file.links',
      operator: 'has_link',
      value: unquote(m[2] ?? m[1] ?? ''),
    }
  }

  m = /^file\.hasProperty\(\s*(['"])(.*?)\1\s*\)$/.exec(s) || /^file\.hasProperty\(\s*(.+?)\s*\)$/.exec(s)
  if (m) {
    return {
      id: newFilterRowId(),
      property: 'file.properties',
      operator: 'has_property',
      value: unquote(m[2] ?? m[1] ?? ''),
    }
  }

  m = /^!(.+)\.isEmpty\(\)$/.exec(s)
  if (m) {
    return { id: newFilterRowId(), property: m[1]!, operator: 'is_not_empty', value: '' }
  }
  m = /^(.+)\.isEmpty\(\)$/.exec(s)
  if (m) {
    return { id: newFilterRowId(), property: m[1]!, operator: 'is_empty', value: '' }
  }

  m = /^!(.+)\.contains\((.+)\)$/.exec(s)
  if (m) {
    return {
      id: newFilterRowId(),
      property: m[1]!,
      operator: 'not_contains',
      value: unquote(m[2]!),
    }
  }
  m = /^(.+)\.contains\((.+)\)$/.exec(s)
  if (m) {
    return {
      id: newFilterRowId(),
      property: m[1]!,
      operator: 'contains',
      value: unquote(m[2]!),
    }
  }
  m = /^(.+)\.startsWith\((.+)\)$/.exec(s)
  if (m) {
    return {
      id: newFilterRowId(),
      property: m[1]!,
      operator: 'starts_with',
      value: unquote(m[2]!),
    }
  }
  m = /^(.+)\.endsWith\((.+)\)$/.exec(s)
  if (m) {
    return {
      id: newFilterRowId(),
      property: m[1]!,
      operator: 'ends_with',
      value: unquote(m[2]!),
    }
  }

  m = /^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/.exec(s)
  if (m) {
    const prop = m[1]!.trim()
    const op = m[2]!
    const value = unquote(m[3]!)
    if (op === '==' && value === 'true') {
      return { id: newFilterRowId(), property: prop, operator: 'is_true', value: '' }
    }
    if (op === '==' && value === 'false') {
      return { id: newFilterRowId(), property: prop, operator: 'is_false', value: '' }
    }
    const map: Record<string, FilterOperatorId> = {
      '==': 'eq',
      '!=': 'neq',
      '>': 'gt',
      '>=': 'gte',
      '<': 'lt',
      '<=': 'lte',
    }
    return {
      id: newFilterRowId(),
      property: prop,
      operator: map[op] ?? 'eq',
      value,
    }
  }

  return null
}

export function countFilterConditions(node: FilterNode | undefined): number {
  if (node == null) return 0
  if (typeof node === 'string') return node.trim() ? 1 : 0
  if ('and' in node) return node.and.reduce((n, x) => n + countFilterConditions(x), 0)
  if ('or' in node) return node.or.reduce((n, x) => n + countFilterConditions(x), 0)
  if ('not' in node) return node.not.reduce((n, x) => n + countFilterConditions(x), 0)
  return 0
}

export const BUILTIN_FILTER_PROPERTIES: Array<{ value: string; label: string }> = [
  { value: 'file.name', label: 'File name' },
  { value: 'file.basename', label: 'File basename' },
  { value: 'file.ext', label: 'Extension' },
  { value: 'file.folder', label: 'Folder' },
  { value: 'file.path', label: 'Path' },
  { value: 'file.tags', label: 'Tags' },
  { value: 'file.links', label: 'Links' },
  { value: 'file.size', label: 'Size' },
  { value: 'file.mtime', label: 'Modified' },
  { value: 'file.ctime', label: 'Created' },
]

export const FILTER_PRESETS: Array<{
  label: string
  apply: (group: UiFilterGroup) => UiFilterGroup
}> = [
  {
    label: 'Markdown only',
    apply: (group) => ({
      ...group,
      advanced: false,
      rows: [
        ...group.rows.filter((r) => !(r.property === 'file.ext' && r.operator === 'eq')),
        { id: newFilterRowId(), property: 'file.ext', operator: 'eq', value: 'md' },
      ],
    }),
  },
  {
    label: 'Has tag…',
    apply: (group) => ({
      ...group,
      advanced: false,
      rows: [
        ...group.rows,
        { id: newFilterRowId(), property: 'file.tags', operator: 'has_tag', value: '' },
      ],
    }),
  },
  {
    label: 'In folder…',
    apply: (group) => ({
      ...group,
      advanced: false,
      rows: [
        ...group.rows,
        { id: newFilterRowId(), property: 'file.folder', operator: 'in_folder', value: '' },
      ],
    }),
  },
]
