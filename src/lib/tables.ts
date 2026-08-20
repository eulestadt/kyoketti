export type TableAlign = 'left' | 'center' | 'right' | 'none'

export type MarkdownTable = {
  headers: string[]
  aligns: TableAlign[]
  rows: string[][]
}

/** Split a table row on `|`, respecting `\|` escapes. Outer pipes optional. */
export function splitTableRow(line: string): string[] {
  let text = line.trim()
  if (text.startsWith('|')) text = text.slice(1)
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1)

  const cells: string[] = []
  let buf = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\\' && text[i + 1] === '|') {
      buf += '\\|'
      i += 1
      continue
    }
    if (ch === '|') {
      cells.push(buf.trim())
      buf = ''
      continue
    }
    buf += ch
  }
  cells.push(buf.trim())
  return cells
}

export function parseAlignCell(cell: string): TableAlign | null {
  const t = cell.replace(/\s/g, '')
  if (!/^:?-{2,}:?$/.test(t)) return null
  const left = t.startsWith(':')
  const right = t.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  if (left) return 'left'
  return 'none'
}

export function isSeparatorRow(line: string): boolean {
  const cells = splitTableRow(line)
  if (cells.length === 0) return false
  return cells.every((c) => parseAlignCell(c) !== null)
}

export function parseMarkdownTable(lines: string[]): MarkdownTable | null {
  if (lines.length < 2) return null
  if (!isSeparatorRow(lines[1])) return null
  const headers = splitTableRow(lines[0])
  if (headers.length === 0) return null
  const sep = splitTableRow(lines[1])
  const aligns: TableAlign[] = headers.map((_, i) => parseAlignCell(sep[i] ?? '---') ?? 'none')
  const rows = lines.slice(2).map((line) => {
    const cells = splitTableRow(line)
    while (cells.length < headers.length) cells.push('')
    return cells.slice(0, headers.length)
  })
  return { headers, aligns, rows }
}

/** Escape `|` inside a table cell for Obsidian-compatible markdown. */
export function escapeTableCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function alignSep(align: TableAlign): string {
  if (align === 'left') return ':---'
  if (align === 'right') return '---:'
  if (align === 'center') return ':---:'
  return '---'
}

export function serializeMarkdownTable(table: MarkdownTable): string {
  const cols = Math.max(
    table.headers.length,
    ...table.rows.map((r) => r.length),
    table.aligns.length,
    1,
  )
  const headers = Array.from({ length: cols }, (_, i) => escapeTableCell(table.headers[i] ?? ''))
  const aligns = Array.from({ length: cols }, (_, i) => alignSep(table.aligns[i] ?? 'none'))
  const rows = table.rows.map((row) =>
    Array.from({ length: cols }, (_, i) => escapeTableCell(row[i] ?? '')),
  )
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${aligns.join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ]
  return lines.join('\n')
}

export function createEmptyMarkdownTable(cols = 2, bodyRows = 1): string {
  const headers = Array.from({ length: cols }, () => '')
  const aligns = Array.from({ length: cols }, () => 'none' as TableAlign)
  const rows = Array.from({ length: bodyRows }, () => Array.from({ length: cols }, () => ''))
  return serializeMarkdownTable({ headers, aligns, rows })
}

/**
 * Replace Obsidian/GFM pipe tables in markdown with HTML <table>s.
 * Cell contents are left as markdown so later inline transforms can run.
 */
export function convertMarkdownTablesToHtml(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    // Look ahead for a header + separator pair
    if (i + 1 < lines.length && lines[i].includes('|') && isSeparatorRow(lines[i + 1])) {
      const start = i
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        // Stop if this looks like a new block that isn't a table row
        if (/^#{1,6}\s/.test(lines[i]) || /^```/.test(lines[i])) break
        i += 1
      }
      const block = lines.slice(start, i)
      const table = parseMarkdownTable(block)
      if (table) {
        out.push(markdownTableToHtml(table))
        // Preserve trailing blank line separation
        continue
      }
      // Fallback: emit lines as-is
      out.push(...block)
      continue
    }
    out.push(lines[i])
    i += 1
  }

  return out.join('\n')
}

function alignAttr(align: TableAlign): string {
  if (align === 'none') return ''
  return ` style="text-align:${align}" data-align="${align}"`
}

export function markdownTableToHtml(table: MarkdownTable): string {
  const cols = table.headers.length
  const thead = `<thead><tr>${table.headers
    .map((h, i) => `<th${alignAttr(table.aligns[i] ?? 'none')}>${h}</th>`)
    .join('')}</tr></thead>`
  const bodyRows =
    table.rows.length === 0
      ? [`<tr>${Array.from({ length: cols }, () => '<td></td>').join('')}</tr>`]
      : table.rows.map(
          (row) =>
            `<tr>${Array.from({ length: cols }, (_, i) => {
              const align = table.aligns[i] ?? 'none'
              return `<td${alignAttr(align)}>${row[i] ?? ''}</td>`
            }).join('')}</tr>`,
        )
  return `<table class="cm-table">\n${thead}\n<tbody>\n${bodyRows.join('\n')}\n</tbody>\n</table>`
}

