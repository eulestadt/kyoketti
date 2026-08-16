import { isImageFileName } from './media'

/** Strip .md/.markdown/.base/.canvas for display. Files keep their extension on disk. */
export function displayNoteName(name: string): string {
  return name.replace(/\.(md|markdown|base|canvas)$/i, '')
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
  if (/\.(md|markdown|base|canvas)$/i.test(trimmed)) return trimmed
  if (previousName && /\.base$/i.test(previousName)) {
    return `${trimmed}.base`
  }
  if (previousName && /\.canvas$/i.test(previousName)) {
    return `${trimmed}.canvas`
  }
  if (previousName && /\.(md|markdown)$/i.test(previousName)) {
    return `${trimmed}.md`
  }
  if (previousName && isImageFileName(previousName)) {
    if (isImageFileName(trimmed)) return trimmed.replace(/[\\/]/g, '-')
    const ext = previousName.match(/\.[^.]+$/)?.[0] ?? ''
    return `${trimmed}${ext}`
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

export function isMarkdownNoteName(name: string): boolean {
  return /\.(md|markdown)$/i.test(name)
}

export function isUntitledNoteName(name: string): boolean {
  return /^untitled(?: \d+)?$/i.test(noteTitleFromFileName(name))
}

function bodyAfterFrontmatter(raw: string): string {
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) return raw
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return raw
  return raw.slice(end + 4).replace(/^\r?\n/, '')
}

function stripHeadingMarkup(text: string): string {
  return text
    .replace(/\s+#+\s*$/, '')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, target: string, alias?: string) => alias || target)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\\([\\`*[\]{}()#+.!-])/g, '$1')
    .trim()
}

/** First ATX `# heading` in the note body (after YAML frontmatter). */
export function firstMarkdownH1(content: string): string | null {
  for (const line of bodyAfterFrontmatter(content).split(/\r?\n/)) {
    const match = line.trim().match(/^#(?!#)\s+(.*)$/)
    if (!match) continue
    const text = stripHeadingMarkup(match[1] ?? '')
    if (text) return text
  }
  return null
}

export function replaceFirstMarkdownH1(content: string, heading: string): string {
  const next = heading.trim()
  if (!next) return content
  const hasFm = content.startsWith('---\n') || content.startsWith('---\r\n')
  const fmEnd = hasFm ? content.indexOf('\n---', 3) : -1
  if (hasFm && fmEnd !== -1) {
    const prefix = content.slice(0, fmEnd + 4)
    const body = content.slice(fmEnd + 4)
    return prefix + body.replace(/^#(?!#)\s+.*$/m, `# ${next}`)
  }
  return content.replace(/^#(?!#)\s+.*$/m, `# ${next}`)
}

export function sanitizeNoteFileStem(title: string): string {
  let stem = title.normalize('NFKC')
  stem = [...stem].filter((ch) => ch.charCodeAt(0) >= 32).join('')
  stem = stem.replace(/[<>:"/\\|?*]/g, ' ')
  stem = stem.replace(/\s+/g, ' ').trim()
  stem = stem.replace(/^\.+/, '').replace(/\.+$/, '').trim()
  if (stem.length > 120) stem = stem.slice(0, 120).trim()
  return stem
}

export function fileNameFromHeading(heading: string, previousName: string): string | null {
  const stem = sanitizeNoteFileStem(heading)
  if (!stem) return null
  return ensureMarkdownFileName(stem, previousName)
}
