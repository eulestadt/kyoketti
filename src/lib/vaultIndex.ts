import type { NoteMeta } from '../types'
import { noteTitleFromName, parseNote, splitWikiInner } from './markdown'
import { isMarkdownFile, isVaultTextFile } from './googleDrive'
import type { DriveFile } from '../types'

export type VaultIndex = {
  notesById: Map<string, NoteMeta>
  /** Unique basenames, full path keys (no ext), and aliases → note */
  notesByTitle: Map<string, NoteMeta>
  backlinks: Map<string, string[]>
  tags: Map<string, string[]>
}

/** Normalize a vault path / link target for comparison (no ext, forward slashes, lower). */
export function pathKey(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\.(md|markdown|base)$/i, '')
    .toLowerCase()
}

export function folderOfPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const i = normalized.lastIndexOf('/')
  return i === -1 ? '' : normalized.slice(0, i)
}

export function extractAliases(frontmatter: Record<string, unknown>): string[] {
  const raw = frontmatter.aliases ?? frontmatter.alias
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v).trim()).filter(Boolean)
  }
  if (typeof raw === 'string') {
    return raw
      .split(/[,\n]/)
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean)
  }
  return []
}

/**
 * Resolve a wikilink / note ref the way Obsidian does:
 * exact path, relative path, unique basename, then alias.
 */
export function resolveNoteRef(
  index: VaultIndex,
  ref: string,
  opts?: { fromPath?: string },
): NoteMeta | null {
  const stripped = ref.trim().replace(/^\[\[|\]\]$/g, '')
  const { target: beforeAlias } = splitWikiInner(stripped)
  const target = beforeAlias.split('#')[0]?.trim() ?? ''
  if (!target) return null

  const want = pathKey(target)
  const notes = [...index.notesById.values()]

  // 1. Exact path (with or without extension)
  for (const note of notes) {
    if (pathKey(note.path) === want) return note
  }

  // 2. Relative to the linking note's folder
  if (opts?.fromPath) {
    const baseFolder = folderOfPath(opts.fromPath)
    const joined = want.startsWith('/')
      ? want.slice(1)
      : pathKey(baseFolder ? `${baseFolder}/${target}` : target)
    for (const note of notes) {
      if (pathKey(note.path) === joined) return note
    }
    // ../ segments
    if (target.includes('..') || target.startsWith('./')) {
      const resolved = resolveRelativePath(baseFolder, target)
      for (const note of notes) {
        if (pathKey(note.path) === pathKey(resolved)) return note
      }
    }
  }

  // 3. Unique basename (Obsidian shortest form)
  const base = want.includes('/') ? want.slice(want.lastIndexOf('/') + 1) : want
  const byBase = notes.filter((n) => pathKey(n.title) === base)
  if (byBase.length === 1) return byBase[0]!
  if (byBase.length > 1 && opts?.fromPath) {
    const folder = folderOfPath(opts.fromPath)
    const sameFolder = byBase.filter((n) => folderOfPath(n.path) === folder)
    if (sameFolder.length === 1) return sameFolder[0]!
  }

  // 4. Alias (frontmatter aliases / alias)
  for (const note of notes) {
    for (const alias of note.aliases ?? []) {
      if (pathKey(alias) === want || alias.toLowerCase() === base) return note
    }
  }

  // 5. Ambiguous basename — still return first match (Obsidian also links; path recommended)
  if (byBase.length > 0) return byBase[0]!

  return null
}

