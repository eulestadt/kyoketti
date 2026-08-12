/** JSON Canvas 1.0 types (Obsidian .canvas). */

export type CanvasColor = string // "1"–"6" or "#RRGGBB"

export type NodeSide = 'top' | 'right' | 'bottom' | 'left'
export type EdgeEnd = 'none' | 'arrow'
export type BackgroundStyle = 'cover' | 'ratio' | 'repeat'
export type CanvasNodeType = 'text' | 'file' | 'link' | 'group'

export type CanvasNodeBase = {
  id: string
  type: CanvasNodeType
  x: number
  y: number
  width: number
  height: number
  color?: CanvasColor
}

export type TextNode = CanvasNodeBase & {
  type: 'text'
  text: string
}

export type FileNode = CanvasNodeBase & {
  type: 'file'
  file: string
  subpath?: string
}

export type LinkNode = CanvasNodeBase & {
  type: 'link'
  url: string
}

export type GroupNode = CanvasNodeBase & {
  type: 'group'
  label?: string
  background?: string
  backgroundStyle?: BackgroundStyle
}

export type CanvasNode = TextNode | FileNode | LinkNode | GroupNode

export type CanvasEdge = {
  id: string
  fromNode: string
  toNode: string
  fromSide?: NodeSide
  toSide?: NodeSide
  fromEnd?: EdgeEnd
  toEnd?: EdgeEnd
  color?: CanvasColor
  label?: string
}

export type CanvasData = {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

export const DEFAULT_CANVAS_JSON = `{
  "nodes": [
    {
      "id": "welcome",
      "type": "text",
      "x": 0,
      "y": 0,
      "width": 360,
      "height": 200,
      "text": "## Canvas\\n\\nDouble-click to add a card.\\nDrag from a card edge to connect.\\nUse the toolbar to add notes, links, and groups."
    }
  ],
  "edges": []
}
`
