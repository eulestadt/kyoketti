import type { BaseFileRef, BaseLink } from './types'

export type EvalScope = {
  file: BaseFileRef
  note: Record<string, unknown>
  formula: Record<string, unknown>
  thisFile?: BaseFileRef
  thisNote?: Record<string, unknown>
  /** Summary formulas: list of column values */
  values?: unknown[]
  /** list.map / filter bind `value` / `index` / `acc` */
  value?: unknown
  index?: number
  acc?: unknown
}

export type Duration = {
  __type: 'duration'
  ms: number
}

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'ident'; value: string }
  | { kind: 'op'; value: string }
  | { kind: 'punct'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'null' }
  | { kind: 'regex'; source: string; flags: string }

const OP_CHARS = new Set(['=', '!', '<', '>', '&', '|', '+', '-', '*', '/', '%'])

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < input.length) {
    const c = input[i]!
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (c === '/' && i + 1 < input.length && input[i + 1] !== '/' && input[i + 1] !== '*') {
      // regex literal /pattern/flags
      let j = i + 1
      let source = ''
      while (j < input.length && input[j] !== '/') {
        if (input[j] === '\\' && j + 1 < input.length) {
          source += input[j]! + input[j + 1]!
          j += 2
          continue
        }
        source += input[j]!
        j++
      }
      if (input[j] === '/') {
        j++
        let flags = ''
        while (j < input.length && /[gimsuy]/.test(input[j]!)) {
          flags += input[j]!
          j++
        }
        tokens.push({ kind: 'regex', source, flags })
        i = j
        continue
      }
    }
    if (c === '"' || c === "'") {
      const quote = c
      let j = i + 1
      let out = ''
      while (j < input.length && input[j] !== quote) {
        if (input[j] === '\\' && j + 1 < input.length) {
          const n = input[j + 1]!
          out += n === 'n' ? '\n' : n === 't' ? '\t' : n
          j += 2
          continue
        }
        out += input[j]!
        j++
      }
      tokens.push({ kind: 'str', value: out })
      i = j + 1
      continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(input[i + 1] ?? ''))) {
      let j = i
      while (j < input.length && /[0-9.]/.test(input[j]!)) j++
      tokens.push({ kind: 'num', value: Number(input.slice(i, j)) })
      i = j
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1
      while (j < input.length && /[A-Za-z0-9_]/.test(input[j]!)) j++
      const word = input.slice(i, j)
      if (word === 'true' || word === 'false') tokens.push({ kind: 'bool', value: word === 'true' })
      else if (word === 'null' || word === 'nil') tokens.push({ kind: 'null' })
      else tokens.push({ kind: 'ident', value: word })
      i = j
      continue
    }
    if (c === '(' || c === ')' || c === '[' || c === ']' || c === ',' || c === '.' || c === '?') {
      tokens.push({ kind: 'punct', value: c })
      i++
      continue
    }
    if (OP_CHARS.has(c)) {
      let j = i + 1
      let op = c
      const two = input.slice(i, i + 2)
      if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) {
        op = two
        j = i + 2
      }
      tokens.push({ kind: 'op', value: op })
      i = j
      continue
    }
    // skip unknown
    i++
  }
  return tokens
}

class Parser {
  private i = 0
  private tokens: Token[]
  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  peek(): Token | undefined {
    return this.tokens[this.i]
  }

  next(): Token | undefined {
    return this.tokens[this.i++]
  }

  matchOp(...ops: string[]): boolean {
    const t = this.peek()
    if (t?.kind === 'op' && ops.includes(t.value)) {
      this.next()
      return true
    }
    return false
  }

  matchPunct(...ps: string[]): boolean {
    const t = this.peek()
    if (t?.kind === 'punct' && ps.includes(t.value)) {
      this.next()
      return true
    }
    return false
  }

  parse(): Ast {
    const expr = this.parseOr()
    return expr
  }

  parseOr(): Ast {
    let left = this.parseAnd()
    while (this.matchOp('||')) {
      left = { type: 'binary', op: '||', left, right: this.parseAnd() }
    }
    return left
  }

  parseAnd(): Ast {
    let left = this.parseEquality()
    while (this.matchOp('&&')) {
      left = { type: 'binary', op: '&&', left, right: this.parseEquality() }
    }
    return left
  }

