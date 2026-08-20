import { useMemo } from 'react'
import { useApp } from '../../hooks/useApp'
import { parseFrontmatter, renderMarkdownToHtml, splitWikiInner } from '../../lib/markdown'
import { isBaseFileName, splitBaseEmbedTarget, parseBaseConfig } from '../../lib/bases'
import { isCanvasFileName } from '../../lib/canvas'
import { resolveNoteRef } from '../../lib/vaultIndex'
import { BaseEmbed } from '../bases/BaseViewer'
import { CanvasEmbed } from '../canvas/CanvasViewer'
import { ContextMenu, useContextMenu } from '../ui/ContextMenu'
import { previewMenuItems, type PreviewMenuTarget } from '../ui/previewMenu'

type Segment =
  | { kind: 'html'; html: string }
  | { kind: 'base-fence'; yaml: string; viewName?: string }
  | { kind: 'base-embed'; file: string; viewName?: string }
  | { kind: 'canvas-embed'; file: string }

/**
 * Split markdown into HTML chunks and live Base / Canvas embeds.
 */
function splitEmbedSegments(raw: string): Segment[] {
  const { body } = parseFrontmatter(raw)
  const segments: Segment[] = []
  const parts: Array<
    | { type: 'text'; value: string }
    | { type: 'fence'; value: string; view?: string }
    | { type: 'base-embed'; value: string; view?: string }
    | { type: 'canvas-embed'; value: string }
  > = []

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
        parts.push({ type: 'base-embed', value: file, view })
      } else if (isCanvasFileName(file) || file.toLowerCase().endsWith('.canvas')) {
        parts.push({ type: 'canvas-embed', value: file })
      } else {
        parts.push({ type: 'text', value: m[0] })
      }
    }
    last = m.index + m[0].length
  }
  if (last < body.length) parts.push({ type: 'text', value: body.slice(last) })

  if (!parts.length) parts.push({ type: 'text', value: body })

  for (const part of parts) {
    if (part.type === 'fence') {
      segments.push({ kind: 'base-fence', yaml: part.value, viewName: part.view })
    } else if (part.type === 'base-embed') {
      segments.push({ kind: 'base-embed', file: part.value, viewName: part.view })
    } else if (part.type === 'canvas-embed') {
      segments.push({ kind: 'canvas-embed', file: part.value })
    } else {
      segments.push({ kind: 'html', html: part.value })
    }
  }
  return segments
}

function findVaultFile(index: ReturnType<typeof useApp>['index'], file: string, thisFileId?: string) {
  const fromPath = thisFileId ? index.notesById.get(thisFileId)?.path : undefined
  const title = file.replace(/\.(base|canvas)$/i, '')
  return (
    resolveNoteRef(index, file, { fromPath }) ||
    resolveNoteRef(index, title, { fromPath }) ||
    [...index.notesById.values()].find(
      (n) =>
        n.name.toLowerCase() === file.toLowerCase() ||
        n.path.toLowerCase() === file.toLowerCase(),
    )
  )
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
  const { index, openFile } = useApp()
  const { menu, open, close } = useContextMenu<PreviewMenuTarget>()

  const segments = useMemo(() => splitEmbedSegments(content), [content])

  const fromPath = thisFileId ? index.notesById.get(thisFileId)?.path : undefined

  const resolveHref = (title: string) => {
    const note = resolveNoteRef(index, title, { fromPath })
    return note ? `#note/${note.id}` : null
  }

  function onPreviewContextMenu(e: React.MouseEvent) {
    const target = e.target as HTMLElement
    const internal = target.closest('a.internal-link') as HTMLAnchorElement | null
    const image = target.closest('img') as HTMLImageElement | null
    const external = target.closest('a') as HTMLAnchorElement | null
    if (internal?.dataset.note) {
      open(e, { kind: 'link', title: internal.dataset.note })
      return
    }
    if (image) {
      open(e, { kind: 'image', img: image })
      return
    }
    if (external?.href && !external.classList.contains('internal-link')) {
      open(e, { kind: 'url', href: external.href })
    }
  }

  return (
    <div className="reading-view markdown-preview">
      {segments.map((seg, i) => {
        if (seg.kind === 'html') {
          const html = renderMarkdownToHtml(
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
              onContextMenu={onPreviewContextMenu}
            />
          )
        }
        if (seg.kind === 'base-fence') {
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
        if (seg.kind === 'canvas-embed') {
          const note = findVaultFile(index, seg.file, thisFileId)
          if (!note) {
            return (
              <div key={i} className="cm-embed missing">
                Missing canvas: {seg.file}
              </div>
            )
          }
          return <CanvasEmbed key={i} content={note.content} />
        }
        const note = findVaultFile(index, seg.file, thisFileId)
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
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={close}
          items={previewMenuItems(menu.data, {
            index,
            fromPath,
            openFile,
            openLink: onInternalClick,
          })}
        />
      )}
    </div>
  )
}
