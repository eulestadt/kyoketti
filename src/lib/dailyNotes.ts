import type { NoteMeta } from '../types'

export function formatDailyNoteName(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}.md`
}

export function parseDailyNoteName(name: string): Date | null {
  const m = displayStem(name).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

function displayStem(name: string): string {
  return name.replace(/\.(md|markdown)$/i, '')
}

export function shiftDate(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export function findNoteByFileName(notes: Iterable<NoteMeta>, fileName: string): NoteMeta | undefined {
  const want = fileName.toLowerCase()
  const wantStem = displayStem(fileName).toLowerCase()
  for (const note of notes) {
    if (note.name.toLowerCase() === want) return note
    if (displayStem(note.name).toLowerCase() === wantStem) return note
    if (note.title.toLowerCase() === wantStem) return note
  }
  return undefined
}

export function seedDailyNote(fileName: string): string {
  const title = displayStem(fileName)
  return `# ${title}\n\n`
}