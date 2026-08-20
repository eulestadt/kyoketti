import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

/** Parse YAML frontmatter with the full yaml package (for Bases property edits). */
export function parseYamlFrontmatter(raw: string): {
  frontmatter: Record<string, unknown>
  body: string
  hasFrontmatter: boolean
} {
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) {
    return { frontmatter: {}, body: raw, hasFrontmatter: false }
  }
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return { frontmatter: {}, body: raw, hasFrontmatter: false }
  const fmBlock = raw.slice(raw.startsWith('---\r\n') ? 5 : 4, end)
  const body = raw.slice(end + 4).replace(/^\r?\n/, '')
  try {
    const doc = parseYaml(fmBlock)
    const frontmatter =
      doc && typeof doc === 'object' && !Array.isArray(doc)
        ? (doc as Record<string, unknown>)
        : {}
    return { frontmatter, body, hasFrontmatter: true }
  } catch {
    return { frontmatter: {}, body: raw, hasFrontmatter: false }
  }
}

export function writeYamlFrontmatter(
  frontmatter: Record<string, unknown>,
  body: string,
): string {
  const keys = Object.keys(frontmatter)
  if (!keys.length) return body.replace(/^\n+/, '')
  const yaml = stringifyYaml(frontmatter, { lineWidth: 0 }).trimEnd()
  return `---\n${yaml}\n---\n${body.startsWith('\n') ? body : `\n${body}`}`
}

export function setFrontmatterProperty(
  raw: string,
  key: string,
  value: unknown,
): string {
  const { frontmatter, body } = parseYamlFrontmatter(raw)
  const next = { ...frontmatter }
  if (value === '' || value == null) delete next[key]
  else next[key] = value
  return writeYamlFrontmatter(next, body)
}
