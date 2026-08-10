import { isMarkdownFile } from './googleDrive'
import { noteTitleFromName, parseNote } from './markdown'
import type { DriveFile, NoteMeta } from '../types'

export type VaultIndex = {
  notesById: Map<string, NoteMeta>
  notesByTitle: Map<string, NoteMeta>
  backlinks: Map<string, string[]>
  tags: Map<string, string[]>
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

export function upsertNote(
  index: VaultIndex,
  note: NoteMeta,
): VaultIndex {
  const notesById = new Map(index.notesById)
  const notesByTitle = new Map(index.notesByTitle)
  notesById.set(note.id, note)
  notesByTitle.set(note.title.toLowerCase(), note)
  return rebuildRelations({ notesById, notesByTitle, backlinks: new Map(), tags: new Map() })
}

export function removeNote(index: VaultIndex, id: string): VaultIndex {
  const existing = index.notesById.get(id)
  if (!existing) return index
  const notesById = new Map(index.notesById)
  const notesByTitle = new Map(index.notesByTitle)
  notesById.delete(id)
  notesByTitle.delete(existing.title.toLowerCase())
  return rebuildRelations({ notesById, notesByTitle, backlinks: new Map(), tags: new Map() })
}

export function rebuildRelations(index: VaultIndex): VaultIndex {
  const backlinks = new Map<string, string[]>()
  const tags = new Map<string, string[]>()

  for (const note of index.notesById.values()) {
    for (const link of note.links) {
      const target = index.notesByTitle.get(link.toLowerCase())
      const key = target?.id ?? `missing:${link.toLowerCase()}`
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

export function noteFromFile(
  file: DriveFile,
  path: string,
  content: string,
): NoteMeta {
  const parsed = parseNote(content)
  // Title is always the filename (Obsidian-style), not the first H1.
  const title = noteTitleFromName(file.name)
  return {
    id: file.id,
    name: file.name,
    path,
    title,
    content,
    frontmatter: parsed.frontmatter,
    tags: parsed.tags,
    links: parsed.links,
    modifiedTime: file.modifiedTime,
  }
}

export function markdownFiles(files: DriveFile[]): DriveFile[] {
  return files.filter(isMarkdownFile)
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
      const target = index.notesByTitle.get(link.toLowerCase())
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
