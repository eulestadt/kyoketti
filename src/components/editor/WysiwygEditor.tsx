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
    // Keep editing on plain click; navigate with modifier click.
    if (!(e.metaKey || e.ctrlKey)) return
    e.preventDefault()
    const title = link.dataset.note
    if (title) await openNoteByTitle(title)
  }

  function handleFormat(command: string, value?: string) {
    surfaceRef.current?.focus()
    runFormat(command, value)
    syncFromDom()
  }

  return (
    <div className="wysiwyg-editor">
      <div className="wysiwyg-toolbar" role="toolbar" aria-label="Formatting">
        <button type="button" title="Heading 1" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFormat('formatBlock', 'h1')}>
          <Heading1 size={15} />
        </button>
        <button type="button" title="Heading 2" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFormat('formatBlock', 'h2')}>
          <Heading2 size={15} />
        </button>
        <button type="button" title="Bold" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFormat('bold')}>
          <Bold size={15} />
        </button>
        <button type="button" title="Italic" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFormat('italic')}>
          <Italic size={15} />
        </button>
        <button type="button" title="Strikethrough" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFormat('strikeThrough')}>
          <Strikethrough size={15} />
        </button>
        <button type="button" title="Bullet list" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFormat('insertUnorderedList')}>
          <List size={15} />
        </button>
        <button type="button" title="Numbered list" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFormat('insertOrderedList')}>
          <ListOrdered size={15} />
        </button>
        <button type="button" title="Quote" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFormat('formatBlock', 'blockquote')}>
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
        onClick={(e) => void handleClick(e)}
      />
    </div>
  )
}
