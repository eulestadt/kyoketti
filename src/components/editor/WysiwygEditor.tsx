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

function wrapSelection(tagName: 'strong' | 'em' | 'del') {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
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
    runFormat(tagName === 'strong' ? 'bold' : tagName === 'em' ? 'italic' : 'strikeThrough')
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

  function handleFormat(kind: 'h1' | 'h2' | 'bold' | 'italic' | 'strike' | 'ul' | 'ol' | 'quote') {
    surfaceRef.current?.focus()
    if (kind === 'h1') runFormat('formatBlock', 'h1')
    else if (kind === 'h2') runFormat('formatBlock', 'h2')
    else if (kind === 'bold') wrapSelection('strong')
    else if (kind === 'italic') wrapSelection('em')
    else if (kind === 'strike') wrapSelection('del')
    else if (kind === 'ul') runFormat('insertUnorderedList')
    else if (kind === 'ol') runFormat('insertOrderedList')
    else if (kind === 'quote') runFormat('formatBlock', 'blockquote')
    syncFromDom()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
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
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault()
      handleFormat('bold')
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault()
      handleFormat('italic')
    }
  }

  return (
    <div className="wysiwyg-editor">
      <div className="wysiwyg-toolbar" role="toolbar" aria-label="Formatting">
        <button type="button" title="Heading 1" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFormat('h1')}>
          <Heading1 size={15} />
        </button>
        <button type="button" title="Heading 2" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFormat('h2')}>
          <Heading2 size={15} />
        </button>
        <button type="button" title="Bold" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFormat('bold')}>
          <Bold size={15} />
        </button>
        <button type="button" title="Italic" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFormat('italic')}>
          <Italic size={15} />
        </button>
        <button type="button" title="Strikethrough" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFormat('strike')}>
          <Strikethrough size={15} />
        </button>
        <button type="button" title="Bullet list" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFormat('ul')}>
          <List size={15} />
        </button>
        <button type="button" title="Numbered list" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFormat('ol')}>
          <ListOrdered size={15} />
        </button>
        <button type="button" title="Quote" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFormat('quote')}>
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
