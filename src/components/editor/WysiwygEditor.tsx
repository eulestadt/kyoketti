import { useEffect, useRef, useState } from 'react'
import {
  Bold,
  ChevronDown,
  ChevronUp,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
  Table,
} from 'lucide-react'
import { useApp } from '../../hooks/useApp'
import { htmlToMarkdown, renderMarkdownToHtml, withPreservedFrontmatter } from '../../lib/markdown'
import { resolveNoteRef } from '../../lib/vaultIndex'
import { ContextMenu, useContextMenu } from '../ui/ContextMenu'
import { previewMenuItems, type PreviewMenuTarget } from '../ui/previewMenu'
import {
  createEmptyTableElement,
  deleteTableColumn,
  deleteTableRow,
  duplicateTableColumn,
  duplicateTableRow,
  focusTableCell,
  getCellPosition,
  insertTableColumn,
  insertTableRow,
  moveTableColumn,
  moveTableRow,
  setColumnAlign,
  sortTableByColumn,
  type TableAlign,
} from '../../lib/tables'

const TOOLBAR_KEY = 'kyoketti.wysiwygToolbar'

function loadToolbarVisible(): boolean {
  try {
    const raw = localStorage.getItem(TOOLBAR_KEY)
    if (raw === null) return true
    return raw !== '0'
  } catch {
    return true
  }
}

function runFormat(command: string, value?: string) {
  const next = command === 'formatBlock' && value && !value.startsWith('<') ? `<${value}>` : value
  document.execCommand(command, false, next)
}

function ensureEditableTail(root: HTMLElement) {
  const last = root.lastElementChild
  if (!last || last.tagName.toLowerCase() !== 'p') {
    const p = document.createElement('p')
    p.innerHTML = '<br>'
    root.appendChild(p)
  }
}

function wrapSelection(tagName: 'strong' | 'em' | 'del' | 'code') {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    if (tagName === 'code') {
      document.execCommand('insertHTML', false, '<code>\u200b</code>')
      return
    }
    runFormat(tagName === 'strong' ? 'bold' : tagName === 'em' ? 'italic' : 'strikeThrough')
    return
  }
  const range = selection.getRangeAt(0)
  const wrapper = document.createElement(tagName)
  try {
    range.surroundContents(wrapper)
    selection.removeAllRanges()
    const next = document.createRange()
    next.selectNodeContents(wrapper)
    next.collapse(false)
    selection.addRange(next)
  } catch {
    if (tagName === 'code') {
      const text = range.toString()
      document.execCommand('insertHTML', false, `<code>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code>`)
      return
    }
    runFormat(tagName === 'strong' ? 'bold' : tagName === 'em' ? 'italic' : 'strikeThrough')
  }
}

function isInListItem(node: Node | null): HTMLElement | null {
  const el = node instanceof Element ? node : node?.parentElement
  return el?.closest('li') ?? null
}

