import type {
  BackgroundStyle,
  CanvasData,
  CanvasEdge,
  CanvasNode,
  CanvasNodeType,
  EdgeEnd,
  NodeSide,
} from './types'
import { DEFAULT_CANVAS_JSON } from './types'

const SIDES = new Set<NodeSide>(['top', 'right', 'bottom', 'left'])
const ENDS = new Set<EdgeEnd>(['none', 'arrow'])
const TYPES = new Set<CanvasNodeType>(['text', 'file', 'link', 'group'])
const BG = new Set<BackgroundStyle>(['cover', 'ratio', 'repeat'])

export function newCanvasId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  }
  return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function asNumber(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

function asNode(raw: unknown): CanvasNode | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const type = String(o.type ?? '') as CanvasNodeType
  if (!TYPES.has(type)) return null
  const id = typeof o.id === 'string' && o.id ? o.id : newCanvasId()
  const base = {
    id,
    type,
    x: asNumber(o.x),
    y: asNumber(o.y),
    width: Math.max(40, asNumber(o.width, 250)),
    height: Math.max(40, asNumber(o.height, 120)),
    color: typeof o.color === 'string' ? o.color : undefined,
  }
  if (type === 'text') {
    return { ...base, type: 'text', text: typeof o.text === 'string' ? o.text : '' }
  }
  if (type === 'file') {
    if (typeof o.file !== 'string') return null
    return {
      ...base,
      type: 'file',
      file: o.file,
      subpath: typeof o.subpath === 'string' ? o.subpath : undefined,
    }
  }
  if (type === 'link') {
    if (typeof o.url !== 'string') return null
    return { ...base, type: 'link', url: o.url }
  }
  return {
    ...base,
    type: 'group',
    label: typeof o.label === 'string' ? o.label : undefined,
    background: typeof o.background === 'string' ? o.background : undefined,
    backgroundStyle:
      typeof o.backgroundStyle === 'string' && BG.has(o.backgroundStyle as BackgroundStyle)
        ? (o.backgroundStyle as BackgroundStyle)
        : undefined,
  }
}

function asEdge(raw: unknown): CanvasEdge | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.fromNode !== 'string' || typeof o.toNode !== 'string') return null
  return {
    id: typeof o.id === 'string' && o.id ? o.id : newCanvasId(),
    fromNode: o.fromNode,
    toNode: o.toNode,
    fromSide: typeof o.fromSide === 'string' && SIDES.has(o.fromSide as NodeSide) ? (o.fromSide as NodeSide) : undefined,
    toSide: typeof o.toSide === 'string' && SIDES.has(o.toSide as NodeSide) ? (o.toSide as NodeSide) : undefined,
    fromEnd: typeof o.fromEnd === 'string' && ENDS.has(o.fromEnd as EdgeEnd) ? (o.fromEnd as EdgeEnd) : undefined,
    toEnd: typeof o.toEnd === 'string' && ENDS.has(o.toEnd as EdgeEnd) ? (o.toEnd as EdgeEnd) : undefined,
    color: typeof o.color === 'string' ? o.color : undefined,
    label: typeof o.label === 'string' ? o.label : undefined,
  }
}

export function parseCanvasData(raw: string): { data: CanvasData; error?: string } {
  const text = raw.trim()
  if (!text) return { data: parseCanvasData(DEFAULT_CANVAS_JSON).data }
  try {
    const doc = JSON.parse(text) as unknown
    if (!doc || typeof doc !== 'object') {
      return { data: { nodes: [], edges: [] }, error: 'Canvas must be a JSON object' }
    }
    const root = doc as Record<string, unknown>
    const nodes = Array.isArray(root.nodes)
      ? (root.nodes.map(asNode).filter(Boolean) as CanvasNode[])
      : []
    const edges = Array.isArray(root.edges)
      ? (root.edges.map(asEdge).filter(Boolean) as CanvasEdge[])
      : []
    return { data: { nodes, edges } }
  } catch (err) {
    return {
      data: { nodes: [], edges: [] },
      error: err instanceof Error ? err.message : 'Invalid canvas JSON',
    }
  }
}

export function serializeCanvasData(data: CanvasData): string {
  return `${JSON.stringify({ nodes: data.nodes, edges: data.edges }, null, 2)}\n`
}

export function isCanvasFileName(name: string): boolean {
  return /\.canvas$/i.test(name)
}

export function ensureCanvasFileName(name: string): string {
  const trimmed = name.trim() || 'Untitled'
  if (/\.canvas$/i.test(trimmed)) return trimmed
  return `${trimmed.replace(/\.(md|markdown|base)$/i, '')}.canvas`
}

export function displayCanvasName(name: string): string {
  return name.replace(/\.canvas$/i, '')
}

export function defaultCanvasContent(): string {
  return DEFAULT_CANVAS_JSON
}