  parseEquality(): Ast {
    let left = this.parseCompare()
    while (true) {
      if (this.matchOp('==')) left = { type: 'binary', op: '==', left, right: this.parseCompare() }
      else if (this.matchOp('!=')) left = { type: 'binary', op: '!=', left, right: this.parseCompare() }
      else break
    }
    return left
  }

  parseCompare(): Ast {
    let left = this.parseAdd()
    while (true) {
      if (this.matchOp('<')) left = { type: 'binary', op: '<', left, right: this.parseAdd() }
      else if (this.matchOp('>')) left = { type: 'binary', op: '>', left, right: this.parseAdd() }
      else if (this.matchOp('<=')) left = { type: 'binary', op: '<=', left, right: this.parseAdd() }
      else if (this.matchOp('>=')) left = { type: 'binary', op: '>=', left, right: this.parseAdd() }
      else break
    }
    return left
  }

  parseAdd(): Ast {
    let left = this.parseMul()
    while (true) {
      if (this.matchOp('+')) left = { type: 'binary', op: '+', left, right: this.parseMul() }
      else if (this.matchOp('-')) left = { type: 'binary', op: '-', left, right: this.parseMul() }
      else break
    }
    return left
  }

  parseMul(): Ast {
    let left = this.parseUnary()
    while (true) {
      if (this.matchOp('*')) left = { type: 'binary', op: '*', left, right: this.parseUnary() }
      else if (this.matchOp('/')) left = { type: 'binary', op: '/', left, right: this.parseUnary() }
      else if (this.matchOp('%')) left = { type: 'binary', op: '%', left, right: this.parseUnary() }
      else break
    }
    return left
  }

  parseUnary(): Ast {
    if (this.matchOp('!') || this.matchPunct('!')) return { type: 'unary', op: '!', arg: this.parseUnary() }
    if (this.matchOp('-')) return { type: 'unary', op: '-', arg: this.parseUnary() }
    return this.parsePostfix()
  }

  parsePostfix(): Ast {
    let expr = this.parsePrimary()
    while (true) {
      if (this.matchPunct('.')) {
        const t = this.next()
        if (t?.kind !== 'ident') throw new Error('Expected property name')
        const name = t.value
        if (this.matchPunct('(')) {
          const args = this.parseArgs()
          expr = { type: 'call', callee: expr, method: name, args }
        } else {
          expr = { type: 'member', object: expr, prop: name }
        }
        continue
      }
      if (this.matchPunct('[')) {
        const index = this.parseOr()
        if (!this.matchPunct(']')) throw new Error('Expected ]')
        expr = { type: 'index', object: expr, index }
        continue
      }
      if (this.matchPunct('(') && expr.type === 'ident') {
        const args = this.parseArgs()
        expr = { type: 'call', callee: null, method: expr.name, args }
        continue
      }
      break
    }
    return expr
  }

  parseArgs(): Ast[] {
    const args: Ast[] = []
    if (this.matchPunct(')')) return args
    do {
      args.push(this.parseOr())
    } while (this.matchPunct(','))
    if (!this.matchPunct(')')) throw new Error('Expected )')
    return args
  }

  parsePrimary(): Ast {
    const t = this.peek()
    if (!t) return { type: 'literal', value: null }
    if (t.kind === 'num') {
      this.next()
      return { type: 'literal', value: t.value }
    }
    if (t.kind === 'str') {
      this.next()
      return { type: 'literal', value: t.value }
    }
    if (t.kind === 'bool') {
      this.next()
      return { type: 'literal', value: t.value }
    }
    if (t.kind === 'null') {
      this.next()
      return { type: 'literal', value: null }
    }
    if (t.kind === 'regex') {
      this.next()
      return { type: 'regex', source: t.source, flags: t.flags }
    }
    if (t.kind === 'ident') {
      this.next()
      return { type: 'ident', name: t.value }
    }
    if (this.matchPunct('(')) {
      const inner = this.parseOr()
      if (!this.matchPunct(')')) throw new Error('Expected )')
      return inner
    }
    if (this.matchPunct('[')) {
      const items: Ast[] = []
      if (!this.matchPunct(']')) {
        do {
          items.push(this.parseOr())
        } while (this.matchPunct(','))
        if (!this.matchPunct(']')) throw new Error('Expected ]')
      }
      return { type: 'list', items }
    }
    this.next()
    return { type: 'literal', value: null }
  }
}

