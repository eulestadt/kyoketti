/** True when the event target is a field or editor that owns arrow keys. */
export function isTypingField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable="true"], [contenteditable=""], .cm-content, .cm-editor',
    ),
  )
}

type ModifySelection = Selection & {
  modify(alter: 'move' | 'extend', direction: 'forward' | 'backward', granularity: string): void
}

function selectionCanModify(sel: Selection | null): sel is ModifySelection {
  return Boolean(sel && typeof (sel as ModifySelection).modify === 'function')
}

/**
 * Option/Alt+Left/Right: move (or Shift-extend) by word, like a desktop editor.
 * Returns true when the event was handled.
 */
export function handleAltArrowWordNav(e: {
  key: string
  altKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  preventDefault(): void
}): boolean {
  if (!e.altKey || e.metaKey || e.ctrlKey) return false
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return false
  const sel = window.getSelection()
  if (!selectionCanModify(sel)) return false
  e.preventDefault()
  sel.modify(e.shiftKey ? 'extend' : 'move', e.key === 'ArrowLeft' ? 'backward' : 'forward', 'word')
  return true
}
