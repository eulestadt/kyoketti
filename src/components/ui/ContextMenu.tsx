import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './ContextMenu.css'

export type ContextMenuItem =
  | { type: 'separator'; key?: string }
  | { type: 'label'; label: string; key?: string }
  | {
      type?: 'item'
      label: string
      onClick: () => void | Promise<void>
      danger?: boolean
      disabled?: boolean
      key?: string
    }

export type ContextMenuState<T> = { x: number; y: number; data: T }

type Props = {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const pad = 8
    let left = x
    let top = y
    if (left + rect.width > window.innerWidth - pad) left = window.innerWidth - rect.width - pad
    if (top + rect.height > window.innerHeight - pad) top = window.innerHeight - rect.height - pad
    left = Math.max(pad, left)
    top = Math.max(pad, top)
    setPos((prev) => (prev.left === left && prev.top === top ? prev : { left, top }))
  }, [x, y, items])

  useLayoutEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (ref.current?.contains(e.target as Node)) return
      onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    function onBlurClose() {
      onClose()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onBlurClose)
    window.addEventListener('scroll', onBlurClose, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onBlurClose)
      window.removeEventListener('scroll', onBlurClose, true)
    }
  }, [onClose])

  const visible = items.filter((item) => item.type !== 'separator' && item.type !== 'label')
  if (!visible.length) return null

  return createPortal(
    <div
      ref={ref}
      className="kk-context-menu"
      role="menu"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {items.map((item, i) => {
        if (item.type === 'separator') {
          return <div key={item.key ?? `sep-${i}`} className="kk-context-sep" role="separator" />
        }
        if (item.type === 'label') {
          return (
            <div key={item.key ?? `label-${i}`} className="kk-context-label">
              {item.label}
            </div>
          )
        }
        return (
          <button
            key={item.key ?? item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={item.danger ? 'danger' : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (item.disabled) return
              onClose()
              void item.onClick()
            }}
          >
            {item.label}
          </button>
        )
      })}
    </div>,
    document.body,
  )
}

export function useContextMenu<T = void>() {
  const [menu, setMenu] = useState<ContextMenuState<T> | null>(null)
  const close = useCallback(() => setMenu(null), [])
  const open = useCallback((e: { clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void }, data: T) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, data })
  }, [])
  return { menu, open, close, setMenu }
}

export function compactItems(items: Array<ContextMenuItem | false | null | undefined>): ContextMenuItem[] {
  const out: ContextMenuItem[] = []
  for (const item of items) {
    if (!item) continue
    if (item.type === 'separator' && (!out.length || out[out.length - 1]?.type === 'separator')) continue
    out.push(item)
  }
  while (out.length && out[out.length - 1]?.type === 'separator') out.pop()
  return out
}

export function ContextMenuHost<T>({
  menu,
  items,
  onClose,
}: {
  menu: ContextMenuState<T> | null
  items: (data: T) => ContextMenuItem[]
  onClose: () => void
}): ReactNode {
  if (!menu) return null
  return <ContextMenu x={menu.x} y={menu.y} items={items(menu.data)} onClose={onClose} />
}
