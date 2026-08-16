import { useEffect, useMemo, useRef } from 'react'
import { useApp } from '../../hooks/useApp'
import { useTheme } from '../../hooks/useTheme'
import { buildGraph } from '../../lib/vaultIndex'
import { ContextMenu, useContextMenu } from '../ui/ContextMenu'
import { noteMenuItems } from '../ui/noteMenu'
import './GraphView.css'

type SimNode = {
  id: string
  title: string
  orphan: boolean
  x: number
  y: number
  vx: number
  vy: number
}

export function GraphView() {
  const { index, openFile, activeFileId, renameNode, deleteNode, duplicateFile } = useApp()
  const { theme } = useTheme()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const graph = useMemo(() => buildGraph(index), [index])
  const { menu, open, close } = useContextMenu<{ id: string }>()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let frame = 0
    let running = true
    const dpr = window.devicePixelRatio || 1
    const styles = getComputedStyle(document.documentElement)
    const bg = styles.getPropertyValue('--bg-graph').trim() || (theme === 'light' ? '#f4f4f1' : '#15141a')
    const accent = styles.getPropertyValue('--accent').trim() || '#5a8f6a'
    const accentSoft = theme === 'light' ? 'rgba(90, 143, 106, 0.35)' : 'rgba(127, 109, 242, 0.35)'
    const orphan = theme === 'light' ? '#9ca3af' : '#6b7280'
    const label = styles.getPropertyValue('--text').trim() || (theme === 'light' ? '#222222' : '#dcddde')
    const activeColor = theme === 'light' ? '#3f6f4d' : '#9b8cff'

    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect()
      if (!rect) return
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const width = () => canvas.width / dpr
    const height = () => canvas.height / dpr

    const nodes: SimNode[] = graph.nodes.map((n, i) => {
      const angle = (i / Math.max(graph.nodes.length, 1)) * Math.PI * 2
      return {
        id: n.id,
        title: n.title,
        orphan: n.orphan,
        x: width() / 2 + Math.cos(angle) * 120,
        y: height() / 2 + Math.sin(angle) * 120,
        vx: 0,
        vy: 0,
      }
    })
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const links = graph.links
      .map((l) => ({ source: byId.get(l.source), target: byId.get(l.target) }))
      .filter((l): l is { source: SimNode; target: SimNode } => Boolean(l.source && l.target))

    const onClick = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      const hit = nodes.find((n) => Math.hypot(n.x - x, n.y - y) < 10)
      if (hit) void openFile(hit.id)
    }
    canvas.addEventListener('click', onClick)

    const onContextMenu = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      const hit = nodes.find((n) => Math.hypot(n.x - x, n.y - y) < 16)
      if (!hit) return
      open(event, { id: hit.id })
    }
    canvas.addEventListener('contextmenu', onContextMenu)

    const tick = () => {
      if (!running) return
      const w = width()
      const h = height()

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]
          const b = nodes[j]
          let dx = a.x - b.x
          let dy = a.y - b.y
          let dist = Math.hypot(dx, dy) || 0.01
          const force = 1200 / (dist * dist)
          dx = (dx / dist) * force
          dy = (dy / dist) * force
          a.vx += dx
          a.vy += dy
          b.vx -= dx
          b.vy -= dy
        }
      }

      for (const link of links) {
        const dx = link.target.x - link.source.x
        const dy = link.target.y - link.source.y
        const dist = Math.hypot(dx, dy) || 0.01
        const force = (dist - 90) * 0.01
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        link.source.vx += fx
        link.source.vy += fy
        link.target.vx -= fx
        link.target.vy -= fy
      }

      for (const node of nodes) {
        node.vx += (w / 2 - node.x) * 0.005
        node.vy += (h / 2 - node.y) * 0.005
        node.vx *= 0.85
        node.vy *= 0.85
        node.x += node.vx
        node.y += node.vy
        node.x = Math.max(16, Math.min(w - 16, node.x))
        node.y = Math.max(16, Math.min(h - 16, node.y))
      }

      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, w, h)

      ctx.strokeStyle = accentSoft
      ctx.lineWidth = 1
      for (const link of links) {
        ctx.beginPath()
        ctx.moveTo(link.source.x, link.source.y)
        ctx.lineTo(link.target.x, link.target.y)
        ctx.stroke()
      }

      for (const node of nodes) {
        const active = node.id === activeFileId
        ctx.beginPath()
        ctx.arc(node.x, node.y, active ? 7 : 5, 0, Math.PI * 2)
        ctx.fillStyle = active ? activeColor : node.orphan ? orphan : accent
        ctx.fill()
        ctx.fillStyle = label
        ctx.font = '11px "Source Sans 3", system-ui, sans-serif'
        ctx.fillText(node.title, node.x + 10, node.y + 3)
      }

      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)

    return () => {
      running = false
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
      canvas.removeEventListener('click', onClick)
      canvas.removeEventListener('contextmenu', onContextMenu)
    }
  }, [graph, openFile, activeFileId, theme, open])

  return (
    <div className="graph-view">
      <div className="graph-toolbar">
        <strong>Graph view</strong>
        <span>
          {graph.nodes.length} notes · {graph.links.length} links
        </span>
      </div>
      <canvas ref={canvasRef} />
      {menu && (() => {
        const note = index.notesById.get(menu.data.id)
        if (!note) return null
        return (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            onClose={close}
            items={noteMenuItems(note, { openFile, renameNode, deleteNode, duplicateFile, index }, {
              open: true,
              rename: true,
              duplicate: true,
              remove: true,
            })}
          />
        )
      })()}
    </div>
  )
}