function insertPlainText(text: string) {
  if (document.queryCommandSupported?.('insertText')) {
    document.execCommand('insertText', false, text)
    return
  }
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return
  const range = selection.getRangeAt(0)
  range.deleteContents()
  const node = document.createTextNode(text)
  range.insertNode(node)
  range.setStartAfter(node)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

function placeCaretIn(el: HTMLElement, atEnd = true) {
  const selection = window.getSelection()
  if (!selection) return
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(!atEnd)
  selection.removeAllRanges()
  selection.addRange(range)
}

/** Convert `- `, `* `, `+ `, or `1. ` at the start of a block into a real list. */
function tryConvertListMarker(surface: HTMLElement): boolean {
  const selection = window.getSelection()
  if (!selection || !selection.isCollapsed || selection.rangeCount === 0) return false
  const anchor = selection.anchorNode
  if (!anchor) return false
  const el = anchor instanceof Element ? anchor : anchor.parentElement
  if (!el || !surface.contains(el)) return false
  if (el.closest('li, pre, code, blockquote')) return false

  const block = el.closest('p, div, h1, h2, h3, h4, h5, h6') as HTMLElement | null
  if (!block || !surface.contains(block)) return false

  const range = selection.getRangeAt(0)
  const preRange = document.createRange()
  preRange.selectNodeContents(block)
  preRange.setEnd(range.startContainer, range.startOffset)
  const before = preRange.toString().replace(/\u00a0/g, ' ')

  const bullet = /^([-*+])$/.exec(before.trim())
  const ordered = /^(\d+)\.$/.exec(before.trim())
  if (!bullet && !ordered) return false

  const afterRange = document.createRange()
  afterRange.selectNodeContents(block)
  afterRange.setStart(range.startContainer, range.startOffset)
  const after = afterRange.toString().replace(/\u00a0/g, ' ')

  const list = document.createElement(bullet ? 'ul' : 'ol')
  const li = document.createElement('li')
  if (after.trim()) li.textContent = after
  else li.innerHTML = '<br>'
  list.appendChild(li)
  block.replaceWith(list)
  placeCaretIn(li, !after.trim())
  return true
}

function indentListItem(li: HTMLElement) {
  const prev = li.previousElementSibling as HTMLElement | null
  if (!prev || prev.tagName.toLowerCase() !== 'li') return false

  const parentList = li.parentElement
  if (!parentList) return false
  const listTag = parentList.tagName.toLowerCase() === 'ol' ? 'ol' : 'ul'

  let nested = prev.querySelector(`:scope > ${listTag}`) as HTMLElement | null
  if (!nested) {
    nested = document.createElement(listTag)
    prev.appendChild(nested)
  }
  nested.appendChild(li)
  placeCaretIn(li)
  return true
}

function outdentListItem(li: HTMLElement) {
  const parentList = li.parentElement
  if (!parentList) return false
  const parentLi = parentList.closest('li')
  if (!parentLi || parentList === parentLi.closest('ul, ol')) {
    // Only outdent when nested under another list item.
    if (parentList.parentElement?.tagName.toLowerCase() !== 'li') return false
  }
  const grandList = parentLi?.parentElement
  if (!parentLi || !grandList) return false

  const nextSibling = li.nextElementSibling
  // Move following siblings into a nested list under the outdented item.
  if (nextSibling) {
    const listTag = parentList.tagName.toLowerCase() === 'ol' ? 'ol' : 'ul'
    let nest = li.querySelector(`:scope > ${listTag}`) as HTMLElement | null
    if (!nest) {
      nest = document.createElement(listTag)
      li.appendChild(nest)
    }
    while (li.nextElementSibling) {
      nest.appendChild(li.nextElementSibling)
    }
  }

  parentLi.after(li)
  if (!parentList.children.length) parentList.remove()
  placeCaretIn(li)
  return true
}

function indentSelection() {
  const selection = window.getSelection()
  const li = isInListItem(selection?.anchorNode ?? null)
  if (li) {
    if (!indentListItem(li)) insertPlainText('  ')
    return
  }
  insertPlainText('  ')
}

function outdentSelection() {
  const selection = window.getSelection()
  const li = isInListItem(selection?.anchorNode ?? null)
  if (li && outdentListItem(li)) return

  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return
  const range = selection.getRangeAt(0)
  const node = range.startContainer
  if (node.nodeType !== Node.TEXT_NODE) return
  const text = node.textContent ?? ''
  const offset = range.startOffset
  if (offset >= 2 && text.slice(offset - 2, offset) === '  ') {
    const del = document.createRange()
    del.setStart(node, offset - 2)
    del.setEnd(node, offset)
    del.deleteContents()
    return
  }
  if (offset >= 1 && text.slice(offset - 1, offset) === '\t') {
    const del = document.createRange()
    del.setStart(node, offset - 1)
    del.setEnd(node, offset)
    del.deleteContents()
  }
}

export function WysiwygEditor() {
  const { editorContent, setEditorContent, openNoteByTitle, openFile, index, activeFileId } = useApp()
  const surfaceRef = useRef<HTMLDivElement>(null)
  const lastFileId = useRef<string | null>(null)
  const lastSerialized = useRef(editorContent)
  const applyingExternal = useRef(false)
  const [toolbarVisible, setToolbarVisible] = useState(loadToolbarVisible)
  const [tableMenu, setTableMenu] = useState<{
    x: number
    y: number
    table: HTMLTableElement
    row: number
    col: number
    isHeader: boolean
  } | null>(null)
  const { menu: previewMenu, open: openPreviewMenu, close: closePreviewMenu } = useContextMenu<PreviewMenuTarget>()

  function toggleToolbar() {
    setToolbarVisible((prev) => {
      const next = !prev
      try {
        localStorage.setItem(TOOLBAR_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }

  useEffect(() => {
    if (!tableMenu) return
    function onClose(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (target.closest('.table-context-menu')) return
      setTableMenu(null)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setTableMenu(null)
    }
    window.addEventListener('mousedown', onClose)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onClose)
      window.removeEventListener('keydown', onKey)
    }
  }, [tableMenu])

  useEffect(() => {
    const el = surfaceRef.current
    if (!el || !activeFileId) return

    const fileChanged = lastFileId.current !== activeFileId
    const externalEdit = editorContent !== lastSerialized.current
    if (!fileChanged && !externalEdit) return

    applyingExternal.current = true
    el.innerHTML = renderMarkdownToHtml(editorContent, (title) => {
      const fromPath = activeFileId ? index.notesById.get(activeFileId)?.path : undefined
      const note = resolveNoteRef(index, title, { fromPath })
      return note ? `#note/${note.id}` : null
    })
    ensureEditableTail(el)
    lastFileId.current = activeFileId
    lastSerialized.current = editorContent
    applyingExternal.current = false
  }, [activeFileId, editorContent, index])

  function syncFromDom() {
    const el = surfaceRef.current
    if (!el || applyingExternal.current) return
    const body = htmlToMarkdown(el.innerHTML)
    const next = withPreservedFrontmatter(lastSerialized.current, body)
    if (next === lastSerialized.current) return
    lastSerialized.current = next
    setEditorContent(next)
  }

  function insertTable() {
    const surface = surfaceRef.current
    if (!surface) return
    surface.focus()
    const table = createEmptyTableElement(2, 1)
    const selection = window.getSelection()
    if (selection && selection.rangeCount > 0 && surface.contains(selection.anchorNode)) {
      const range = selection.getRangeAt(0)
      range.deleteContents()
      range.insertNode(table)
      const after = document.createElement('p')
      after.innerHTML = '<br>'
      table.after(after)
    } else {
      ensureEditableTail(surface)
      surface.insertBefore(table, surface.lastChild)
    }
    focusTableCell(table, -1, 0)
    syncFromDom()
  }

  function runTableAction(action: () => void) {
    action()
    setTableMenu(null)
    syncFromDom()
  }

  async function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    const link = target.closest('a.internal-link') as HTMLAnchorElement | null
    if (!link) return
    if (!(e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      return
    }
    e.preventDefault()
    const title = link.dataset.note
    if (title) await openNoteByTitle(title, activeFileId ? index.notesById.get(activeFileId)?.path : undefined)
  }

  function handleContextMenu(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    const cell = target.closest('th, td') as HTMLElement | null
    if (cell && surfaceRef.current?.contains(cell)) {
      const pos = getCellPosition(cell)
      if (pos) {
        e.preventDefault()
        closePreviewMenu()
        setTableMenu({
          x: e.clientX,
          y: e.clientY,
          table: pos.table,
          row: pos.row,
          col: pos.col,
          isHeader: pos.isHeader,
        })
        return
      }
    }
    const internal = target.closest('a.internal-link') as HTMLAnchorElement | null
    const image = target.closest('img') as HTMLImageElement | null
    const external = target.closest('a') as HTMLAnchorElement | null
    if (internal?.dataset.note) {
      setTableMenu(null)
      openPreviewMenu(e, { kind: 'link', title: internal.dataset.note })
      return
    }
    if (image) {
      setTableMenu(null)
      openPreviewMenu(e, { kind: 'image', img: image })
      return
    }
    if (external?.href && !external.classList.contains('internal-link')) {
      setTableMenu(null)
      openPreviewMenu(e, { kind: 'url', href: external.href })
    }
  }

  function handleFormat(kind: 'h1' | 'h2' | 'bold' | 'italic' | 'strike' | 'code' | 'ul' | 'ol' | 'quote' | 'table') {
    surfaceRef.current?.focus()
    if (kind === 'table') {
      insertTable()
      return
    }
    if (kind === 'h1') runFormat('formatBlock', 'h1')
    else if (kind === 'h2') runFormat('formatBlock', 'h2')
    else if (kind === 'bold') wrapSelection('strong')
    else if (kind === 'italic') wrapSelection('em')
    else if (kind === 'strike') wrapSelection('del')
    else if (kind === 'code') wrapSelection('code')
    else if (kind === 'ul') runFormat('insertUnorderedList')
    else if (kind === 'ol') runFormat('insertOrderedList')
    else if (kind === 'quote') runFormat('formatBlock', 'blockquote')
    syncFromDom()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const mod = e.metaKey || e.ctrlKey
    const key = e.key
    const selection = window.getSelection()
    const anchor = selection?.anchorNode ?? null
    const cell = (anchor instanceof Element ? anchor : anchor?.parentElement)?.closest('th, td') as HTMLElement | null

    // Table navigation (Obsidian-style Tab / Enter)
    if (cell && surfaceRef.current?.contains(cell) && (key === 'Tab' || (key === 'Enter' && !mod))) {
      const pos = getCellPosition(cell)
      if (pos) {
        e.preventDefault()
        const cols = pos.table.querySelector('tr')?.children.length ?? 1
        const bodyRows = pos.table.tBodies[0]?.rows.length ?? 0
        if (key === 'Tab') {
          if (e.shiftKey) {
            if (pos.isHeader) {
              if (pos.col > 0) focusTableCell(pos.table, -1, pos.col - 1)
            } else if (pos.col > 0) {
              focusTableCell(pos.table, pos.row, pos.col - 1)
            } else if (pos.row > 0) {
              focusTableCell(pos.table, pos.row - 1, cols - 1)
            } else {
              focusTableCell(pos.table, -1, cols - 1)
            }
          } else if (pos.isHeader) {
            if (pos.col < cols - 1) focusTableCell(pos.table, -1, pos.col + 1)
            else if (bodyRows > 0) focusTableCell(pos.table, 0, 0)
            else {
              insertTableRow(pos.table, 0)
              focusTableCell(pos.table, 0, 0)
              syncFromDom()
            }
          } else if (pos.col < cols - 1) {
            focusTableCell(pos.table, pos.row, pos.col + 1)
          } else if (pos.row < bodyRows - 1) {
            focusTableCell(pos.table, pos.row + 1, 0)
          } else {
            insertTableRow(pos.table, bodyRows)
            focusTableCell(pos.table, bodyRows, 0)
            syncFromDom()
          }
          return
        }
        // Enter
        if (pos.isHeader) {
          if (bodyRows > 0) focusTableCell(pos.table, 0, pos.col)
          else {
            insertTableRow(pos.table, 0)
            focusTableCell(pos.table, 0, pos.col)
            syncFromDom()
          }
        } else if (pos.row < bodyRows - 1) {
          focusTableCell(pos.table, pos.row + 1, pos.col)
        } else {
          insertTableRow(pos.table, bodyRows)
          focusTableCell(pos.table, bodyRows, pos.col)
          syncFromDom()
        }
        return
      }
    }

    // Keep focus in the editor; indent / outdent lists or insert spaces.
    if (key === 'Tab') {
      e.preventDefault()
      if (e.shiftKey) outdentSelection()
      else indentSelection()
      syncFromDom()
      return
    }

    // Markdown list markers: -, *, + or 1. then Space → real list
    if (key === ' ' && !mod && surfaceRef.current) {
      if (tryConvertListMarker(surfaceRef.current)) {
        e.preventDefault()
        syncFromDom()
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return
      const node = sel.anchorNode
      const blockquote = node instanceof Element ? node.closest('blockquote') : node?.parentElement?.closest('blockquote')
      if (!blockquote || !surfaceRef.current) return

      const block = (node instanceof Element ? node : node?.parentElement)?.closest('p, div')
      const text = (block?.textContent ?? '').replace(/\u00a0/g, ' ').trim()
      if (text) return

      e.preventDefault()
      const p = document.createElement('p')
      p.innerHTML = '<br>'
      blockquote.after(p)
      const range = document.createRange()
      range.setStart(p, 0)
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
      syncFromDom()
      return
    }

    if (!mod) return

    const lower = key.toLowerCase()

    if (lower === 'b' && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      handleFormat('bold')
      return
    }
    if (lower === 'i' && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      handleFormat('italic')
      return
    }
    if ((lower === 'x' && e.shiftKey) || (lower === 's' && e.shiftKey && !e.altKey)) {
      e.preventDefault()
      handleFormat('strike')
      return
    }
    if (lower === 'e' && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      handleFormat('code')
      return
    }
    if (lower === ']') {
      e.preventDefault()
      indentSelection()
      syncFromDom()
      return
    }
    if (lower === '[') {
      e.preventDefault()
      outdentSelection()
      syncFromDom()
      return
    }
    if (e.altKey && (key === '1' || key === 'Digit1')) {
      e.preventDefault()
      handleFormat('h1')
      return
    }
    if (e.altKey && (key === '2' || key === 'Digit2')) {
      e.preventDefault()
      handleFormat('h2')
      return
    }
    if (e.shiftKey && (key === '7' || key === '&')) {
      e.preventDefault()
      handleFormat('ol')
      return
    }
    if (e.shiftKey && (key === '8' || key === '*')) {
      e.preventDefault()
      handleFormat('ul')
      return
    }
    if (e.shiftKey && (key === '.' || key === '>')) {
      e.preventDefault()
      handleFormat('quote')
      return
    }
  }

  const menu = tableMenu

  return (
    <div className={`wysiwyg-editor ${toolbarVisible ? '' : 'toolbar-hidden'}`}>
      {toolbarVisible ? (
        <div className="wysiwyg-toolbar" role="toolbar" aria-label="Formatting">
          <button type="button" title="Heading 1 (Ctrl/Cmd+Alt+1)" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFormat('h1')}>
            <Heading1 size={15} />
          </button>
          <button type="button" title="Heading 2 (Ctrl/Cmd+Alt+2)" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFormat('h2')}>
            <Heading2 size={15} />
          </button>
          <button type="button" title="Bold (Ctrl/Cmd+B)" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFormat('bold')}>
            <Bold size={15} />
          </button>
          <button type="button" title="Italic (Ctrl/Cmd+I)" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFormat('italic')}>
            <Italic size={15} />
          </button>
          <button type="button" title="Strikethrough (Ctrl/Cmd+Shift+X)" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFormat('strike')}>
            <Strikethrough size={15} />
          </button>
          <button type="button" title="Bullet list (Ctrl/Cmd+Shift+8)" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFormat('ul')}>
            <List size={15} />
          </button>
          <button type="button" title="Numbered list (Ctrl/Cmd+Shift+7)" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFormat('ol')}>
            <ListOrdered size={15} />
          </button>
          <button type="button" title="Quote (Ctrl/Cmd+Shift+.)" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFormat('quote')}>
            <Quote size={15} />
          </button>
          <button type="button" title="Insert table" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFormat('table')}>
            <Table size={15} />
          </button>
          <span className="wysiwyg-toolbar-spacer" />
          <button
            type="button"
            className="wysiwyg-toolbar-toggle"
            title="Hide formatting toolbar"
            aria-label="Hide formatting toolbar"
            onMouseDown={(e) => e.preventDefault()}
            onClick={toggleToolbar}
          >
            <ChevronUp size={15} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="wysiwyg-format-fab"
          title="Show formatting toolbar"
          aria-label="Show formatting toolbar"
          onMouseDown={(e) => e.preventDefault()}
          onClick={toggleToolbar}
        >
          <ChevronDown size={15} />
        </button>
      )}
      <div className="wysiwyg-scroll">
        <div
          ref={surfaceRef}
          className="wysiwyg-surface markdown-preview"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="WYSIWYG editor"
          spellCheck
          onInput={syncFromDom}
          onBlur={syncFromDom}
          onKeyDown={handleKeyDown}
          onClick={(e) => void handleClick(e)}
          onContextMenu={handleContextMenu}
        />
      </div>

      {menu && (
        <div
          className="table-context-menu"
          style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 320) }}
          role="menu"
        >
          <div className="menu-label">Row</div>
          <button type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => runTableAction(() => insertTableRow(menu.table, Math.max(0, menu.row)))}>
            Insert row above
          </button>
          <button type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => runTableAction(() => insertTableRow(menu.table, menu.isHeader ? 0 : menu.row + 1))}>
            Insert row below
          </button>
          {!menu.isHeader && (
            <>
              <button type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => runTableAction(() => duplicateTableRow(menu.table, menu.row))}>
                Duplicate row
              </button>
              <button
                type="button"
                role="menuitem"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() =>
                  runTableAction(() => {
                    if (menu.row > 0) moveTableRow(menu.table, menu.row, menu.row - 1)
                  })
                }
              >
                Move row up
              </button>
              <button
                type="button"
                role="menuitem"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() =>
                  runTableAction(() => {
                    const len = menu.table.tBodies[0]?.rows.length ?? 0
                    if (menu.row < len - 1) moveTableRow(menu.table, menu.row, menu.row + 1)
                  })
                }
              >
                Move row down
              </button>
              <button type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => runTableAction(() => deleteTableRow(menu.table, menu.row))}>
                Delete row
              </button>
            </>
          )}
          <div className="menu-sep" />
          <div className="menu-label">Column</div>
          <button type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => runTableAction(() => insertTableColumn(menu.table, menu.col))}>
            Insert column left
          </button>
          <button type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => runTableAction(() => insertTableColumn(menu.table, menu.col + 1))}>
            Insert column right
          </button>
          <button type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => runTableAction(() => duplicateTableColumn(menu.table, menu.col))}>
            Duplicate column
          </button>
          <button
            type="button"
            role="menuitem"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              runTableAction(() => {
                if (menu.col > 0) moveTableColumn(menu.table, menu.col, menu.col - 1)
              })
            }
          >
            Move column left
          </button>
          <button
            type="button"
            role="menuitem"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              runTableAction(() => {
                const cols = menu.table.querySelector('tr')?.children.length ?? 0
                if (menu.col < cols - 1) moveTableColumn(menu.table, menu.col, menu.col + 1)
              })
            }
          >
            Move column right
          </button>
          <button type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => runTableAction(() => deleteTableColumn(menu.table, menu.col))}>
            Delete column
          </button>
          <div className="menu-sep" />
          <div className="menu-label">Align</div>
          {(['left', 'center', 'right', 'none'] as TableAlign[]).map((align) => (
            <button
              key={align}
              type="button"
              role="menuitem"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runTableAction(() => setColumnAlign(menu.table, menu.col, align))}
            >
              {align === 'none' ? 'Default align' : `${align[0]!.toUpperCase()}${align.slice(1)} align`}
            </button>
          ))}
          <div className="menu-sep" />
          <div className="menu-label">Sort</div>
          <button type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => runTableAction(() => sortTableByColumn(menu.table, menu.col, true))}>
            Sort ascending
          </button>
          <button type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => runTableAction(() => sortTableByColumn(menu.table, menu.col, false))}>
            Sort descending
          </button>
        </div>
      )}
      {previewMenu && (
        <ContextMenu
          x={previewMenu.x}
          y={previewMenu.y}
          onClose={closePreviewMenu}
          items={previewMenuItems(previewMenu.data, {
            index,
            fromPath: activeFileId ? index.notesById.get(activeFileId)?.path : undefined,
            openFile,
            openLink: (title) => {
              void openNoteByTitle(title, activeFileId ? index.notesById.get(activeFileId)?.path : undefined)
            },
          })}
        />
      )}
    </div>
  )
}
