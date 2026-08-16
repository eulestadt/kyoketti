import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Code2,
  FileText,
  Globe,
  Group,
  Maximize2,
  Minus,
  Plus,
  StickyNote,
  Trash2,
  Focus,
} from 'lucide-react'
import { useApp } from '../../hooks/useApp'
import { useTheme } from '../../hooks/useTheme'
import {
  CANVAS_PRESET_COLORS,
  boundsOfNodes,
  defaultCanvasContent,
  edgePath,
  midpointOnPath,
  nearestSide,
  newCanvasId,
  nodeRect,
  parseCanvasData,
  rectsIntersect,
  resolveCanvasColor,
  serializeCanvasData,
  sidePoint,
  snap,
  type CanvasData,
  type CanvasNode,
  type NodeSide,
  type Point,
} from '../../lib/canvas'
import { renderMarkdownToHtml } from '../../lib/markdown'
import { resolveNoteRef } from '../../lib/vaultIndex'
import { compactItems, ContextMenu, type ContextMenuItem } from '../ui/ContextMenu'
import { copyText, copyWikilink } from '../../lib/clipboard'
import './CanvasViewer.css'

type CanvasMenu =
  | { kind: 'stage'; x: number; y: number; world: Point }
  | { kind: 'node'; x: number; y: number; id: string }
  | { kind: 'edge'; x: number; y: number; id: string }

type Props = {
  content: string
  onChange?: (content: string) => void
  embedded?: boolean
  readOnly?: boolean
}

type DragState =
  | { kind: 'pan'; sx: number; sy: number; ox: number; oy: number }
  | { kind: 'move'; ids: string[]; start: Point; origins: Record<string, Point>; snapOff: boolean }
  | { kind: 'resize'; id: string; start: Point; ow: number; oh: number }
  | { kind: 'connect'; fromId: string; fromSide: NodeSide; to: Point }
  | { kind: 'marquee'; start: Point; current: Point }
  | null