type Ast =
  | { type: 'literal'; value: unknown }
  | { type: 'ident'; name: string }
  | { type: 'member'; object: Ast; prop: string }
  | { type: 'index'; object: Ast; index: Ast }
  | { type: 'call'; callee: Ast | null; method: string; args: Ast[] }
  | { type: 'binary'; op: string; left: Ast; right: Ast }
  | { type: 'unary'; op: string; arg: Ast }
  | { type: 'list'; items: Ast[] }
  | { type: 'regex'; source: string; flags: string }

function isDate(v: unknown): v is Date {
  return v instanceof Date && !Number.isNaN(v.getTime())
}

function isDuration(v: unknown): v is Duration {
  return Boolean(v && typeof v === 'object' && (v as Duration).__type === 'duration')
}

function isLink(v: unknown): v is BaseLink {
  return Boolean(v && typeof v === 'object' && (v as BaseLink).__type === 'link')
}

function isFile(v: unknown): v is BaseFileRef {
  return Boolean(v && typeof v === 'object' && (v as BaseFileRef).__type === 'file')
}

function parseDurationString(raw: string): Duration | null {
  const s = raw.trim()
  const re = /(\d+(?:\.\d+)?)\s*(years?|y|months?|M|weeks?|w|days?|d|hours?|h|minutes?|m|seconds?|s)/g
  let ms = 0
  let matched = false
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    matched = true
    const n = Number(m[1])
    const u = m[2]!
    if (/^y/i.test(u)) ms += n * 365.25 * 86400000
    else if (u === 'M' || /^month/i.test(u)) ms += n * 30.4375 * 86400000
    else if (/^w/i.test(u)) ms += n * 7 * 86400000
    else if (/^d/i.test(u)) ms += n * 86400000
    else if (/^h/i.test(u)) ms += n * 3600000
    else if (u === 'm' || /^min/i.test(u)) ms += n * 60000
    else ms += n * 1000
  }
  if (!matched) return null
  return { __type: 'duration', ms }
}

function addDuration(date: Date, dur: Duration, sign = 1): Date {
  return new Date(date.getTime() + sign * dur.ms)
}

function formatDate(date: Date, fmt: string): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const map: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    YY: String(date.getFullYear()).slice(-2),
    MM: pad(date.getMonth() + 1),
    M: String(date.getMonth() + 1),
    DD: pad(date.getDate()),
    D: String(date.getDate()),
    HH: pad(date.getHours()),
    H: String(date.getHours()),
    mm: pad(date.getMinutes()),
    m: String(date.getMinutes()),
    ss: pad(date.getSeconds()),
    s: String(date.getSeconds()),
  }
  return fmt.replace(/YYYY|YY|MM|M|DD|D|HH|H|mm|m|ss|s/g, (k) => map[k] ?? k)
}

function relativeDate(date: Date): string {
  const diff = date.getTime() - Date.now()
  const abs = Math.abs(diff)
  const units: Array<[number, string]> = [
    [31536000000, 'year'],
    [2592000000, 'month'],
    [604800000, 'week'],
    [86400000, 'day'],
    [3600000, 'hour'],
    [60000, 'minute'],
  ]
  for (const [ms, label] of units) {
    if (abs >= ms) {
      const n = Math.round(abs / ms)
      const plural = n === 1 ? label : `${label}s`
      return diff < 0 ? `${n} ${plural} ago` : `in ${n} ${plural}`
    }
  }
  return 'just now'
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (isDate(a) && isDate(b)) return a.getTime() === b.getTime()
  if (isLink(a) && isLink(b)) return a.path.toLowerCase() === b.path.toLowerCase()
  if (isLink(a) && isFile(b)) return linksToFile(a, b)
  if (isFile(a) && isLink(b)) return linksToFile(b, a)
  if (isFile(a) && isFile(b)) return a.path === b.path
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  return false
}

function linksToFile(link: BaseLink, file: BaseFileRef): boolean {
  const p = link.path.replace(/^\[\[|\]\]$/g, '').toLowerCase()
  return (
    file.path.toLowerCase() === p ||
    file.name.toLowerCase() === p ||
    file.basename.toLowerCase() === p ||
    file.basename.toLowerCase() === p.replace(/\.(md|markdown|base)$/i, '')
  )
}

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (isDate(a) && isDate(b)) return a.getTime() - b.getTime()
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

