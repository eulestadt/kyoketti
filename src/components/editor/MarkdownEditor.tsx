import CodeMirror from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import { oneDark } from '@codemirror/theme-one-dark'
import { useMemo } from 'react'
import { useApp } from '../../hooks/useApp'
import { useTheme } from '../../hooks/useTheme'
import { renderMarkdownToHtml } from '../../lib/markdown'
import './MarkdownEditor.css'

export function MarkdownEditor() {
  const { editorContent, setEditorContent, viewMode, openNoteByTitle, index, activeFileId } = useApp()
  const { theme } = useTheme()

  const previewHtml = useMemo(() => {
    return renderMarkdownToHtml(editorContent, (title) => {
      const note = index.notesByTitle.get(title.toLowerCase())
      return note ? `#note/${note.id}` : null
    })
  }, [editorContent, index.notesByTitle])

  const editorTheme = theme === 'dark' ? oneDark : 'light'

  if (!activeFileId) {
    return (
      <div className="editor-empty">
        <h2>No file open</h2>
        <p>Select a note from the file explorer, or press Ctrl/Cmd+O to quick switch.</p>
      </div>
    )
  }

  async function handlePreviewClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    const link = target.closest('a.internal-link') as HTMLAnchorElement | null
    if (!link) return
    e.preventDefault()
    const title = link.dataset.note
    if (title) await openNoteByTitle(title)
  }

  if (viewMode === 'reading') {
    return (
      <div className="reading-view markdown-preview" onClick={(e) => void handlePreviewClick(e)} dangerouslySetInnerHTML={{ __html: previewHtml }} />
    )
  }

  if (viewMode === 'live') {
    return (
      <div className="live-split">
        <div className="editor-pane">
          <CodeMirror
            value={editorContent}
            height="100%"
            theme={editorTheme}
            extensions={[markdown({ base: markdownLanguage }), EditorView.lineWrapping]}
            onChange={(value) => setEditorContent(value)}
            basicSetup={{
              lineNumbers: false,
              foldGutter: false,
              highlightActiveLine: true,
            }}
          />
        </div>
        <div
          className="preview-pane markdown-preview"
          onClick={(e) => void handlePreviewClick(e)}
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      </div>
    )
  }

  return (
    <div className="editor-pane full">
      <CodeMirror
        value={editorContent}
        height="100%"
        theme={editorTheme}
        extensions={[markdown({ base: markdownLanguage }), EditorView.lineWrapping]}
        onChange={(value) => setEditorContent(value)}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: true,
        }}
      />
    </div>
  )
}