export function CanvasViewer({ content, onChange, embedded = false, readOnly = false }: Props) {
  const { index, openFile, openNoteByTitle, createNote, vault } = useApp()
  const { theme } = useTheme()
  const parsed = useMemo(() => parseCanvasData(content || defaultCanvasContent()), [content])
  const [data, setData] = useState<CanvasData>(parsed.data)
  const [showSource, setShowSource] = useState(false)
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set())
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null)
  const [spaceDown, setSpaceDown] = useState(false)
  const [camera, setCamera] = useState({ x: 80, y: 80, zoom: 1 })
  const [drag, setDrag] = useState<DragState>(null)
  const [contextMenu, setContextMenu] = useState<CanvasMenu | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const dataRef = useRef(data)
  dataRef.current = data

  useEffect(() => {
    setData(parsed.data)
  }, [parsed.data])

  const commit = useCallback(
    (next: CanvasData | ((prev: CanvasData) => CanvasData)) => {
      setData((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next
        if (onChange && !readOnly) onChange(serializeCanvasData(resolved))
        return resolved
      })
    },
    [onChange, readOnly],
  )

  const nodeMap = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data.nodes])

  const screenToWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = stageRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      return {
        x: (clientX - rect.left - camera.x) / camera.zoom,
        y: (clientY - rect.top - camera.y) / camera.zoom,
      }
    },
    [camera],
  )

  const updateNode = useCallback(
    (id: string, patch: Partial<CanvasNode>) => {
      commit((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => (n.id === id ? ({ ...n, ...patch } as CanvasNode) : n)),
      }))
    },
    [commit],
  )

  const deleteSelection = useCallback(
    (override?: { nodeIds?: Iterable<string>; edgeId?: string | null }) => {
      if (readOnly) return
      const removeNodes = new Set(override?.nodeIds ?? selectedNodeIds)
      const extraEdge = override && 'edgeId' in override ? override.edgeId : selectedEdgeId
      commit((prev) => {
        const removeEdges = new Set(
          prev.edges
            .filter(
              (e) =>
                e.id === extraEdge ||
                removeNodes.has(e.fromNode) ||
                removeNodes.has(e.toNode),
            )
            .map((e) => e.id),
        )
        if (extraEdge) removeEdges.add(extraEdge)
        return {
          nodes: prev.nodes.filter((n) => !removeNodes.has(n.id)),
          edges: prev.edges.filter((e) => !removeEdges.has(e.id)),
        }
      })
      setSelectedNodeIds(new Set())
      setSelectedEdgeId(null)
      setEditingNodeId(null)
    },
    [commit, readOnly, selectedEdgeId, selectedNodeIds],
  )

  const addTextNode = useCallback(
    (at?: Point, text = '') => {
      if (readOnly) return
      const p = at ?? screenToWorld(
        (stageRef.current?.getBoundingClientRect().left ?? 0) + 120,
        (stageRef.current?.getBoundingClientRect().top ?? 0) + 120,
      )
      const id = newCanvasId()
      const node: CanvasNode = {
        id,
        type: 'text',
        x: snap(p.x - 130),
        y: snap(p.y - 60),
        width: 260,
        height: 140,
        text: text || 'New card',
      }
      commit((prev) => ({ ...prev, nodes: [...prev.nodes, node] }))
      setSelectedNodeIds(new Set([id]))
      setEditingNodeId(id)
      setContextMenu(null)
    },
    [commit, readOnly, screenToWorld],
  )

  const addFileNode = useCallback(
    async (at?: Point) => {
      if (readOnly) return
      const title = window.prompt('Note name or path to add')
      if (!title?.trim()) return
      let note = resolveNoteRef(index, title.trim())
      if (!note && vault?.folderId) {
        const create = window.confirm(`“${title.trim()}” not found. Create it?`)
        if (create) {
          await createNote(vault.folderId, title.trim())
          // index may lag; still place a file card by basename
        }
      }
      note = resolveNoteRef(index, title.trim())
      const filePath = note?.path ?? (title.trim().endsWith('.md') ? title.trim() : `${title.trim()}.md`)
      const p = at ?? { x: 0, y: 0 }
      const id = newCanvasId()
      commit((prev) => ({
        ...prev,
        nodes: [
          ...prev.nodes,
          {
            id,
            type: 'file',
            x: snap(p.x),
            y: snap(p.y),
            width: 280,
            height: 200,
            file: filePath,
          },
        ],
      }))
      setSelectedNodeIds(new Set([id]))
      setContextMenu(null)
    },
    [commit, createNote, index, readOnly, vault?.folderId],
  )

  const addLinkNode = useCallback(
    (at?: Point) => {
      if (readOnly) return
      const url = window.prompt('URL', 'https://')
      if (!url?.trim()) return
      const p = at ?? { x: 0, y: 0 }
      const id = newCanvasId()
      commit((prev) => ({
        ...prev,
        nodes: [
          ...prev.nodes,
          {
            id,
            type: 'link',
            x: snap(p.x),
            y: snap(p.y),
            width: 320,
            height: 220,
            url: url.trim(),
          },
        ],
      }))
      setSelectedNodeIds(new Set([id]))
      setContextMenu(null)
    },
    [commit, readOnly],
  )

  const addGroup = useCallback(
    (at?: Point) => {
      if (readOnly) return
      const selected = data.nodes.filter((n) => selectedNodeIds.has(n.id) && n.type !== 'group')
      const bounds = selected.length ? boundsOfNodes(selected) : null
      const id = newCanvasId()
      const pad = 40
      const node: CanvasNode = bounds
        ? {
            id,
            type: 'group',
            x: bounds.x - pad,
            y: bounds.y - pad - 20,
            width: bounds.width + pad * 2,
            height: bounds.height + pad * 2 + 20,
            label: 'Group',
          }
        : {
            id,
            type: 'group',
            x: snap((at?.x ?? 0) - 100),
            y: snap((at?.y ?? 0) - 80),
            width: 400,
            height: 300,
            label: 'Group',
          }
      commit((prev) => ({
        // groups should render under other nodes → insert first
        nodes: [node, ...prev.nodes],
        edges: prev.edges,
      }))
      setSelectedNodeIds(new Set([id]))
      setContextMenu(null)
    },
    [commit, data.nodes, readOnly, selectedNodeIds],
  )

  const zoomToFit = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return
    const bounds = boundsOfNodes(data.nodes)
    if (!bounds) {
      setCamera({ x: 80, y: 80, zoom: 1 })
      return
    }
    const pad = 64
    const zw = (stage.clientWidth - pad * 2) / Math.max(bounds.width, 1)
    const zh = (stage.clientHeight - pad * 2) / Math.max(bounds.height, 1)
    const zoom = Math.min(1.5, Math.max(0.2, Math.min(zw, zh)))
    setCamera({
      zoom,
      x: pad - bounds.x * zoom + (stage.clientWidth - pad * 2 - bounds.width * zoom) / 2,
      y: pad - bounds.y * zoom + (stage.clientHeight - pad * 2 - bounds.height * zoom) / 2,
    })
  }, [data.nodes])

  const zoomToSelection = useCallback(() => {
    const selected = data.nodes.filter((n) => selectedNodeIds.has(n.id))
    const stage = stageRef.current
    const bounds = boundsOfNodes(selected.length ? selected : data.nodes)
    if (!stage || !bounds) return
    const pad = 80
    const zw = (stage.clientWidth - pad * 2) / Math.max(bounds.width, 1)
    const zh = (stage.clientHeight - pad * 2) / Math.max(bounds.height, 1)
    const zoom = Math.min(1.8, Math.max(0.25, Math.min(zw, zh)))
    setCamera({
      zoom,
      x: pad - bounds.x * zoom,
      y: pad - bounds.y * zoom,
    })
  }, [data.nodes, selectedNodeIds])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === ' ') setSpaceDown(true)
      if (e.key === 'Escape') {
        setEditingNodeId(null)
        setEditingEdgeId(null)
        setContextMenu(null)
        setSelectedEdgeId(null)
        if (!e.metaKey && !e.ctrlKey) setSelectedNodeIds(new Set())
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !editingNodeId && !editingEdgeId) {
        const tag = (e.target as HTMLElement)?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        e.preventDefault()
        deleteSelection()
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && !editingNodeId) {
        e.preventDefault()
        setSelectedNodeIds(new Set(dataRef.current.nodes.map((n) => n.id)))
      }
      if (e.shiftKey && e.key === '1') {
        e.preventDefault()
        zoomToFit()
      }
      if (e.shiftKey && e.key === '2') {
        e.preventDefault()
        zoomToSelection()
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === ' ') setSpaceDown(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [deleteSelection, editingEdgeId, editingNodeId, zoomToFit, zoomToSelection])

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!drag) return
      if (drag.kind === 'pan') {
        setCamera((c) => ({
          ...c,
          x: drag.ox + (e.clientX - drag.sx),
          y: drag.oy + (e.clientY - drag.sy),
        }))
        return
      }
      const world = screenToWorld(e.clientX, e.clientY)
      if (drag.kind === 'move') {
        const dx = world.x - drag.start.x
        const dy = world.y - drag.start.y
        const useSnap = !e.altKey && !drag.snapOff && !spaceDown
        commit((prev) => ({
          ...prev,
          nodes: prev.nodes.map((n) => {
            if (!drag.ids.includes(n.id)) return n
            const o = drag.origins[n.id]!
            const x = useSnap ? snap(o.x + dx) : o.x + dx
            const y = useSnap ? snap(o.y + dy) : o.y + dy
            return { ...n, x, y }
          }),
        }))
        return
      }
      if (drag.kind === 'resize') {
        const dw = world.x - drag.start.x
        const dh = world.y - drag.start.y
        updateNode(drag.id, {
          width: Math.max(80, snap(drag.ow + dw)),
          height: Math.max(60, snap(drag.oh + dh)),
        })
        return
      }
      if (drag.kind === 'connect') {
        setDrag({ ...drag, to: world })
        return
      }
      if (drag.kind === 'marquee') {
        setDrag({ ...drag, current: world })
      }
    }
    function onUp(e: PointerEvent) {
      if (!drag) return
      if (drag.kind === 'connect') {
        const world = screenToWorld(e.clientX, e.clientY)
        const hit = [...dataRef.current.nodes]
          .reverse()
          .find(
            (n) =>
              n.id !== drag.fromId &&
              world.x >= n.x &&
              world.x <= n.x + n.width &&
              world.y >= n.y &&
              world.y <= n.y + n.height,
          )
        if (hit) {
          const toSide = nearestSide(hit, world)
          commit((prev) => ({
            ...prev,
            edges: [
              ...prev.edges,
              {
                id: newCanvasId(),
                fromNode: drag.fromId,
                fromSide: drag.fromSide,
                toNode: hit.id,
                toSide,
                toEnd: 'arrow',
              },
            ],
          }))
        } else if (!readOnly) {
          // Create text card at drop end
          const id = newCanvasId()
          commit((prev) => ({
            nodes: [
              ...prev.nodes,
              {
                id,
                type: 'text',
                x: snap(world.x - 100),
                y: snap(world.y - 50),
                width: 220,
                height: 120,
                text: '',
              },
            ],
            edges: [
              ...prev.edges,
              {
                id: newCanvasId(),
                fromNode: drag.fromId,
                fromSide: drag.fromSide,
                toNode: id,
                toSide: 'left',
                toEnd: 'arrow',
              },
            ],
          }))
          setSelectedNodeIds(new Set([id]))
          setEditingNodeId(id)
        }
      }
      if (drag.kind === 'marquee') {
        const x1 = Math.min(drag.start.x, drag.current.x)
        const y1 = Math.min(drag.start.y, drag.current.y)
        const x2 = Math.max(drag.start.x, drag.current.x)
        const y2 = Math.max(drag.start.y, drag.current.y)
        const box = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
        const hits = dataRef.current.nodes
          .filter((n) => rectsIntersect(nodeRect(n), box))
          .map((n) => n.id)
        setSelectedNodeIds(new Set(hits))
        setSelectedEdgeId(null)
      }
      setDrag(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [commit, drag, readOnly, screenToWorld, spaceDown, updateNode])

  function onStagePointerDown(e: React.PointerEvent) {
    if (e.button === 1 || spaceDown || (e.button === 0 && e.altKey && !(e.target as HTMLElement).closest('.canvas-node'))) {
      setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, ox: camera.x, oy: camera.y })
      return
    }
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('.canvas-node') || target.closest('.canvas-edge-label') || target.closest('.edge-hit')) {
      return
    }
    setEditingNodeId(null)
    setContextMenu(null)
    if (!e.shiftKey) {
      setSelectedNodeIds(new Set())
      setSelectedEdgeId(null)
    }
    const world = screenToWorld(e.clientX, e.clientY)
    setDrag({ kind: 'marquee', start: world, current: world })
  }

  function onStageDoubleClick(e: React.MouseEvent) {
    if (readOnly || embedded) return
    if ((e.target as HTMLElement).closest('.canvas-node')) return
    addTextNode(screenToWorld(e.clientX, e.clientY), '')
  }

  function onStageWheel(e: React.WheelEvent) {
    if (e.ctrlKey || e.metaKey || spaceDown) {
      e.preventDefault()
      const rect = stageRef.current?.getBoundingClientRect()
      if (!rect) return
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const factor = e.deltaY > 0 ? 0.9 : 1.1
      setCamera((c) => {
        const zoom = Math.min(2.5, Math.max(0.15, c.zoom * factor))
        const wx = (mx - c.x) / c.zoom
        const wy = (my - c.y) / c.zoom
        return { zoom, x: mx - wx * zoom, y: my - wy * zoom }
      })
      return
    }
    // Pan with scroll / shift+scroll
    setCamera((c) => ({
      ...c,
      x: c.x - (e.shiftKey ? e.deltaY : e.deltaX || 0),
      y: c.y - (e.shiftKey ? 0 : e.deltaY),
    }))
  }

  function onStageContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    setContextMenu({
      kind: 'stage',
      x: e.clientX,
      y: e.clientY,
      world: screenToWorld(e.clientX, e.clientY),
    })
  }

  function onNodeContextMenu(e: React.MouseEvent, id: string) {
    e.preventDefault()
    e.stopPropagation()
    setSelectedEdgeId(null)
    setSelectedNodeIds(new Set([id]))
    setContextMenu({ kind: 'node', x: e.clientX, y: e.clientY, id })
  }

  function onEdgeContextMenu(e: React.MouseEvent, id: string) {
    e.preventDefault()
    e.stopPropagation()
    setSelectedNodeIds(new Set())
    setSelectedEdgeId(id)
    setContextMenu({ kind: 'edge', x: e.clientX, y: e.clientY, id })
  }

  function duplicateNode(id: string) {
    if (readOnly) return
    const node = dataRef.current.nodes.find((n) => n.id === id)
    if (!node) return
    const copy = { ...node, id: newCanvasId(), x: node.x + 32, y: node.y + 32 }
    commit((prev) => ({ ...prev, nodes: [...prev.nodes, copy] }))
    setSelectedNodeIds(new Set([copy.id]))
  }

  function focusCanvasNode(id: string) {
    const n = dataRef.current.nodes.find((node) => node.id === id)
    const stage = stageRef.current
    if (!n || !stage) return
    setSelectedNodeIds(new Set([id]))
    setSelectedEdgeId(null)
    setCamera((c) => ({
      ...c,
      x: stage.clientWidth / 2 - (n.x + n.width / 2) * c.zoom,
      y: stage.clientHeight / 2 - (n.y + n.height / 2) * c.zoom,
    }))
  }

  async function convertTextToFile(id: string) {
    if (readOnly || !vault?.folderId) return
    const node = dataRef.current.nodes.find((n) => n.id === id)
    if (!node || node.type !== 'text') return
    const name = window.prompt('File name', 'Untitled')
    if (!name?.trim()) return
    const body = node.text.endsWith('\n') ? node.text : `${node.text}\n`
    const created = await createNote(vault.folderId, name.trim(), { content: body, open: false })
    commit((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) =>
        n.id === id
          ? {
              id: n.id,
              type: 'file' as const,
              x: n.x,
              y: n.y,
              width: n.width,
              height: n.height,
              color: n.color,
              file: created.path || created.name,
            }
          : n,
      ),
    }))
  }

  async function swapFileCard(id: string) {
    if (readOnly) return
    const node = dataRef.current.nodes.find((n) => n.id === id)
    if (!node || node.type !== 'file') return
    const title = window.prompt('Note name or path', node.file)
    if (!title?.trim()) return
    const note = resolveNoteRef(index, title.trim())
    updateNode(id, { file: note?.path ?? title.trim() } as Partial<CanvasNode>)
  }

  function canvasMenuItems(menu: CanvasMenu): ContextMenuItem[] {
    if (menu.kind === 'stage') {
      return compactItems([
        !readOnly && { label: 'Add text card', onClick: () => addTextNode(menu.world) },
        !readOnly && { label: 'Add note from vault', onClick: () => void addFileNode(menu.world) },
        !readOnly && { label: 'Add web page', onClick: () => addLinkNode(menu.world) },
        !readOnly && { label: 'Create group', onClick: () => addGroup(menu.world) },
        { type: 'separator' as const },
        { label: 'Zoom to fit', onClick: zoomToFit },
      ])
    }
    if (menu.kind === 'edge') {
      const edge = data.edges.find((e) => e.id === menu.id)
      if (!edge) return []
      return compactItems([
        !readOnly && {
          label: 'Edit label',
          onClick: () => {
            setEditingEdgeId(edge.id)
            setSelectedEdgeId(edge.id)
          },
        },
        { label: 'Go to source', onClick: () => focusCanvasNode(edge.fromNode) },
        { label: 'Go to target', onClick: () => focusCanvasNode(edge.toNode) },
        !readOnly && { type: 'separator' as const },
        !readOnly && {
          label: 'Delete',
          danger: true,
          onClick: () => deleteSelection({ nodeIds: [], edgeId: edge.id }),
        },
      ])
    }
    const node = data.nodes.find((n) => n.id === menu.id)
    if (!node) return []
    return compactItems([
      !readOnly && (node.type === 'text' || node.type === 'group') && {
        label: 'Edit',
        onClick: () => setEditingNodeId(node.id),
      },
      node.type === 'file' && {
        label: 'Open',
        onClick: async () => {
          const note = resolveNoteRef(index, node.file)
          if (note) await openFile(note.id)
          else await openNoteByTitle(node.file.replace(/\.(md|markdown)$/i, ''))
        },
      },
      node.type === 'file' && {
        label: 'Copy wikilink',
        onClick: () => {
          const note = resolveNoteRef(index, node.file)
          void copyWikilink(note?.name ?? node.file, note?.path ?? node.file, index)
        },
      },
      !readOnly && node.type === 'file' && {
        label: 'Swap file',
        onClick: () => void swapFileCard(node.id),
      },
      node.type === 'link' && {
        label: 'Open in browser',
        onClick: () => {
          window.open(node.url, '_blank', 'noopener,noreferrer')
        },
      },
      node.type === 'link' && {
        label: 'Copy URL',
        onClick: () => void copyText(node.url),
      },
      Boolean(!readOnly && node.type === 'text' && vault?.folderId) && {
        label: 'Convert to file',
        onClick: () => void convertTextToFile(node.id),
      },
      !readOnly && { label: 'Duplicate', onClick: () => duplicateNode(node.id) },
      node.type === 'text' && {
        label: 'Copy text',
        onClick: () => void copyText(node.text),
      },
      Boolean(node.type === 'group' && node.label) && {
        label: 'Copy label',
        onClick: () => void copyText(node.type === 'group' ? node.label ?? '' : ''),
      },
      !readOnly && { type: 'separator' as const },
      !readOnly && {
        label: 'Delete',
        danger: true,
        onClick: () => deleteSelection({ nodeIds: [node.id], edgeId: null }),
      },
    ])
  }

  function setColorOnSelection(color: string | undefined) {
    if (selectedEdgeId) {
      commit((prev) => ({
        ...prev,
        edges: prev.edges.map((ed) => (ed.id === selectedEdgeId ? { ...ed, color } : ed)),
      }))
      return
    }
    commit((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) =>
        selectedNodeIds.has(n.id) ? ({ ...n, color } as CanvasNode) : n,
      ),
    }))
  }

  const selectionBounds = useMemo(() => {
    const nodes = data.nodes.filter((n) => selectedNodeIds.has(n.id))
    return boundsOfNodes(nodes)
  }, [data.nodes, selectedNodeIds])

  if (showSource && !embedded) {
    return (
      <div className="canvas-viewer">
        <div className="canvas-toolbar">
          <button type="button" className="canvas-tool active" onClick={() => setShowSource(false)}>
            Canvas
          </button>
          <span className="canvas-toolbar-spacer" />
          <button type="button" className="canvas-tool active" onClick={() => setShowSource(true)}>
            <Code2 size={14} /> Source
          </button>
        </div>
        {parsed.error && <div className="canvas-error">JSON: {parsed.error}</div>}
        <textarea
          className="canvas-source"
          value={content}
          onChange={(e) => onChange?.(e.target.value)}
          spellCheck={false}
        />
      </div>
    )
  }

  return (
    <div className="canvas-viewer">
      <div className="canvas-toolbar">
        {!readOnly && (
          <>
            <button type="button" className="canvas-tool" title="Add text card" onClick={() => addTextNode()}>
              <StickyNote size={14} /> Text
            </button>
            <button type="button" className="canvas-tool" title="Add note from vault" onClick={() => void addFileNode()}>
              <FileText size={14} /> Note
            </button>
            <button type="button" className="canvas-tool" title="Add web page" onClick={() => addLinkNode()}>
              <Globe size={14} /> Web
            </button>
            <button type="button" className="canvas-tool" title="Create group" onClick={() => addGroup()}>
              <Group size={14} /> Group
            </button>
            <button type="button" className="canvas-tool" title="Delete selection" onClick={() => deleteSelection()}>
              <Trash2 size={14} />
            </button>
          </>
        )}
        <span className="canvas-toolbar-spacer" />
        <button type="button" className="canvas-tool" onClick={() => setCamera((c) => ({ ...c, zoom: Math.max(0.15, c.zoom * 0.9) }))}>
          <Minus size={14} />
        </button>
        <span className="canvas-zoom-label">{Math.round(camera.zoom * 100)}%</span>
        <button type="button" className="canvas-tool" onClick={() => setCamera((c) => ({ ...c, zoom: Math.min(2.5, c.zoom * 1.1) }))}>
          <Plus size={14} />
        </button>
        <button type="button" className="canvas-tool" title="Zoom to fit (Shift+1)" onClick={zoomToFit}>
          <Maximize2 size={14} />
        </button>
        <button type="button" className="canvas-tool" title="Zoom to selection (Shift+2)" onClick={zoomToSelection}>
          <Focus size={14} />
        </button>
        <button type="button" className="canvas-tool" title="Reset zoom" onClick={() => setCamera({ x: 80, y: 80, zoom: 1 })}>
          100%
        </button>
        {!embedded && (
          <button type="button" className="canvas-tool" onClick={() => setShowSource(true)}>
            <Code2 size={14} />
          </button>
        )}
      </div>
      {parsed.error && <div className="canvas-error">JSON: {parsed.error}</div>}

      <div
        ref={stageRef}
        className={`canvas-stage ${drag?.kind === 'pan' || spaceDown ? 'is-panning' : ''} ${drag?.kind === 'connect' ? 'is-connecting' : ''}`}
        onPointerDown={onStagePointerDown}
        onDoubleClick={onStageDoubleClick}
        onWheel={onStageWheel}
        onContextMenu={onStageContextMenu}
      >
        {!data.nodes.length && <div className="canvas-empty-hint">Double-click to add a card</div>}
        <div
          className="canvas-world"
          style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}
        >
          <div className="canvas-grid" />

          <svg className="canvas-edges" width={8000} height={8000} style={{ left: -4000, top: -4000 }}>
            <defs>
              <marker id="canvas-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill="context-stroke" />
              </marker>
            </defs>
            <g transform="translate(4000,4000)">
              {data.edges.map((edge) => {
                const from = nodeMap.get(edge.fromNode)
                const to = nodeMap.get(edge.toNode)
                if (!from || !to) return null
                const a = sidePoint(from, edge.fromSide ?? 'right')
                const b = sidePoint(to, edge.toSide ?? 'left')
                const d = edgePath(a, b, edge.fromSide, edge.toSide)
                const stroke = resolveCanvasColor(edge.color, theme, 'var(--text-muted, #888)')
                const selected = selectedEdgeId === edge.id
                return (
                  <g key={edge.id}>
                    <path
                      className="edge-hit"
                      d={d}
                      onPointerDown={(ev) => {
                        ev.stopPropagation()
                        setSelectedEdgeId(edge.id)
                        setSelectedNodeIds(new Set())
                        setEditingNodeId(null)
                      }}
                      onContextMenu={(ev) => onEdgeContextMenu(ev, edge.id)}
                      onDoubleClick={(ev) => {
                        ev.stopPropagation()
                        setEditingEdgeId(edge.id)
                        setSelectedEdgeId(edge.id)
                      }}
                    />
                    <path
                      className={`edge-line ${selected ? 'selected' : ''}`}
                      d={d}
                      stroke={stroke}
                      markerEnd={(edge.toEnd ?? 'arrow') === 'arrow' ? 'url(#canvas-arrow)' : undefined}
                      markerStart={edge.fromEnd === 'arrow' ? 'url(#canvas-arrow)' : undefined}
                    />
                  </g>
                )
              })}
              {drag?.kind === 'connect' && (() => {
                const from = nodeMap.get(drag.fromId)
                if (!from) return null
                const a = sidePoint(from, drag.fromSide)
                const d = edgePath(a, drag.to, drag.fromSide, nearestSide(
                  { ...from, x: drag.to.x - 1, y: drag.to.y - 1, width: 2, height: 2 },
                  a,
                ))
                return <path className="edge-line" d={d} stroke="var(--accent)" strokeDasharray="6 4" />
              })()}
            </g>
          </svg>

          {data.edges.map((edge) => {
            const from = nodeMap.get(edge.fromNode)
            const to = nodeMap.get(edge.toNode)
            if (!from || !to) return null
            const a = sidePoint(from, edge.fromSide ?? 'right')
            const b = sidePoint(to, edge.toSide ?? 'left')
            const mid = midpointOnPath(a, b)
            if (!edge.label && editingEdgeId !== edge.id) return null
            return (
              <div
                key={`label-${edge.id}`}
                className="canvas-edge-label"
                style={{ left: mid.x, top: mid.y }}
                onDoubleClick={(ev) => {
                  ev.stopPropagation()
                  setEditingEdgeId(edge.id)
                }}
              >
                {editingEdgeId === edge.id ? (
                  <input
                    autoFocus
                    defaultValue={edge.label ?? ''}
                    onBlur={(ev) => {
                      const label = ev.target.value.trim()
                      commit((prev) => ({
                        ...prev,
                        edges: prev.edges.map((ed) =>
                          ed.id === edge.id ? { ...ed, label: label || undefined } : ed,
                        ),
                      }))
                      setEditingEdgeId(null)
                    }}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter' || ev.key === 'Escape') (ev.target as HTMLInputElement).blur()
                    }}
                  />
                ) : (
                  edge.label
                )}
              </div>
            )
          })}

          {data.nodes.map((node) => (
            <CanvasCard
              key={node.id}
              node={node}
              selected={selectedNodeIds.has(node.id)}
              editing={editingNodeId === node.id}
              theme={theme}
              readOnly={readOnly}
              onSelect={(additive) => {
                setSelectedEdgeId(null)
                setSelectedNodeIds((prev) => {
                  if (additive) {
                    const next = new Set(prev)
                    if (next.has(node.id)) next.delete(node.id)
                    else next.add(node.id)
                    return next
                  }
                  return new Set([node.id])
                })
                // Bring to front
                commit((prev) => {
                  const others = prev.nodes.filter((n) => n.id !== node.id)
                  const self = prev.nodes.find((n) => n.id === node.id)
                  return self ? { ...prev, nodes: [...others, self] } : prev
                })
              }}
              onStartMove={(world, additive) => {
                const ids = selectedNodeIds.has(node.id)
                  ? [...selectedNodeIds]
                  : [node.id]
                if (!selectedNodeIds.has(node.id)) {
                  setSelectedNodeIds(additive ? new Set([...selectedNodeIds, node.id]) : new Set([node.id]))
                }
                const origins: Record<string, Point> = {}
                for (const id of ids) {
                  const n = dataRef.current.nodes.find((x) => x.id === id)
                  if (n) origins[id] = { x: n.x, y: n.y }
                }
                setDrag({ kind: 'move', ids, start: world, origins, snapOff: false })
              }}
              onStartResize={(world) => {
                setDrag({ kind: 'resize', id: node.id, start: world, ow: node.width, oh: node.height })
              }}
              onStartConnect={(side, world) => {
                setDrag({ kind: 'connect', fromId: node.id, fromSide: side, to: world })
              }}
              onEdit={() => setEditingNodeId(node.id)}
              onChangeText={(text) => updateNode(node.id, { text } as Partial<CanvasNode>)}
              onChangeLabel={(label) => updateNode(node.id, { label } as Partial<CanvasNode>)}
              onOpenFile={async (path) => {
                const note = resolveNoteRef(index, path)
                if (note) await openFile(note.id)
                else await openNoteByTitle(path.replace(/\.(md|markdown)$/i, ''))
              }}
              onContextMenu={(e) => onNodeContextMenu(e, node.id)}
              screenToWorld={screenToWorld}
            />
          ))}

          {drag?.kind === 'marquee' && (
            <div
              className="canvas-marquee"
              style={{
                left: Math.min(drag.start.x, drag.current.x),
                top: Math.min(drag.start.y, drag.current.y),
                width: Math.abs(drag.current.x - drag.start.x),
                height: Math.abs(drag.current.y - drag.start.y),
              }}
            />
          )}
        </div>

        {selectionBounds && selectedNodeIds.size > 0 && !readOnly && (
          <div
            className="canvas-selection-bar"
            style={{
              left: camera.x + (selectionBounds.x + selectionBounds.width / 2) * camera.zoom,
              top: Math.max(8, camera.y + selectionBounds.y * camera.zoom - 40),
              transform: 'translateX(-50%)',
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {Object.entries(CANVAS_PRESET_COLORS).map(([key, meta]) => (
              <button
                key={key}
                type="button"
                className="canvas-color-dot"
                title={meta.label}
                style={{ background: theme === 'dark' ? meta.dark : meta.light }}
                onClick={() => setColorOnSelection(key)}
              />
            ))}
            <button
              type="button"
              className="canvas-color-dot clear"
              title="Clear color"
              onClick={() => setColorOnSelection(undefined)}
            />
            <button type="button" className="canvas-tool" onClick={() => deleteSelection()} title="Delete">
              <Trash2 size={13} />
            </button>
          </div>
        )}

        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={canvasMenuItems(contextMenu)}
            onClose={() => setContextMenu(null)}
          />
        )}
      </div>
    </div>
  )
}