function truthy(v: unknown): boolean {
  if (v == null) return false
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v)
  if (typeof v === 'string') return v.length > 0
  if (Array.isArray(v)) return v.length > 0
  return true
}

function resolveIdent(name: string, scope: EvalScope): unknown {
  if (name === 'file') return scope.file
  if (name === 'note') return scope.note
  if (name === 'formula') return scope.formula
  if (name === 'this') {
    return {
      file: scope.thisFile ?? scope.file,
      note: scope.thisNote ?? scope.note,
      ...(scope.thisNote ?? {}),
    }
  }
  if (name === 'values') return scope.values ?? []
  if (name === 'value') return scope.value
  if (name === 'index') return scope.index
  if (name === 'acc') return scope.acc
  if (name in scope.formula) return scope.formula[name]
  if (name in scope.note) return scope.note[name]
  return scope.note[name] ?? null
}

function getMember(obj: unknown, prop: string): unknown {
  if (obj == null) return null
  if (isFile(obj)) {
    if (prop in obj) return (obj as Record<string, unknown>)[prop]
    if (prop === 'file') return obj
    return null
  }
  if (isDate(obj)) {
    const map: Record<string, number> = {
      year: obj.getFullYear(),
      month: obj.getMonth() + 1,
      day: obj.getDate(),
      hour: obj.getHours(),
      minute: obj.getMinutes(),
      second: obj.getSeconds(),
      millisecond: obj.getMilliseconds(),
    }
    if (prop in map) return map[prop]
  }
  if (typeof obj === 'string' && prop === 'length') return obj.length
  if (Array.isArray(obj) && prop === 'length') return obj.length
  if (typeof obj === 'object' && prop in (obj as object)) {
    return (obj as Record<string, unknown>)[prop]
  }
  return null
}

