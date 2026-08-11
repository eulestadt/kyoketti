import CodeMirror from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import { oneDark } from '@codemirror/theme-one-dark'
import { useMemo } from 'react'
import { useApp } from '../../hooks/useApp'
import { useTheme } from '../../hooks/useTheme'
import { isBaseFileName } from '../../lib/bases'
import { BaseViewer } from '../bases/BaseViewer'
import { WysiwygEditor } from './WysiwygEditor'
import { MarkdownWithBases } from './MarkdownWithBases'
import './MarkdownEditor.css'

const editorChrome = EditorView.theme({
  '&': { height: '100%', width: '100%', maxWidth: '100%' },
  '.cm-scroller': { overflow: 'auto', width: '100%', maxWidth: '100%' },
  '.cm-content': { maxWidth: '100%' },
})

export function MarkdownEditor() {
  const {
    editorContent,
    setEditorContent,
    viewMode,
    openNoteByTitle,
    index,
    activeFileId,
    tabs,
  } = useApp()
  const { theme } = useTheme()

  const activeName = tabs.find((t) => t.id === activeFileId)?.name
    ?? index.notesById.get(activeFileId ?? '')?.name
    ?? ''
  const isBase = isBaseFileName(activeName)

  const extensions = useMemo(
    () => [markdown({ base: markdownLanguage }), EditorView.lineWrapping, editorChrome],
    [],
  )

  const editorTheme = theme === 'dark' ? oneDark : 'light'

  if (!activeFileId) {
    return (
      <div className="editor-empty">
        <h2>No file open</h2>
        <p>Select a note from the file explorer, or press Ctrl/Cmd+O to quick switch.</p>
      </div>
    )
  }

  if (isBase) {
    return (
      <BaseViewer
        key={activeFileId}
        content={editorContent}
        onChange={setEditorContent}
        thisFileId={activeFileId}
      />
    )
  }

  if (viewMode === 'reading') {
    return (
      <div key={activeFileId} className="reading-scroll">
        <MarkdownWithBases
          content={editorContent}
          thisFileId={activeFileId}
          onInternalClick={(title) => void openNoteByTitle(title)}
        />
      </div>
    )
  }

  if (viewMode === 'wysiwyg') {
    return <WysiwygEditor key={activeFileId} />
  }

  if (viewMode === 'live') {
    return (
      <div className="live-split">
        <div className="editor-pane">
          <CodeMirror
            key={activeFileId}
            value={editorContent}
            height="100%"
            theme={editorTheme}
            width="100%"
            extensions={extensions}
            onChange={(value) => setEditorContent(value)}
            basicSetup={{
              lineNumbers: false,
              foldGutter: false,
              highlightActiveLine: true,
            }}
          />
        </div>
        <div className="preview-pane">
          <MarkdownWithBases
            content={editorContent}
            thisFileId={activeFileId}
            onInternalClick={(title) => void openNoteByTitle(title)}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="editor-pane full">
      <CodeMirror
        key={activeFileId}
        value={editorContent}
        height="100%"
        width="100%"
        theme={editorTheme}
        extensions={extensions}
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
