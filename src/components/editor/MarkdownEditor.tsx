import CodeMirror from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { search } from '@codemirror/search'
import { EditorView } from '@codemirror/view'
import { oneDark } from '@codemirror/theme-one-dark'
import { useEffect, useMemo, useRef } from 'react'
import { useApp } from '../../hooks/useApp'
import { useTheme } from '../../hooks/useTheme'
import { isBaseFileName } from '../../lib/bases'
import { isCanvasFileName } from '../../lib/canvas'
import { isImageFileName } from '../../lib/media'
import { useVaultMediaSrc } from '../../hooks/useVaultMedia'
import { applyCmCommand } from '../../lib/cmCommands'
import { subscribeEditor } from '../../lib/editorBridge'
import { BaseViewer } from '../bases/BaseViewer'
import { CanvasViewer } from '../canvas/CanvasViewer'
import { WysiwygEditor } from './WysiwygEditor'
import { MarkdownWithBases } from './MarkdownWithBases'
import './MarkdownEditor.css'

const editorChrome = EditorView.theme({
  '&': { height: '100%', width: '100%', maxWidth: '100%' },
  '.cm-scroller': { overflow: 'auto', width: '100%', maxWidth: '100%' },
  '.cm-content': { maxWidth: '100%' },
})

function SourceEditor({
  value,
  onChange,
  theme,
  lineNumbers,
}: {
  value: string
  onChange: (value: string) => void
  theme: 'light' | typeof oneDark
  lineNumbers: boolean
}) {
  const viewRef = useRef<EditorView | null>(null)
  const extensions = useMemo(
    () => [markdown({ base: markdownLanguage }), EditorView.lineWrapping, editorChrome, search()],
    [],
  )

  useEffect(() => {
    return subscribeEditor((cmd) => {
      const view = viewRef.current
      if (!view) return false
      return applyCmCommand(view, cmd)
    })
  }, [])

  return (
    <CodeMirror
      value={value}
      height="100%"
      width="100%"
      theme={theme}
      extensions={extensions}
      onChange={onChange}
      onCreateEditor={(view) => {
        viewRef.current = view
      }}
      basicSetup={{
        lineNumbers,
        foldGutter: lineNumbers,
        highlightActiveLine: true,
      }}
    />
  )
}

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
  const isCanvas = isCanvasFileName(activeName)
  const isImage = isImageFileName(activeName)
  const imagePath = tabs.find((t) => t.id === activeFileId)?.path ?? activeName

  const editorTheme = theme === 'dark' ? oneDark : 'light'

  if (!activeFileId) {
    return (
      <div className="editor-empty">
        <h2>No file open</h2>
        <p>Open a note from the file explorer, or a canvas from the left ribbon.</p>
      </div>
    )
  }

  if (isCanvas) {
    return (
      <CanvasViewer
        key={activeFileId}
        content={editorContent}
        onChange={setEditorContent}
      />
    )
  }

  if (isImage) {
    return <ImagePreview key={activeFileId} path={imagePath} name={activeName} />
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
          onInternalClick={(title) =>
            void openNoteByTitle(title, index.notesById.get(activeFileId)?.path)
          }
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
          <SourceEditor
            key={activeFileId}
            value={editorContent}
            onChange={setEditorContent}
            theme={editorTheme}
            lineNumbers={false}
          />
        </div>
        <div className="preview-pane">
          <MarkdownWithBases
            content={editorContent}
            thisFileId={activeFileId}
            onInternalClick={(title) =>
              void openNoteByTitle(title, index.notesById.get(activeFileId)?.path)
            }
          />
        </div>
      </div>
    )
  }

  return (
    <div className="editor-pane full">
      <SourceEditor
        key={activeFileId}
        value={editorContent}
        onChange={setEditorContent}
        theme={editorTheme}
        lineNumbers
      />
    </div>
  )
}

function ImagePreview({ path, name }: { path: string; name: string }) {
  const src = useVaultMediaSrc(path)
  return (
    <div className="image-preview">
      {src ? (
        <img src={src} alt={name} />
      ) : (
        <p>Could not load this image. It may be missing from the vault or unavailable offline.</p>
      )}
    </div>
  )
}
