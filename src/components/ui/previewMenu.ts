import { compactItems, type ContextMenuItem } from './ContextMenu'
import { copyImageElement, copyPath, copyText, copyWikilink } from '../../lib/clipboard'
import { resolveNoteRef, type VaultIndex } from '../../lib/vaultIndex'

export type PreviewMenuTarget =
  | { kind: 'link'; title: string }
  | { kind: 'url'; href: string }
  | { kind: 'image'; img: HTMLImageElement }

export function previewMenuItems(
  data: PreviewMenuTarget,
  opts: {
    index: VaultIndex
    fromPath?: string
    openFile: (id: string) => Promise<void> | void
    openLink: (title: string) => void
  },
): ContextMenuItem[] {
  if (data.kind === 'link') {
    const note = resolveNoteRef(opts.index, data.title, { fromPath: opts.fromPath })
    return compactItems([
      {
        label: 'Open',
        onClick: () => {
          if (note) void opts.openFile(note.id)
          else opts.openLink(data.title)
        },
      },
      {
        label: 'Copy wikilink',
        onClick: () => void copyWikilink(note?.name ?? data.title, note?.path, opts.index),
      },
      {
        label: 'Copy path',
        disabled: !note,
        onClick: () => {
          if (note) void copyPath(note.path)
        },
      },
    ])
  }
  if (data.kind === 'url') {
    return compactItems([
      {
        label: 'Open in browser',
        onClick: () => {
          window.open(data.href, '_blank', 'noopener,noreferrer')
        },
      },
      { label: 'Copy URL', onClick: () => void copyText(data.href) },
    ])
  }
  return compactItems([
    { label: 'Copy image', onClick: () => void copyImageElement(data.img) },
    {
      label: 'Copy image URL',
      onClick: () => void copyText(data.img.currentSrc || data.img.src),
    },
  ])
}
