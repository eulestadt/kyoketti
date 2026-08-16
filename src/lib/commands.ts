export type CommandDef = {
  id: string
  name: string
  keywords?: string
  hotkey?: string
  section?: string
  /** When false, the hotkey is shown in the palette but not bound globally. */
  bind?: boolean
  run: () => void | Promise<void>
}

export function commandScore(query: string, command: CommandDef): number {
  const q = query.trim().toLowerCase()
  if (!q) return 1
  const name = command.name.toLowerCase()
  const hay = `${name} ${command.keywords ?? ''} ${command.id}`.toLowerCase()
  if (name === q) return 1000
  if (name.startsWith(q)) return 800
  if (hay.startsWith(q)) return 700
  if (name.includes(q)) return 500
  if (hay.includes(q)) return 400
  const initials = command.name
    .split(/[\s:/]+/)
    .map((part) => part[0] ?? '')
    .join('')
    .toLowerCase()
  if (initials === q) return 650
  if (initials.startsWith(q)) return 420
  if (fuzzySubsequence(q, hay)) return 120 + Math.max(0, 80 - name.length)
  return 0
}

function fuzzySubsequence(q: string, text: string): boolean {
  let qi = 0
  for (let i = 0; i < text.length && qi < q.length; i++) {
    if (text[i] === q[qi]) qi++
  }
  return qi === q.length
}

export function rankCommands(query: string, commands: CommandDef[]): CommandDef[] {
  const scored = commands
    .map((command) => ({ command, score: commandScore(query, command) }))
    .filter((row) => row.score > 0)
  const q = query.trim()
  scored.sort((a, b) => {
    if (q && a.score !== b.score) return b.score - a.score
    if (q) return a.command.name.length - b.command.name.length
    return a.command.name.localeCompare(b.command.name)
  })
  return scored.map((row) => row.command)
}