function resolveRelativePath(fromFolder: string, rel: string): string {
  const parts = (fromFolder ? fromFolder.split('/') : []).filter(Boolean)
  for (const seg of rel.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

export function createEmptyIndex(): VaultIndex {
  return {
    notesById: new Map(),
    notesByTitle: new Map(),
    backlinks: new Map(),
    tags: new Map(),
  }
}

export function pathForFile(file: DriveFile, idToPath: Map<string, string>): string {
  return idToPath.get(file.id) ?? file.name
}

export function buildPaths(files: DriveFile[], rootId: string): Map<string, string> {
  const byId = new Map(files.map((f) => [f.id, f]))
  const cache = new Map<string, string>()

  function resolve(id: string): string {
    if (cache.has(id)) return cache.get(id)!
    const file = byId.get(id)
    if (!file) return ''
    const parentId = file.parents?.[0]
    if (!parentId || parentId === rootId) {
      cache.set(id, file.name)
      return file.name
    }
    const parentPath = resolve(parentId)
    const full = parentPath ? `${parentPath}/${file.name}` : file.name
    cache.set(id, full)
    return full
  }

  for (const file of files) resolve(file.id)
  return cache
}

function rebuildTitleMap(notesById: Map<string, NoteMeta>): Map<string, NoteMeta> {
  const notesByTitle = new Map<string, NoteMeta>()
  const baseCounts = new Map<string, number>()

  for (const note of notesById.values()) {
    const base = note.title.toLowerCase()
    baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1)
  }

  for (const note of notesById.values()) {
    const base = note.title.toLowerCase()
    // Unique basenames only — duplicates must be opened via path
    if ((baseCounts.get(base) ?? 0) === 1) {
      notesByTitle.set(base, note)
    }
    notesByTitle.set(pathKey(note.path), note)
    for (const alias of note.aliases ?? []) {
      const key = alias.toLowerCase()
      // Don't let an alias hide a real unique basename
      if (!notesByTitle.has(key) || notesByTitle.get(key) === note) {
        notesByTitle.set(key, note)
      }
    }
  }

  return notesByTitle
}

export function indexFromNotes(notes: NoteMeta[]): VaultIndex {
  const notesById = new Map<string, NoteMeta>()
  for (const note of notes) notesById.set(note.id, note)
  const notesByTitle = rebuildTitleMap(notesById)
  return rebuildRelations({ notesById, notesByTitle, backlinks: new Map(), tags: new Map() })
}

export function upsertNote(index: VaultIndex, note: NoteMeta): VaultIndex {
  const notesById = new Map(index.notesById)
  notesById.set(note.id, note)
  const notesByTitle = rebuildTitleMap(notesById)
  return rebuildRelations({ notesById, notesByTitle, backlinks: new Map(), tags: new Map() })
}

export function removeNote(index: VaultIndex, id: string): VaultIndex {
  const existing = index.notesById.get(id)
  if (!existing) return index
  const notesById = new Map(index.notesById)
  notesById.delete(id)
  const notesByTitle = rebuildTitleMap(notesById)
  return rebuildRelations({ notesById, notesByTitle, backlinks: new Map(), tags: new Map() })
}

export function rebuildRelations(index: VaultIndex): VaultIndex {
  const backlinks = new Map<string, string[]>()
  const tags = new Map<string, string[]>()

  for (const note of index.notesById.values()) {
    for (const link of note.links) {
      const target = resolveNoteRef(index, link, { fromPath: note.path })
      const key = target?.id ?? `missing:${pathKey(link)}`
      const list = backlinks.get(key) ?? []
      list.push(note.id)
      backlinks.set(key, list)
    }
    for (const tag of note.tags) {
      const list = tags.get(tag) ?? []
      list.push(note.id)
      tags.set(tag, list)
    }
  }

  return { ...index, backlinks, tags }
}

export function noteFromFile(file: DriveFile, path: string, content: string): NoteMeta {
  const parsed = parseNote(content)
  // Title is always the filename, not the first H1 (Obsidian-equivalent).
  const title = noteTitleFromName(file.name)
  return {
    id: file.id,
    name: file.name,
    path,
    title,
    content,
    frontmatter: parsed.frontmatter,
    aliases: extractAliases(parsed.frontmatter),
    tags: parsed.tags,
    links: parsed.links,
    modifiedTime: file.modifiedTime,
  }
}

export function markdownFiles(files: DriveFile[]): DriveFile[] {
  return files.filter(isMarkdownFile)
}

/** Notes + .base files loaded into the vault index. */
export function vaultTextFiles(files: DriveFile[]): DriveFile[] {
  return files.filter(isVaultTextFile)
}

export function fuzzyMatch(query: string, text: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const t = text.toLowerCase()
  if (t.includes(q)) return true
  let qi = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++
  }
  return qi === q.length
}

export type GraphData = {
  nodes: Array<{ id: string; title: string; path: string; orphan: boolean }>
  links: Array<{ source: string; target: string }>
}

export function buildGraph(index: VaultIndex): GraphData {
  const nodes = [...index.notesById.values()].map((note) => ({
    id: note.id,
    title: note.title,
    path: note.path,
    orphan: false,
  }))

  const links: Array<{ source: string; target: string }> = []
  const linked = new Set<string>()

  for (const note of index.notesById.values()) {
    for (const link of note.links) {
      const target = resolveNoteRef(index, link, { fromPath: note.path })
      if (target) {
        links.push({ source: note.id, target: target.id })
        linked.add(note.id)
        linked.add(target.id)
      }
    }
  }

  for (const node of nodes) {
    node.orphan = !linked.has(node.id)
  }

  return { nodes, links }
}

/**
 * Rewrite wikilinks / embeds that pointed at a renamed note (Obsidian-style).
 * Preserves `#heading` and `|display` parts.
 */
export function rewriteLinksForRename(
  content: string,
  oldRef: { title: string; path: string; name: string },
  newRef: { title: string; path: string; name: string },
): string {
  const oldKeys = new Set(
    [oldRef.title, oldRef.name, oldRef.path, pathKey(oldRef.path), pathKey(oldRef.title)]
      .map((s) => pathKey(s))
      .filter(Boolean),
  )

  function mapTarget(target: string): string | null {
    const key = pathKey(target)
    if (!oldKeys.has(key)) return null
    // Keep path-style links as path-style (no extension); basename links as basename
    if (target.includes('/')) {
      return newRef.path.replace(/\.(md|markdown|base)$/i, '')
    }
    return newRef.title
  }

  return content.replace(/(!?\[\[)([^\]]+)(\]\])/g, (full, open: string, inner: string, close: string) => {
    // Parse target / #heading / |alias with escapes
    let target = ''
    let rest = ''
    let buf = ''
    let phase: 'target' | 'rest' = 'target'
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === '\\' && inner[i + 1] === '|') {
        buf += '\\|'
        i++
        continue
      }
      if (phase === 'target' && (inner[i] === '#' || (inner[i] === '|' && !buf.endsWith('\\')))) {
        target = buf
        rest = inner.slice(i)
        phase = 'rest'
        break
      }
      buf += inner[i]
    }
    if (phase === 'target') target = buf
    const next = mapTarget(target.trim())
    if (next == null) return full
    return `${open}${next}${rest}${close}`
  })
}
