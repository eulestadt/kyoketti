const PIN_KEY = 'kyoketti.commands.pinned'
const RECENT_KEY = 'kyoketti.commands.recent'

function readList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function writeList(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids))
  } catch {
    /* ignore */
  }
}

export function loadPinnedCommands(): string[] {
  return readList(PIN_KEY)
}

export function savePinnedCommands(ids: string[]) {
  writeList(PIN_KEY, ids)
}

export function togglePinnedCommand(id: string): string[] {
  const current = loadPinnedCommands()
  const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
  savePinnedCommands(next)
  return next
}

export function loadRecentCommands(): string[] {
  return readList(RECENT_KEY)
}

export function pushRecentCommand(id: string): string[] {
  const next = [id, ...loadRecentCommands().filter((x) => x !== id)].slice(0, 20)
  writeList(RECENT_KEY, next)
  return next
}

export function formatHotkey(hotkey: string): string {
  const mac = /Mac|iPhone|iPad/i.test(navigator.platform) || navigator.userAgent.includes('Mac')
  const parts = hotkey.split('+')
  return parts
    .map((part) => {
      if (part === 'Mod') return mac ? '⌘' : 'Ctrl'
      if (part === 'Shift') return mac ? '⇧' : 'Shift'
      if (part === 'Alt') return mac ? '⌥' : 'Alt'
      if (part === 'ArrowLeft') return '←'
      if (part === 'ArrowRight') return '→'
      if (part === 'ArrowUp') return '↑'
      if (part === 'ArrowDown') return '↓'
      return part
    })
    .join(mac ? '' : '+')
}

export function isTypingField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return Boolean(target.closest('input, textarea, select'))
}

const TYPING_ALLOWED = new Set([
  'Mod+P',
  'Mod+O',
  'Mod+S',
  'Mod+N',
  'Mod+W',
  'Mod+,',
  'Mod+Shift+P',
  'Mod+Shift+F',
  'Mod+Shift+E',
  'Mod+Shift+T',
])

export function hotkeyAllowedWhileTyping(hotkey: string): boolean {
  return TYPING_ALLOWED.has(hotkey)
}

export function hotkeyEventMatch(e: KeyboardEvent, hotkey: string): boolean {
  const parts = hotkey.split('+')
  const key = parts[parts.length - 1]
  if (!key) return false
  const wantMod = parts.includes('Mod')
  const wantShift = parts.includes('Shift')
  const wantAlt = parts.includes('Alt')
  const hasMod = e.metaKey || e.ctrlKey
  if (wantMod !== hasMod) return false
  if (wantShift !== e.shiftKey) return false
  if (wantAlt !== e.altKey) return false
  if (key.startsWith('Arrow')) return e.key === key
  if (key === 'Escape' || key === 'F2') return e.key === key
  if (key.length === 1) return e.key.toLowerCase() === key.toLowerCase()
  return e.key === key
}