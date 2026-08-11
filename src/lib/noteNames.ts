/** Strip .md/.markdown/.base for display. Files keep their extension on disk. */
export function displayNoteName(name: string): string {
  return name.replace(/\.(md|markdown|base)$/i, '')
}

/** Canonical note title = filename without extension. */
export function noteTitleFromFileName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return 'Untitled'
  return displayNoteName(trimmed) || 'Untitled'
}

/** Ensure markdown files keep an extension when creating/renaming from the UI. */
export function ensureMarkdownFileName(name: string, previousName?: string): string {
  const trimmed = name.trim()
  if (!trimmed) return previousName ?? 'Untitled.md'
  if (/\.(md|markdown|base)$/i.test(trimmed)) return trimmed
  if (previousName && /\.base$/i.test(previousName)) {
    return `${trimmed}.base`
  }
  if (previousName && /\.(md|markdown)$/i.test(previousName)) {
    return `${trimmed}.md`
  }
  // New notes from the UI are markdown by default
  if (!previousName || previousName.toLowerCase().endsWith('.md')) {
    return `${trimmed}.md`
  }
  return trimmed
}

/** Seed body for a new note: one H1 matching the filename title. */
export function seedNoteContent(fileName: string): string {
  return `# ${noteTitleFromFileName(fileName)}\n\n`
}
