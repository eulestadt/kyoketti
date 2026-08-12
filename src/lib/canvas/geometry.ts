import type { CanvasNode, NodeSide } from './types'

export type Point = { x: number; y: number }
export type Rect = { x: number; y: number; width: number; height: number }

export function nodeRect(node: CanvasNode): Rect {
  return { x: node.x, y: node.y, width: node.width, height: node.height }
}

export function sidePoint(node: CanvasNode, side: NodeSide = 'right'): Point {
  const { x, y, width, height } = node
  switch (side) {
    case 'top':
      return { x: x + width / 2, y }
    case 'bottom':
      return { x: x + width / 2, y: y + height }
    case 'left':
      return { x, y: y + height / 2 }
    case 'right':
    default:
      return { x: x + width, y: y + height / 2 }
  }
}

/** Pick the side of `node` closest to point `p`. */
export function nearestSide(node: CanvasNode, p: Point): NodeSide {
  const mid = { x: node.x + node.width / 2, y: node.y + node.height / 2 }
  const dx = p.x - mid.x
  const dy = p.y - mid.y
  if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? 'right' : 'left'
  return dy >= 0 ? 'bottom' : 'top'
}

export function boundsOfNodes(nodes: CanvasNode[]): Rect | null {
  if (!nodes.length) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.x)
    minY = Math.min(minY, n.y)
    maxX = Math.max(maxX, n.x + n.width)
    maxY = Math.max(maxY, n.y + n.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(a.x + a.width < b.x || b.x + b.width < a.x || a.y + a.height < b.y || b.y + b.height < a.y)
}

export function snap(value: number, grid = 20): number {
  return Math.round(value / grid) * grid
}

/** Cubic bezier path between two side anchors. */
export function edgePath(from: Point, to: Point, fromSide?: NodeSide, toSide?: NodeSide): string {
  const dist = Math.max(40, Math.hypot(to.x - from.x, to.y - from.y) * 0.35)
  const c1 = offsetAlongSide(from, fromSide ?? 'right', dist)
  const c2 = offsetAlongSide(to, toSide ?? 'left', dist)
  return `M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`
}

function offsetAlongSide(p: Point, side: NodeSide, dist: number): Point {
  switch (side) {
    case 'top':
      return { x: p.x, y: p.y - dist }
    case 'bottom':
      return { x: p.x, y: p.y + dist }
    case 'left':
      return { x: p.x - dist, y: p.y }
    case 'right':
    default:
      return { x: p.x + dist, y: p.y }
  }
}

export function midpointOnPath(from: Point, to: Point): Point {
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
}
