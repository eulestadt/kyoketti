/** Strip .md/.markdown for Obsidian-like display. Files stay markdown on disk. */
export function displayNoteName(name: string): string {
  return name.replace(/\.(md|markdown)$/i, '')
}

/** Ensure markdown files keep an extension when renaming from the UI. */
export function ensureMarkdownFileName(name: string, previousName?: string): string {
  const trimmed = name.trim()
  if (!trimmed) return previousName ?? 'Untitled.md'
  if (/\.(md|markdown)$/i.test(trimmed)) return trimmed
  if (previousName && /\.(md|markdown)$/i.test(previousName)) {
    return `${trimmed}.md`
  }
  // New notes from the UI are markdown by default
  if (!previousName || previousName.toLowerCase().endsWith('.md')) {
    return `${trimmed}.md`
  }
  return trimmed
}
