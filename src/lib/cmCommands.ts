import { EditorView } from '@codemirror/view'
import { openSearchPanel } from '@codemirror/search'
import { MD_TABLE, type EditorCommand, type EditorFormat } from './editorBridge'

export function applyCmCommand(view: EditorView, cmd: EditorCommand): boolean {
  view.focus()
  if (cmd.type === 'focus') return true
  if (cmd.type === 'open-search') {
    openSearchPanel(view)
    return true
  }
  if (cmd.type === 'insert') {
    view.dispatch(view.state.replaceSelection(cmd.text))
    return true
  }
  if (cmd.type === 'wrap') {
    const sel = view.state.selection.main
    const text = view.state.sliceDoc(sel.from, sel.to)
    view.dispatch(view.state.replaceSelection(`${cmd.before}${text}${cmd.after}`))
    if (!text) {
      const pos = sel.from + cmd.before.length
      view.dispatch({ selection: { anchor: pos, head: pos } })
    }
    return true
  }
  if (cmd.type === 'format') {
    applyCmFormat(view, cmd.kind)
    return true
  }
  return false
}

function applyCmFormat(view: EditorView, kind: EditorFormat) {
  const wrap = (before: string, after: string) => {
    const sel = view.state.selection.main
    const text = view.state.sliceDoc(sel.from, sel.to)
    view.dispatch(view.state.replaceSelection(`${before}${text}${after}`))
  }
  const heading = (level: number) => {
    const line = view.state.doc.lineAt(view.state.selection.main.from)
    const stripped = line.text.replace(/^#{1,6}\s+/, '')
    const next = level <= 0 ? stripped : `${'#'.repeat(level)} ${stripped}`
    view.dispatch({ changes: { from: line.from, to: line.to, insert: next } })
  }
  const prefixLine = (prefix: string) => {
    const line = view.state.doc.lineAt(view.state.selection.main.from)
    if (line.text.startsWith(prefix)) {
      view.dispatch({
        changes: { from: line.from, to: line.from + prefix.length, insert: '' },
      })
      return
    }
    view.dispatch({ changes: { from: line.from, insert: prefix } })
  }
  switch (kind) {
    case 'bold':
      wrap('**', '**')
      break
    case 'italic':
      wrap('*', '*')
      break
    case 'strike':
      wrap('~~', '~~')
      break
    case 'code':
      wrap('`', '`')
      break
    case 'highlight':
      wrap('==', '==')
      break
    case 'comment':
      wrap('%%', '%%')
      break
    case 'h1':
      heading(1)
      break
    case 'h2':
      heading(2)
      break
    case 'h3':
      heading(3)
      break
    case 'h4':
      heading(4)
      break
    case 'h5':
      heading(5)
      break
    case 'h6':
      heading(6)
      break
    case 'heading-remove':
      heading(0)
      break
    case 'ul':
      prefixLine('- ')
      break
    case 'ol':
      prefixLine('1. ')
      break
    case 'quote':
      prefixLine('> ')
      break
    case 'checkbox':
      prefixLine('- [ ] ')
      break
    case 'table':
      view.dispatch(view.state.replaceSelection(MD_TABLE))
      break
    default:
      break
  }
}