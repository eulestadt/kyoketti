import { compactItems, type ContextMenuItem } from './ContextMenu'
import { copyPath, copyWikilink } from '../../lib/clipboard'
import { displayNoteName, ensureMarkdownFileName } from '../../lib/noteNames'
import type { VaultIndex } from '../../lib/vaultIndex'

export type NoteLike = { id: string; name: string; path: string }

type NoteMenuActions = {
  openFile: (id: string, hint?: { name?: string; path?: string }) => Promise<void> | void
  renameNode?: (id: string, name: string) => Promise<void> | void
  deleteNode?: (id: string) => Promise<void> | void
  duplicateFile?: (id: string) => Promise<void> | void
  index?: VaultIndex
}

export function promptFileRename(currentName: string, isFolder = false): string | null {
  const shown = isFolder ? currentName : displayNoteName(currentName)
  const entered = window.prompt('Rename', shown)
  if (!entered?.trim()) return null
  if (isFolder) {
    const next = entered.trim()
    return next && next !== currentName ? next : null
  }
  const next = ensureMarkdownFileName(entered, currentName)
  return next && next !== currentName ? next : null
}

export function noteMenuItems(
  note: NoteLike,
  actions: NoteMenuActions,
  opts?: { open?: boolean; rename?: boolean; duplicate?: boolean; remove?: boolean },
): ContextMenuItem[] {
  const includeOpen = opts?.open !== false
  const includeRename = Boolean(opts?.rename && actions.renameNode)
  const includeDuplicate = Boolean(opts?.duplicate && actions.duplicateFile)
  const includeRemove = Boolean(opts?.remove && actions.deleteNode)
  return compactItems([
    includeOpen && {
      label: 'Open',
      onClick: () => void actions.openFile(note.id, { name: note.name, path: note.path }),
    },
    (includeRename || includeDuplicate) && { type: 'separator' as const },
    includeRename && {
      label: 'Rename',
      onClick: () => {
        const next = promptFileRename(note.name)
        if (next) void actions.renameNode?.(note.id, next)
      },
    },
    includeDuplicate && {
      label: 'Make a copy',
      onClick: () => void actions.duplicateFile?.(note.id),
    },
    { type: 'separator' as const },
    {
      label: 'Copy path',
      onClick: () => void copyPath(note.path || note.name),
    },
    {
      label: 'Copy wikilink',
      onClick: () => void copyWikilink(note.name, note.path, actions.index),
    },
    includeRemove && { type: 'separator' as const },
    includeRemove && {
      label: 'Delete',
      danger: true,
      onClick: () => {
        const label = displayNoteName(note.name)
        if (!window.confirm(`Move “${label}” to trash?`)) return
        void actions.deleteNode?.(note.id)
      },
    },
  ])
}
