export type ParsedNote = {
  frontmatter: Record<string, unknown>
  body: string
  tags: string[]
  links: string[]
}

const WIKI_LINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g
const TAG_RE = /(^|\s)#([A-Za-z0-9_/-]+)/g
const EMBED_RE = /!\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g

export function parseFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) {
    return { frontmatter: {}, body: raw }
  }
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return { frontmatter: {}, body: raw }
  const fmBlock = raw.slice(4, end).trim()
  const body = raw.slice(end + 4).replace(/^\r?\n/, '')
  const frontmatter: Record<string, unknown> = {}

  for (const line of fmBlock.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const colon = trimmed.indexOf(':')
    if (colon === -1) continue
    const key = trimmed.slice(0, colon).trim()
    let value: unknown = trimmed.slice(colon + 1).trim()
    if (typeof value === 'string') {
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      } else if (value.startsWith('[') && value.endsWith(']')) {
        value = value
          .slice(1, -1)
          .split(',')
          .map((part) => part.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean)
      } else if (value === 'true' || value === 'false') {
        value = value === 'true'
      } else if (/^-?\d+(\.\d+)?$/.test(value)) {
        value = Number(value)
      }
    }
    frontmatter[key] = value
  }

  return { frontmatter, body }
}

export function extractWikiLinks(content: string): string[] {
  const links = new Set<string>()
  for (const match of content.matchAll(WIKI_LINK_RE)) {
    links.add(match[1].trim())
  }
  for (const match of content.matchAll(EMBED_RE)) {
    links.add(match[1].trim())
  }
  return [...links]
}

export function extractTags(content: string, frontmatter: Record<string, unknown>): string[] {
  const tags = new Set<string>()
  const fmTags = frontmatter.tags
  if (Array.isArray(fmTags)) {
    for (const tag of fmTags) tags.add(String(tag).replace(/^#/, ''))
  } else if (typeof fmTags === 'string') {
    for (const tag of fmTags.split(/[,\s]+/)) {
      if (tag) tags.add(tag.replace(/^#/, ''))
    }
  }
  for (const match of content.matchAll(TAG_RE)) {
    tags.add(match[2])
  }
  return [...tags]
}

export function parseNote(raw: string): ParsedNote {
  const { frontmatter, body } = parseFrontmatter(raw)
  return {
    frontmatter,
    body,
    tags: extractTags(raw, frontmatter),
    links: extractWikiLinks(raw),
  }
}

export function noteTitleFromName(name: string): string {
  return name.replace(/\.md$/i, '').replace(/\.markdown$/i, '')
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function renderMarkdownToHtml(
  raw: string,
  resolveNoteHref: (title: string) => string | null,
): string {
  const { body } = parseFrontmatter(raw)
  let text = body

  // Protect code fences
  const fences: string[] = []
  text = text.replace(/```[\s\S]*?```/g, (block) => {
    fences.push(block)
    return `@@FENCE${fences.length - 1}@@`
  })

  const inlines: string[] = []
  text = text.replace(/`[^`\n]+`/g, (block) => {
    inlines.push(block)
    return `@@INLINE${inlines.length - 1}@@`
  })

  text = text.replace(EMBED_RE, (_m, target: string) => {
    const title = target.trim()
    const href = resolveNoteHref(title)
    if (!href) return `<div class="cm-embed missing">Missing embed: ${escapeHtml(title)}</div>`
    return `<div class="cm-embed"><a class="internal-link" href="${href}" data-note="${escapeHtml(title)}">!${escapeHtml(title)}</a></div>`
  })

  text = text.replace(/\[\[([^\]]+)\]\]/g, (_m, inner: string) => {
    const [targetPart, alias] = inner.split('|')
    const [title] = targetPart.split('#')
    const display = (alias ?? title).trim()
    const noteTitle = title.trim()
    const href = resolveNoteHref(noteTitle)
    const cls = href ? 'internal-link' : 'internal-link is-unresolved'
    return `<a class="${cls}" href="${href ?? '#'}" data-note="${escapeHtml(noteTitle)}">${escapeHtml(display)}</a>`
  })

  text = text.replace(TAG_RE, (_m, lead: string, tag: string) => {
    return `${lead}<a class="tag" href="#tag/${encodeURIComponent(tag)}">#${escapeHtml(tag)}</a>`
  })

  text = text
    .replace(/^######\s+(.+)$/gm, '<h6>$1</h6>')
    .replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>')
    .replace(/^####\s+(.+)$/gm, '<h4>$1</h4>')
    .replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')
    .replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/^\s*\d+\.\s+(.+)$/gm, '<li class="ordered">$1</li>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" />')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/^-{3,}$/gm, '<hr />')

  text = text.replace(/(?:<li>.*?<\/li>\n?)+/gs, (block) => {
    if (block.includes('class="ordered"')) {
      return `<ol>${block.replace(/ class="ordered"/g, '')}</ol>`
    }
    return `<ul>${block}</ul>`
  })

  text = text
    .split(/\n{2,}/)
    .map((para) => {
      const trimmed = para.trim()
      if (!trimmed) return ''
      if (/^<(h[1-6]|ul|ol|li|blockquote|pre|hr|div|table)/.test(trimmed)) return trimmed
      return `<p>${trimmed.replace(/\n/g, '<br />')}</p>`
    })
    .join('\n')

  text = text.replace(/@@INLINE(\d+)@@/g, (_m, i) => {
    const code = inlines[Number(i)].slice(1, -1)
    return `<code>${escapeHtml(code)}</code>`
  })

  text = text.replace(/@@FENCE(\d+)@@/g, (_m, i) => {
    const block = fences[Number(i)]
    const match = block.match(/^```(\w*)\n?([\s\S]*?)```$/)
    const lang = match?.[1] ?? ''
    const code = match?.[2] ?? block
    return `<pre><code class="language-${escapeHtml(lang)}">${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`
  })

  return text
}

export function buildOutline(content: string): Array<{ level: number; text: string; line: number }> {
  const { body } = parseFrontmatter(content)
  const lines = body.split(/\n/)
  const outline: Array<{ level: number; text: string; line: number }> = []
  lines.forEach((line, index) => {
    const match = /^(#{1,6})\s+(.+)$/.exec(line)
    if (match) {
      outline.push({ level: match[1].length, text: match[2].trim(), line: index + 1 })
    }
  })
  return outline
}