function callMethod(receiver: unknown, method: string, args: unknown[], scope: EvalScope, argAsts?: Ast[]): unknown {
  // Global functions when receiver is null
  if (receiver == null && !method.includes('.')) {
    switch (method) {
      case 'now':
        return new Date()
      case 'today': {
        const d = new Date()
        d.setHours(0, 0, 0, 0)
        return d
      }
      case 'date': {
        const s = String(args[0] ?? '')
        const parsed = new Date(s.replace(' ', 'T'))
        return Number.isNaN(parsed.getTime()) ? null : parsed
      }
      case 'duration': {
        const d = parseDurationString(String(args[0] ?? ''))
        return d
      }
      case 'if':
        return truthy(args[0]) ? args[1] : (args.length > 2 ? args[2] : null)
      case 'list':
        return Array.isArray(args[0]) ? args[0] : args[0] == null ? [] : [args[0]]
      case 'link':
        return {
          __type: 'link',
          path: isFile(args[0]) ? args[0].path : String(args[0] ?? ''),
          display: args[1] != null ? String(args[1]) : undefined,
        } satisfies BaseLink
      case 'file': {
        if (isFile(args[0])) return args[0]
        if (isLink(args[0])) return { ...scope.file, path: args[0].path }
        return null
      }
      case 'number': {
        const v = args[0]
        if (typeof v === 'number') return v
        if (isDate(v)) return v.getTime()
        if (typeof v === 'boolean') return v ? 1 : 0
        const n = Number(v)
        return Number.isNaN(n) ? null : n
      }
      case 'max':
        return Math.max(...args.map(Number))
      case 'min':
        return Math.min(...args.map(Number))
      case 'random':
        return Math.random()
      case 'escapeHTML':
        return String(args[0] ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
      case 'html':
        return String(args[0] ?? '')
      case 'image':
        return String(args[0] ?? '')
      case 'icon':
        return String(args[0] ?? '')
      default:
        break
    }
  }

  if (isFile(receiver)) {
    switch (method) {
      case 'hasTag': {
        const tags = receiver.tags.map((t) => t.replace(/^#/, '').toLowerCase())
        return args.some((a) => {
          const want = String(a).replace(/^#/, '').toLowerCase()
          return tags.some((t) => t === want || t.startsWith(`${want}/`))
        })
      }
      case 'hasLink': {
        const target = args[0]
        const links = receiver.links.map((l) => l.toLowerCase())
        if (isFile(target)) {
          return links.some(
            (l) =>
              l === target.basename.toLowerCase() ||
              l === target.name.toLowerCase() ||
              l === target.path.toLowerCase(),
          )
        }
        if (isLink(target)) {
          const p = target.path.replace(/^\[\[|\]\]$/g, '').toLowerCase()
          return links.some((l) => l === p || l === p.replace(/\.(md|markdown)$/i, ''))
        }
        const s = String(target ?? '')
          .replace(/^\[\[|\]\]$/g, '')
          .toLowerCase()
        return links.some((l) => l === s || l === s.replace(/\.(md|markdown)$/i, ''))
      }
      case 'hasProperty':
        return String(args[0]) in receiver.properties
      case 'inFolder': {
        const folder = String(args[0] ?? '').replace(/\/$/, '')
        if (!folder) return receiver.folder === ''
        return receiver.folder === folder || receiver.folder.startsWith(`${folder}/`)
      }
      case 'asLink':
        return {
          __type: 'link',
          path: receiver.path,
          display: args[0] != null ? String(args[0]) : receiver.basename,
        } satisfies BaseLink
      default:
        break
    }
  }

  if (isDate(receiver)) {
    switch (method) {
      case 'date': {
        const d = new Date(receiver)
        d.setHours(0, 0, 0, 0)
        return d
      }
      case 'format':
        return formatDate(receiver, String(args[0] ?? 'YYYY-MM-DD'))
      case 'time':
        return formatDate(receiver, 'HH:mm:ss')
      case 'relative':
        return relativeDate(receiver)
      case 'isEmpty':
        return false
      case 'toString':
        return receiver.toISOString()
      default:
        break
    }
  }

  if (typeof receiver === 'string') {
    switch (method) {
      case 'contains':
        return receiver.includes(String(args[0] ?? ''))
      case 'containsAll':
        return args.every((a) => receiver.includes(String(a)))
      case 'containsAny':
        return args.some((a) => receiver.includes(String(a)))
      case 'startsWith':
        return receiver.startsWith(String(args[0] ?? ''))
      case 'endsWith':
        return receiver.endsWith(String(args[0] ?? ''))
      case 'isEmpty':
        return receiver.length === 0
      case 'lower':
        return receiver.toLowerCase()
      case 'upper':
        return receiver.toUpperCase()
      case 'title':
        return receiver.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      case 'trim':
        return receiver.trim()
      case 'replace': {
        const pattern = args[0]
        const replacement = String(args[1] ?? '')
        if (pattern instanceof RegExp) return receiver.replace(pattern, replacement)
        return receiver.split(String(pattern)).join(replacement)
      }
      case 'repeat':
        return receiver.repeat(Math.max(0, Number(args[0]) || 0))
      case 'reverse':
        return [...receiver].reverse().join('')
      case 'slice':
        return receiver.slice(Number(args[0] ?? 0), args[1] != null ? Number(args[1]) : undefined)
      case 'split': {
        const sep = args[0] instanceof RegExp ? args[0] : String(args[0] ?? '')
        const parts = receiver.split(sep)
        if (args[1] != null) return parts.slice(0, Number(args[1]))
        return parts
      }
      case 'toString':
        return receiver
      case 'isTruthy':
        return truthy(receiver)
      case 'isType':
        return String(args[0]) === 'string'
      default:
        break
    }
  }

  if (typeof receiver === 'number') {
    switch (method) {
      case 'abs':
        return Math.abs(receiver)
      case 'ceil':
        return Math.ceil(receiver)
      case 'floor':
        return Math.floor(receiver)
      case 'round':
        return args[0] != null
          ? Math.round(receiver * 10 ** Number(args[0])) / 10 ** Number(args[0])
          : Math.round(receiver)
      case 'toFixed':
        return receiver.toFixed(Number(args[0] ?? 0))
      case 'isEmpty':
        return false
      case 'toString':
        return String(receiver)
      case 'isTruthy':
        return truthy(receiver)
      case 'isType':
        return String(args[0]) === 'number'
      default:
        break
    }
  }

  if (typeof receiver === 'boolean') {
    switch (method) {
      case 'isEmpty':
        return false
      case 'toString':
        return String(receiver)
      case 'isTruthy':
        return receiver
      case 'isType':
        return String(args[0]) === 'boolean'
      default:
        break
    }
  }

  if (Array.isArray(receiver)) {
    switch (method) {
      case 'contains':
        return receiver.some((v) => deepEqual(v, args[0]))
      case 'containsAll':
        return args.every((a) => receiver.some((v) => deepEqual(v, a)))
      case 'containsAny':
        return args.some((a) => receiver.some((v) => deepEqual(v, a)))
      case 'isEmpty':
        return receiver.length === 0
      case 'join':
        return receiver.map((v) => (v == null ? '' : String(v))).join(String(args[0] ?? ','))
      case 'flat':
        return receiver.flat()
      case 'reverse':
        return [...receiver].reverse()
      case 'slice':
        return receiver.slice(Number(args[0] ?? 0), args[1] != null ? Number(args[1]) : undefined)
      case 'sort':
        return [...receiver].sort(compareValues)
      case 'unique': {
        const out: unknown[] = []
        for (const v of receiver) {
          if (!out.some((x) => deepEqual(x, v))) out.push(v)
        }
        return out
      }
      case 'filter': {
        // Obsidian: [1,2,3].filter(value > 2) — arg is expression AST preferred
        const exprAst = argAsts?.[0]
        if (exprAst) {
          return receiver.filter((value, index) =>
            truthy(evalAst(exprAst, { ...scope, value, index })),
          )
        }
        return receiver.filter((v) => truthy(v))
      }
      case 'map': {
        const exprAst = argAsts?.[0]
        if (exprAst) {
          return receiver.map((value, index) => evalAst(exprAst, { ...scope, value, index }))
        }
        return receiver
      }
      case 'reduce': {
        const exprAst = argAsts?.[0]
        let acc = args[1]
        if (exprAst) {
          for (let index = 0; index < receiver.length; index++) {
            acc = evalAst(exprAst, { ...scope, value: receiver[index], index, acc })
          }
          return acc
        }
        return acc
      }
      case 'mean': {
        const nums = receiver.filter((v): v is number => typeof v === 'number')
        if (!nums.length) return null
        return nums.reduce((a, b) => a + b, 0) / nums.length
      }
      case 'toString':
        return receiver.join(', ')
      case 'isTruthy':
        return truthy(receiver)
      case 'isType':
        return String(args[0]) === 'list' || String(args[0]) === 'array'
      default:
        break
    }
  }

  if (isLink(receiver)) {
    switch (method) {
      case 'asFile':
        return null
      case 'linksTo':
        return false
      case 'toString':
        return receiver.display ?? receiver.path
      default:
        break
    }
  }

  if (receiver && typeof receiver === 'object' && !isDate(receiver) && !isFile(receiver)) {
    switch (method) {
      case 'isEmpty':
        return Object.keys(receiver as object).length === 0
      case 'keys':
        return Object.keys(receiver as object)
      case 'values':
        return Object.values(receiver as object)
      case 'toString':
        return JSON.stringify(receiver)
      default:
        break
    }
  }

  if (receiver instanceof RegExp) {
    if (method === 'matches') return receiver.test(String(args[0] ?? ''))
  }

  // Any-type fallbacks
  if (method === 'isTruthy') return truthy(receiver)
  if (method === 'toString') return receiver == null ? '' : String(receiver)
  if (method === 'isType') {
    const t = String(args[0])
    if (t === 'null') return receiver == null
    if (t === 'date') return isDate(receiver)
    if (t === 'file') return isFile(receiver)
    if (t === 'link') return isLink(receiver)
    return typeof receiver === t
  }
  if (method === 'isEmpty') return receiver == null || receiver === ''

  return null
}

function evalAst(ast: Ast, scope: EvalScope): unknown {
  switch (ast.type) {
    case 'literal':
      return ast.value
    case 'regex':
      return new RegExp(ast.source, ast.flags)
    case 'ident':
      return resolveIdent(ast.name, scope)
    case 'list':
      return ast.items.map((item) => evalAst(item, scope))
    case 'member': {
      const obj = evalAst(ast.object, scope)
      return getMember(obj, ast.prop)
    }
    case 'index': {
      const obj = evalAst(ast.object, scope)
      const idx = evalAst(ast.index, scope)
      if (Array.isArray(obj) && typeof idx === 'number') return obj[idx] ?? null
      if (obj && typeof obj === 'object' && (typeof idx === 'string' || typeof idx === 'number')) {
        return (obj as Record<string, unknown>)[String(idx)] ?? null
      }
      if (typeof obj === 'string' && typeof idx === 'number') return obj[idx] ?? null
      return null
    }
    case 'call': {
      const receiver = ast.callee ? evalAst(ast.callee, scope) : null
      // Keep AST args for list.filter/map/reduce
      const evaluated = ast.args.map((a) => evalAst(a, scope))
      return callMethod(receiver, ast.method, evaluated, scope, ast.args)
    }
    case 'unary': {
      const v = evalAst(ast.arg, scope)
      if (ast.op === '!') return !truthy(v)
      if (ast.op === '-') {
        if (typeof v === 'number') return -v
        if (isDuration(v)) return { __type: 'duration', ms: -v.ms }
        return null
      }
      return null
    }
    case 'binary': {
      const left = evalAst(ast.left, scope)
      if (ast.op === '&&') return truthy(left) ? evalAst(ast.right, scope) : left
      if (ast.op === '||') return truthy(left) ? left : evalAst(ast.right, scope)
      const right = evalAst(ast.right, scope)
      switch (ast.op) {
        case '==':
          return deepEqual(left, right)
        case '!=':
          return !deepEqual(left, right)
        case '<':
          return compareValues(left, right) < 0
        case '>':
          return compareValues(left, right) > 0
        case '<=':
          return compareValues(left, right) <= 0
        case '>=':
          return compareValues(left, right) >= 0
        case '+': {
          if (isDate(left)) {
            const dur = isDuration(right) ? right : typeof right === 'string' ? parseDurationString(right) : null
            if (dur) return addDuration(left, dur, 1)
          }
          if (isDate(right) && typeof left === 'string') {
            const dur = parseDurationString(left)
            if (dur) return addDuration(right, dur, 1)
          }
          if (isDuration(left) && isDuration(right)) return { __type: 'duration', ms: left.ms + right.ms }
          if (typeof left === 'number' && typeof right === 'number') return left + right
          if (typeof left === 'string' || typeof right === 'string') return `${left ?? ''}${right ?? ''}`
          return null
        }
        case '-': {
          if (isDate(left) && isDate(right)) return left.getTime() - right.getTime()
          if (isDate(left)) {
            const dur = isDuration(right) ? right : typeof right === 'string' ? parseDurationString(right) : null
            if (dur) return addDuration(left, dur, -1)
          }
          if (isDuration(left) && isDuration(right)) return { __type: 'duration', ms: left.ms - right.ms }
          if (typeof left === 'number' && typeof right === 'number') return left - right
          return null
        }
        case '*': {
          if (isDuration(left) && typeof right === 'number') return { __type: 'duration', ms: left.ms * right }
          if (typeof left === 'number' && typeof right === 'number') return left * right
          return null
        }
        case '/':
          if (typeof left === 'number' && typeof right === 'number' && right !== 0) return left / right
          return null
        case '%':
          if (typeof left === 'number' && typeof right === 'number' && right !== 0) return left % right
          return null
        default:
          return null
      }
    }
    default:
      return null
  }
}

const astCache = new Map<string, Ast>()

export function evaluateExpression(source: string, scope: EvalScope): unknown {
  const key = source.trim()
  if (!key) return null
  try {
    let ast = astCache.get(key)
    if (!ast) {
      ast = new Parser(tokenize(key)).parse()
      astCache.set(key, ast)
    }
    return evalAst(ast, scope)
  } catch {
    return null
  }
}

export function evaluateFilter(source: string, scope: EvalScope): boolean {
  return truthy(evaluateExpression(source, scope))
}

export function formatCellValue(value: unknown): string {
  if (value == null) return ''
  if (isDate(value)) return formatDate(value, 'YYYY-MM-DD HH:mm')
  if (isLink(value)) return value.display ?? value.path
  if (isFile(value)) return value.basename
  if (isDuration(value)) return `${value.ms}ms`
  if (Array.isArray(value)) return value.map(formatCellValue).join(', ')
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

export { compareValues, truthy, isDate, isLink, isFile, formatDate }
