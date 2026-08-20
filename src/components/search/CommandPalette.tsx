import { Fragment, useEffect, useMemo, useState } from 'react'
import { Pin, PinOff } from 'lucide-react'
import { rankCommands, type CommandDef } from '../../lib/commands'
import {
  formatHotkey,
  loadPinnedCommands,
  loadRecentCommands,
  pushRecentCommand,
  togglePinnedCommand,
} from '../../lib/commandStore'
import './CommandPalette.css'

type Props = {
  open: boolean
  commands: CommandDef[]
  onClose: () => void
}

export function CommandPalette({ open, commands, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [pinned, setPinned] = useState<string[]>(() => loadPinnedCommands())
  const [recent, setRecent] = useState<string[]>(() => loadRecentCommands())

  const byId = useMemo(() => new Map(commands.map((c) => [c.id, c])), [commands])

  const filtered = useMemo(() => {
    const ranked = rankCommands(query, commands)
    if (query.trim()) return ranked
    const pinSet = new Set(pinned)
    const pinnedCmds = pinned.map((id) => byId.get(id)).filter((c): c is CommandDef => Boolean(c))
    const recentCmds = recent
      .filter((id) => !pinSet.has(id))
      .map((id) => byId.get(id))
      .filter((c): c is CommandDef => Boolean(c))
    const rest = ranked.filter((c) => !pinSet.has(c.id) && !recent.includes(c.id))
    return [...pinnedCmds, ...recentCmds, ...rest]
  }, [query, commands, pinned, recent, byId])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      setPinned(loadPinnedCommands())
      setRecent(loadRecentCommands())
    }
  }, [open])

  useEffect(() => {
    setSelected(0)
  }, [query])

  useEffect(() => {
    if (selected >= filtered.length) setSelected(Math.max(0, filtered.length - 1))
  }, [filtered.length, selected])

  useEffect(() => {
    document.querySelector('.command-palette button.selected')?.scrollIntoView({ block: 'nearest' })
  }, [selected, filtered])

  if (!open) return null

  async function run(command: CommandDef) {
    setRecent(pushRecentCommand(command.id))
    onClose()
    await command.run()
  }

  const pinSet = new Set(pinned)

  return (
    <div className="modal-backdrop command-palette-backdrop" onClick={onClose}>
      <div
        className="command-palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setSelected((s) => Math.min(s + 1, filtered.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setSelected((s) => Math.max(s - 1, 0))
          } else if (e.key === 'Enter' && filtered[selected]) {
            e.preventDefault()
            void run(filtered[selected])
          } else if (e.key === 'Escape') {
            onClose()
          }
        }}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search commands"
          aria-label="Command palette"
        />
        <ul>
          {filtered.slice(0, 150).map((command, i) => {
            const section = sectionLabel(query, filtered, pinSet, recent, i, command)
            return (
              <Fragment key={command.id}>
                {section && (
                  <li className="command-section" aria-hidden>
                    {section}
                  </li>
                )}
                <li>
                  <button
                    type="button"
                    className={i === selected ? 'selected' : ''}
                    onMouseEnter={() => setSelected(i)}
                    onClick={() => void run(command)}
                  >
                    <span className="command-name">
                      {pinSet.has(command.id) && <Pin size={12} className="command-pin-mark" />}
                      {command.name}
                    </span>
                    <span className="command-meta">
                      {command.hotkey && <kbd>{formatHotkey(command.hotkey)}</kbd>}
                      <span
                        className="command-pin"
                        title={pinSet.has(command.id) ? 'Unpin' : 'Pin'}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setPinned(togglePinnedCommand(command.id))
                        }}
                      >
                        {pinSet.has(command.id) ? <PinOff size={13} /> : <Pin size={13} />}
                      </span>
                    </span>
                  </button>
                </li>
              </Fragment>
            )
          })}
          {filtered.length === 0 && <li className="empty">No matching commands</li>}
        </ul>
      </div>
    </div>
  )
}

function sectionLabel(
  query: string,
  filtered: CommandDef[],
  pinSet: Set<string>,
  recent: string[],
  i: number,
  command: CommandDef,
): string | null {
  if (query.trim()) return null
  const prev = filtered[i - 1]
  const isPin = pinSet.has(command.id)
  const isRecent = recent.includes(command.id) && !isPin
  const prevPin = Boolean(prev && pinSet.has(prev.id))
  const prevRecent = Boolean(prev && recent.includes(prev.id) && !pinSet.has(prev.id))
  if (isPin && !prevPin) return 'Pinned'
  if (isRecent && !prevRecent) return 'Recently used'
  if (!isPin && !isRecent && (i === 0 || prevPin || prevRecent)) return 'Commands'
  return null
}