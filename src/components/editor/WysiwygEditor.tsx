import { useEffect, useRef } from 'react'
import {
  Bold,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
} from 'lucide-react'
import { useApp } from '../../hooks/useApp'
import { htmlToMarkdown, renderMarkdownToHtml, withPreservedFrontmatter } from '../../lib/markdown'

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
  const { editorContent, setEditorContent, openNoteByTitle, index, activeFileId } = useApp()
  const surfaceRef = useRef<HTMLDivElement>(null)
  const lastFileId = useRef<string | null>(null)
  const lastSerialized = useRef(editorContent)
  const applyingExternal = useRef(false)

  useEffect(() => {
    const el = surfaceRef.current
    if (!el || !activeFileId) return

    const fileChanged = lastFileId.current !== activeFileId
    const externalEdit = editorContent !== lastSerialized.current
    if (!fileChanged && !externalEdit) return

    applyingExternal.current = true
    el.innerHTML = renderMarkdownToHtml(editorContent, (title) => {
      const note = index.notesByTitle.get(title.toLowerCase())
      return note ? `#note/${note.id}` : null
    })
    ensureEditableTail(el)
    lastFileId.current = activeFileId
    lastSerialized.current = editorContent
    applyingExternal.current = false
  }, [activeFileId, editorContent, index.notesByTitle])

  function syncFromDom() {
    const el = surfaceRef.current
    if (!el || applyingExternal.current) return
    const body = htmlToMarkdown(el.innerHTML)
    const next = withPreservedFrontmatter(lastSerialized.current, body)
    if (next === lastSerialized.current) return
    lastSerialized.current = next
    setEditorContent(next)
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
    if (title) await openNoteByTitle(title)
  }

  function handleFormat(kind: 'h1' | 'h2' | 'bold' | 'italic' | 'strike' | 'code' | 'ul' | 'ol' | 'quote') {
    surfaceRef.current?.focus()
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

    // Keep focus in the editor; indent / outdent lists or insert spaces.
    if (key === 'Tab') {
      e.preventDefault()
      if (e.shiftKey) outdentSelection()
      else indentSelection()
      syncFromDom()
      return
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) return
      const node = selection.anchorNode
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
      selection.removeAllRanges()
      selection.addRange(range)
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
      // Mod+Shift+X (common) or Mod+Shift+S
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

  return (
    <div className="wysiwyg-editor">
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
      </div>
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
      />
    </div>
  )
}
