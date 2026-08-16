export type EditorFormat =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'highlight'
  | 'comment'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'heading-remove'
  | 'ul'
  | 'ol'
  | 'quote'
  | 'checkbox'
  | 'table'

export type EditorCommand =
  | { type: 'insert'; text: string }
  | { type: 'wrap'; before: string; after: string }
  | { type: 'format'; kind: EditorFormat }
  | { type: 'focus' }
  | { type: 'open-search' }

type Listener = (cmd: EditorCommand) => boolean

const listeners = new Set<Listener>()

export function subscribeEditor(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function dispatchEditor(cmd: EditorCommand): boolean {
  const order = [...listeners].reverse()
  for (const listener of order) {
    try {
      if (listener(cmd)) return true
    } catch {
      /* ignore a broken editor surface */
    }
  }
  return false
}

export function insertSnippet(text: string): boolean {
  return dispatchEditor({ type: 'insert', text })
}

export function wrapSnippet(before: string, after: string): boolean {
  return dispatchEditor({ type: 'wrap', before, after })
}

export function formatEditor(kind: EditorFormat): boolean {
  return dispatchEditor({ type: 'format', kind })
}

export function focusEditor(): boolean {
  return dispatchEditor({ type: 'focus' })
}

export function openEditorSearch(): boolean {
  return dispatchEditor({ type: 'open-search' })
}

export const MD_TABLE = `| Column 1 | Column 2 |
| --- | --- |
|  |  |
`

export const MD_CALLOUT = `> [!note]
> 
`

export const MD_CODEBLOCK = `\`\`\`
\`\`\`
`