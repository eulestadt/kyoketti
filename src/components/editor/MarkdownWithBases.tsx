import { useMemo } from 'react'
import { useApp } from '../../hooks/useApp'
import { parseFrontmatter, renderMarkdownToHtml, splitWikiInner } from '../../lib/markdown'
import { isBaseFileName, splitBaseEmbedTarget, parseBaseConfig } from '../../lib/bases'
import { BaseEmbed } from '../bases/BaseViewer'

type Segment =
  | { kind: 'html'; html: string }
  | { kind: 'base-fence'; yaml: string; viewName?: string }
  | { kind: 'base-embed'; file: string; viewName?: string }

/**
 * Split markdown into HTML chunks and live Base embeds (```base / ![[*.base]]).
 */
function splitBaseSegments(raw: string): Segment[] {
  const { body } = parseFrontmatter(raw)
  const segments: Segment[] = []
  // Protect and extract ```base fences and ![[*.base]] embeds
  const parts: Array<{ type: 'text' | 'fence' | 'embed'; value: string; view?: string }> = []
  let rest = body

  const combined =
    /```base[ \t]*([^\n]*)\n([\s\S]*?)```|!\[\[([^\]]+)\]\]/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = combined.exec(body))) {
    if (m.index > last) {
      parts.push({ type: 'text', value: body.slice(last, m.index) })
    }
    if (m[0].startsWith('```base')) {
      const header = (m[1] ?? '').trim()
      parts.push({ type: 'fence', value: m[2] ?? '', view: header || undefined })
    } else {
      const { target } = splitWikiInner(m[3] ?? '')
      const { file, view } = splitBaseEmbedTarget(target)
      if (isBaseFileName(file) || file.toLowerCase().endsWith('.base')) {
        parts.push({ type: 'embed', value: file, view })
      } else {
        parts.push({ type: 'text', value: m[0] })
      }
    }
    last = m.index + m[0].length
  }
  if (last < body.length) parts.push({ type: 'text', value: body.slice(last) })
  void rest

  // If no parts (no matches), single text
  if (!parts.length) parts.push({ type: 'text', value: body })

  for (const part of parts) {
    if (part.type === 'fence') {
      segments.push({ kind: 'base-fence', yaml: part.value, viewName: part.view })
    } else if (part.type === 'embed') {
      segments.push({ kind: 'base-embed', file: part.value, viewName: part.view })
    } else {
      segments.push({ kind: 'html', html: part.value })
    }
  }
  return segments
}

export function MarkdownWithBases({
  content,
  thisFileId,
  onInternalClick,
}: {
  content: string
  thisFileId?: string
  onInternalClick: (title: string) => void
}) {
  const { index } = useApp()

  const segments = useMemo(() => splitBaseSegments(content), [content])

  const resolveHref = (title: string) => {
    const note = index.notesByTitle.get(title.toLowerCase())
    return note ? `#note/${note.id}` : null
  }

  return (
    <div className="reading-view markdown-preview">
      {segments.map((seg, i) => {
        if (seg.kind === 'html') {
          // Re-wrap each text chunk as a full document for the renderer
          const html = renderMarkdownToHtml(
            // Avoid re-parsing frontmatter: prefix empty body only
            content.startsWith('---') ? `---\n---\n${seg.html}` : seg.html,
            resolveHref,
          )
          return (
            <div
              key={i}
              dangerouslySetInnerHTML={{ __html: html }}
              onClick={(e) => {
                const link = (e.target as HTMLElement).closest('a.internal-link') as HTMLAnchorElement | null
                if (!link) return
                e.preventDefault()
                const title = link.dataset.note
                if (title) onInternalClick(title)
              }}
            />
          )
        }
        if (seg.kind === 'base-fence') {
          // Validate yaml lightly
          void parseBaseConfig(seg.yaml)
          return (
            <BaseEmbed
              key={i}
              content={seg.yaml}
              viewName={seg.viewName}
              thisFileId={thisFileId}
            />
          )
        }
        // base-embed file
        const title = seg.file.replace(/\.base$/i, '')
        const note =
          index.notesByTitle.get(title.toLowerCase()) ||
          index.notesByTitle.get(seg.file.toLowerCase()) ||
          [...index.notesById.values()].find(
            (n) =>
              n.name.toLowerCase() === seg.file.toLowerCase() ||
              n.path.toLowerCase() === seg.file.toLowerCase() ||
              n.title.toLowerCase() === title.toLowerCase(),
          )
        if (!note) {
          return (
            <div key={i} className="cm-embed missing">
              Missing base: {seg.file}
            </div>
          )
        }
        return (
          <BaseEmbed
            key={i}
            content={note.content}
            viewName={seg.viewName}
            thisFileId={thisFileId}
          />
        )
      })}
    </div>
  )
}
