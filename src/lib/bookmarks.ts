export type Bookmark = {
  id: string
  name: string
  path: string
}

const KEY = 'kyoketti.bookmarks'

export function loadBookmarks(): Bookmark[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((row) => {
        if (!row || typeof row !== 'object') return null
        const item = row as Record<string, unknown>
        if (typeof item.id !== 'string') return null
        return {
          id: item.id,
          name: String(item.name ?? ''),
          path: String(item.path ?? ''),
        }
      })
      .filter((row): row is Bookmark => Boolean(row))
  } catch {
    return []
  }
}

export function saveBookmarks(items: Bookmark[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items))
  } catch {
    /* ignore */
  }
}

export function isBookmarked(id: string): boolean {
  return loadBookmarks().some((b) => b.id === id)
}

export function toggleBookmark(item: Bookmark): Bookmark[] {
  const current = loadBookmarks()
  const next = current.some((b) => b.id === item.id)
    ? current.filter((b) => b.id !== item.id)
    : [...current, item]
  saveBookmarks(next)
  return next
}