export function alignFromElement(el: Element): TableAlign {
  const data = el.getAttribute('data-align')
  if (data === 'left' || data === 'center' || data === 'right') return data
  const style = (el as HTMLElement).style?.textAlign
  if (style === 'left' || style === 'center' || style === 'right') return style
  return 'none'
}

export function htmlTableToMarkdown(table: HTMLTableElement): string {
  const aligns: TableAlign[] = []
  const headers: string[] = []
  const headerCells = table.querySelectorAll('thead th, thead td')
  if (headerCells.length) {
    headerCells.forEach((cell, i) => {
      headers.push(cellToMarkdown(cell))
      aligns[i] = alignFromElement(cell)
    })
  } else {
    const first = table.querySelector('tr')
    first?.querySelectorAll('th, td').forEach((cell, i) => {
      headers.push(cellToMarkdown(cell))
      aligns[i] = alignFromElement(cell)
    })
  }

  const rows: string[][] = []
  const bodyRows = table.querySelectorAll('tbody tr')
  const rowNodes = bodyRows.length ? bodyRows : table.querySelectorAll('tr')
  rowNodes.forEach((tr, index) => {
    if (!bodyRows.length && index === 0 && tr.querySelector('th')) return
    const cells: string[] = []
    tr.querySelectorAll('th, td').forEach((cell) => cells.push(cellToMarkdown(cell)))
    if (cells.length) rows.push(cells)
  })

  if (!headers.length && rows.length) {
    const width = Math.max(...rows.map((r) => r.length))
    return serializeMarkdownTable({
      headers: Array.from({ length: width }, () => ''),
      aligns: Array.from({ length: width }, () => 'none' as TableAlign),
      rows,
    })
  }

  return serializeMarkdownTable({ headers, aligns, rows })
}

function cellToMarkdown(cell: Element): string {
  return inlineHtmlToMd(cell).replace(/\u00a0/g, ' ').replace(/\n+/g, ' ').trim()
}

function inlineHtmlToMd(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (!(node instanceof HTMLElement)) {
    return [...node.childNodes].map(inlineHtmlToMd).join('')
  }
  const tag = node.tagName.toLowerCase()
  if (tag === 'br') return ' '
  const inner = [...node.childNodes].map(inlineHtmlToMd).join('')
  if (tag === 'strong' || tag === 'b') return `**${inner}**`
  if (tag === 'em' || tag === 'i') return `*${inner}*`
  if (tag === 'del' || tag === 's' || tag === 'strike') return `~~${inner}~~`
  if (tag === 'code') return `\`${inner}\``
  if (tag === 'a' && node.classList.contains('internal-link')) {
    const note = (node.getAttribute('data-note') ?? inner).trim()
    const display = inner.trim()
    if (display && display !== note) return `[[${escapeTableCell(note)}|${escapeTableCell(display)}]]`
    return `[[${escapeTableCell(note)}]]`
  }
  if (tag === 'a') {
    const href = node.getAttribute('href') ?? ''
    return href ? `[${inner}](${href})` : inner
  }
  if (tag === 'img') {
    const alt = node.getAttribute('alt') ?? ''
    const src = node.getAttribute('src') ?? ''
    return `![${alt}](${src})`
  }
  return inner
}

/* ─── DOM editing helpers (WYSIWYG) ─── */

export function createEmptyTableElement(cols = 2, bodyRows = 1): HTMLTableElement {
  const table = document.createElement('table')
  table.className = 'cm-table'
  const thead = document.createElement('thead')
  const headRow = document.createElement('tr')
  for (let c = 0; c < cols; c++) {
    const th = document.createElement('th')
    th.innerHTML = '<br>'
    headRow.appendChild(th)
  }
  thead.appendChild(headRow)
  table.appendChild(thead)
  const tbody = document.createElement('tbody')
  for (let r = 0; r < bodyRows; r++) {
    const tr = document.createElement('tr')
    for (let c = 0; c < cols; c++) {
      const td = document.createElement('td')
      td.innerHTML = '<br>'
      tr.appendChild(td)
    }
    tbody.appendChild(tr)
  }
  table.appendChild(tbody)
  return table
}

function columnCount(table: HTMLTableElement): number {
  const row = table.querySelector('tr')
  return row ? row.querySelectorAll('th, td').length : 0
}

function allRows(table: HTMLTableElement): HTMLTableRowElement[] {
  return [...table.querySelectorAll('tr')] as HTMLTableRowElement[]
}

export function insertTableRow(table: HTMLTableElement, index: number): HTMLTableRowElement {
  const cols = columnCount(table)
  const tr = document.createElement('tr')
  for (let c = 0; c < cols; c++) {
    const align = alignFromElement(table.querySelector(`tr th:nth-child(${c + 1}), tr td:nth-child(${c + 1})`) ?? document.createElement('td'))
    const td = document.createElement('td')
    if (align !== 'none') {
      td.style.textAlign = align
      td.setAttribute('data-align', align)
    }
    td.innerHTML = '<br>'
    tr.appendChild(td)
  }
  const tbody = table.tBodies[0] ?? table
  const bodyRows = [...(table.tBodies[0]?.rows ?? [])]
  if (index >= bodyRows.length) tbody.appendChild(tr)
  else tbody.insertBefore(tr, bodyRows[index])
  return tr
}