function CanvasCard({
  node,
  selected,
  editing,
  theme,
  readOnly,
  onSelect,
  onStartMove,
  onStartResize,
  onStartConnect,
  onEdit,
  onChangeText,
  onChangeLabel,
  onOpenFile,
  onContextMenu,
  screenToWorld,
}: {
  node: CanvasNode
  selected: boolean
  editing: boolean
  theme: 'light' | 'dark'
  readOnly: boolean
  onSelect: (additive: boolean) => void
  onStartMove: (world: Point, additive: boolean) => void
  onStartResize: (world: Point) => void
  onStartConnect: (side: NodeSide, world: Point) => void
  onEdit: () => void
  onChangeText: (text: string) => void
  onChangeLabel: (label: string) => void
  onOpenFile: (path: string) => void
  onContextMenu: (e: React.MouseEvent) => void
  screenToWorld: (x: number, y: number) => Point
}) {
  const { index } = useApp()
  const border = resolveCanvasColor(node.color, theme, undefined)
  const note =
    node.type === 'file' ? resolveNoteRef(index, node.file) : null
  const previewHtml =
    node.type === 'text' && !editing
      ? renderMarkdownToHtml(node.text, () => null)
      : node.type === 'file' && note
        ? renderMarkdownToHtml(note.content.slice(0, 1200), () => null)
        : ''

  return (
    <div
      className={`canvas-node ${node.type} ${selected ? 'selected' : ''}`}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
        borderColor: border,
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.stopPropagation()
        onSelect(e.shiftKey)
        const target = e.target as HTMLElement
        if (target.closest('.canvas-port') || target.closest('.canvas-resize') || target.closest('textarea') || target.closest('a') || target.closest('iframe')) {
          return
        }
        if (target.closest('.canvas-node-body') && editing) return
        onStartMove(screenToWorld(e.clientX, e.clientY), e.shiftKey)
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (node.type === 'text' || node.type === 'group') onEdit()
        if (node.type === 'file') void onOpenFile(node.file)
      }}
      onContextMenu={onContextMenu}
    >
      <div className="canvas-node-header">
        {node.type === 'text' && <StickyNote size={12} />}
        {node.type === 'file' && <FileText size={12} />}
        {node.type === 'link' && <Globe size={12} />}
        {node.type === 'group' && <Group size={12} />}
        <strong>
          {node.type === 'group'
            ? editing
              ? (
                <input
                  autoFocus
                  defaultValue={node.label ?? 'Group'}
                  onBlur={(e) => onChangeLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  style={{ font: 'inherit', border: '1px solid var(--border)', borderRadius: 4, padding: '0 4px', background: 'var(--bg)', color: 'inherit' }}
                />
              )
              : (node.label || 'Group')
            : node.type === 'file'
              ? node.file
              : node.type === 'link'
                ? 'Web'
                : 'Text'}
        </strong>
      </div>
      <div className={`canvas-node-body ${node.type === 'group' || (!editing && node.type !== 'text') ? 'readonly' : ''}`}>
        {node.type === 'text' && editing && !readOnly ? (
          <textarea
            autoFocus
            defaultValue={node.text}
            onBlur={(e) => onChangeText(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : node.type === 'text' ? (
          <div className="md-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
        ) : node.type === 'file' ? (
          <div>
            <button
              type="button"
              className="cell-link"
              style={{ appearance: 'none', border: 'none', background: 'none', color: 'var(--accent)', padding: 0, font: 'inherit', cursor: 'pointer', marginBottom: 6 }}
              onClick={() => void onOpenFile(node.file)}
            >
              Open {node.file}{node.subpath ?? ''}
            </button>
            {note ? (
              <div className="md-preview canvas-file-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
            ) : (
              <div className="canvas-file-preview">Missing file</div>
            )}
          </div>
        ) : node.type === 'link' ? (
          <div className="canvas-link-card">
            <a href={node.url} target="_blank" rel="noreferrer" onPointerDown={(e) => e.stopPropagation()}>
              {node.url}
            </a>
            <iframe title={node.url} src={node.url} sandbox="allow-scripts allow-same-origin allow-popups" />
          </div>
        ) : null}
      </div>

      {(['top', 'right', 'bottom', 'left'] as NodeSide[]).map((side) => (
        <div
          key={side}
          className={`canvas-port ${side}`}
          onPointerDown={(e) => {
            if (readOnly) return
            e.stopPropagation()
            e.preventDefault()
            onStartConnect(side, screenToWorld(e.clientX, e.clientY))
          }}
        />
      ))}
      {!readOnly && node.type !== 'group' && (
        <div
          className="canvas-resize"
          onPointerDown={(e) => {
            e.stopPropagation()
            onStartResize(screenToWorld(e.clientX, e.clientY))
          }}
        />
      )}
    </div>
  )
}

export function CanvasEmbed({ content }: { content: string }) {
  return (
    <div className="canvas-embed-wrap">
      <CanvasViewer content={content} embedded readOnly />
    </div>
  )
}