export function deleteTableRow(table: HTMLTableElement, bodyIndex: number): void {
  const body = table.tBodies[0]
  if (!body || body.rows.length <= 1) return
  body.rows[bodyIndex]?.remove()
}

export function insertTableColumn(table: HTMLTableElement, index: number): void {
  for (const tr of allRows(table)) {
    const isHead = Boolean(tr.closest('thead')) || tr.querySelector('th')
    const cell = document.createElement(isHead && tr.closest('thead') ? 'th' : 'td')
    cell.innerHTML = '<br>'
    const cells = [...tr.children]
    if (index >= cells.length) tr.appendChild(cell)
    else tr.insertBefore(cell, cells[index])
  }
}

export function deleteTableColumn(table: HTMLTableElement, index: number): void {
  if (columnCount(table) <= 1) return
  for (const tr of allRows(table)) {
    tr.children[index]?.remove()
  }
}

export function moveTableRow(table: HTMLTableElement, from: number, to: number): void {
  const body = table.tBodies[0]
  if (!body) return
  const row = body.rows[from]
  if (!row) return
  const target = body.rows[to]
  if (!target) {
    body.appendChild(row)
    return
  }
  if (from < to) body.insertBefore(row, target.nextSibling)
  else body.insertBefore(row, target)
}

export function moveTableColumn(table: HTMLTableElement, from: number, to: number): void {
  if (from === to) return
  for (const tr of allRows(table)) {
    const cells = [...tr.children]
    const cell = cells[from]
    if (!cell) continue
    const target = cells[to]
    if (!target) {
      tr.appendChild(cell)
      continue
    }
    if (from < to) tr.insertBefore(cell, target.nextSibling)
    else tr.insertBefore(cell, target)
  }
}

export function setColumnAlign(table: HTMLTableElement, index: number, align: TableAlign): void {
  for (const tr of allRows(table)) {
    const cell = tr.children[index] as HTMLElement | undefined
    if (!cell) continue
    if (align === 'none') {
      cell.style.textAlign = ''
      cell.removeAttribute('data-align')
    } else {
      cell.style.textAlign = align
      cell.setAttribute('data-align', align)
    }
  }
}

export function sortTableByColumn(table: HTMLTableElement, index: number, ascending: boolean): void {
  const body = table.tBodies[0]
  if (!body) return
  const rows = [...body.rows]
  rows.sort((a, b) => {
    const av = (a.children[index]?.textContent ?? '').trim()
    const bv = (b.children[index]?.textContent ?? '').trim()
    const an = Number(av)
    const bn = Number(bv)
    let cmp: number
    if (!Number.isNaN(an) && !Number.isNaN(bn) && av !== '' && bv !== '') cmp = an - bn
    else cmp = av.localeCompare(bv, undefined, { sensitivity: 'base', numeric: true })
    return ascending ? cmp : -cmp
  })
  for (const row of rows) body.appendChild(row)
}

export function duplicateTableRow(table: HTMLTableElement, bodyIndex: number): void {
  const body = table.tBodies[0]
  const row = body?.rows[bodyIndex]
  if (!row || !body) return
  const clone = row.cloneNode(true) as HTMLTableRowElement
  body.insertBefore(clone, row.nextSibling)
}

export function duplicateTableColumn(table: HTMLTableElement, index: number): void {
  for (const tr of allRows(table)) {
    const cell = tr.children[index]
    if (!cell) continue
    const clone = cell.cloneNode(true)
    tr.insertBefore(clone, cell.nextSibling)
  }
}

export function getCellPosition(cell: HTMLElement): { table: HTMLTableElement; row: number; col: number; isHeader: boolean } | null {
  const table = cell.closest('table') as HTMLTableElement | null
  const tr = cell.closest('tr')
  if (!table || !tr) return null
  const col = [...tr.children].indexOf(cell)
  const isHeader = Boolean(cell.closest('thead')) || cell.tagName === 'TH'
  if (isHeader) {
    return { table, row: -1, col, isHeader: true }
  }
  const body = table.tBodies[0]
  const row = body ? [...body.rows].indexOf(tr as HTMLTableRowElement) : -1
  return { table, row, col, isHeader: false }
}

export function focusTableCell(table: HTMLTableElement, row: number, col: number): void {
  let cell: HTMLElement | null = null
  if (row < 0) {
    cell = table.querySelector(`thead tr th:nth-child(${col + 1}), thead tr td:nth-child(${col + 1})`)
  } else {
    cell = table.tBodies[0]?.rows[row]?.children[col] as HTMLElement | undefined ?? null
  }
  if (!cell) return
  const selection = window.getSelection()
  if (!selection) return
  const range = document.createRange()
  range.selectNodeContents(cell)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
  cell.focus?.()
}
