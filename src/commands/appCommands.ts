import type { CommandDef } from '../lib/commands'
import {
  dispatchEditor,
  formatEditor,
  insertSnippet,
  MD_CALLOUT,
  MD_CODEBLOCK,
  MD_TABLE,
  openEditorSearch,
} from '../lib/editorBridge'
import { copyPath, copyText, copyWikilink } from '../lib/clipboard'
import { promptFileRename } from '../components/ui/noteMenu'
import { extractAliases } from '../lib/vaultIndex'
import { setFrontmatterProperty, parseYamlFrontmatter, writeYamlFrontmatter } from '../lib/bases/frontmatter'
import {
  findNoteByFileName,
  formatDailyNoteName,
  parseDailyNoteName,
  seedDailyNote,
  shiftDate,
} from '../lib/dailyNotes'
import { isBookmarked, toggleBookmark } from '../lib/bookmarks'
import type { NoteMeta, OpenTab, VaultConfig, ViewMode } from '../types'
import type { VaultIndex } from '../lib/vaultIndex'

export type CommandHost = {
  vault: VaultConfig | null
  index: VaultIndex
  tabs: OpenTab[]
  activeFileId: string | null
  editorContent: string
  viewMode: ViewMode
  leftPanel: 'files' | 'search' | 'graph' | 'canvas'
  rightPanel: 'backlinks' | 'outgoing' | 'outline' | 'tags' | null
  localGraph: boolean
  theme: 'light' | 'dark'
  leftCollapsed: boolean
  ribbonHidden: boolean
  pureMode: boolean
  openFile: (id: string) => Promise<void>
  closeTab: (id: string) => void
  closeOtherTabs: (id: string) => void
  closeAllTabs: () => void
  closeTabsToTheRight: (id: string) => void
  goBack: () => void
  goForward: () => void
  undoCloseTab: () => void
  createNote: (parentId: string, name: string, options?: { content?: string }) => Promise<unknown>
  createBase: (parentId: string, name: string) => Promise<unknown>
  createCanvas: (parentId: string, name: string) => Promise<unknown>
  createDirectory: (parentId: string, name: string) => Promise<void>
  renameNode: (id: string, name: string) => Promise<void>
  deleteNode: (id: string) => Promise<void>
  duplicateFile: (id: string) => Promise<void>
  saveActiveFile: () => Promise<void>
  syncFilenameFromHeading: (fileId?: string, options?: { force?: boolean }) => Promise<void>
  writeFileContent: (id: string, content: string) => Promise<void>
  setEditorContent: (content: string) => void
  setViewMode: (mode: ViewMode) => void
  setLeftPanel: (panel: 'files' | 'search' | 'graph' | 'canvas') => void
  setRightPanel: (panel: 'backlinks' | 'outgoing' | 'outline' | 'tags' | null) => void
  setSearchQuery: (query: string) => void
  setLocalGraph: (value: boolean) => void
  revealInNavigation: (id: string) => void
  expandAllFolders: () => void
  collapseAllFolders: () => void
  refreshVault: () => Promise<void>
  syncPending?: () => Promise<void>
  pendingCount?: number
  clearVault: () => void
  setTheme: (theme: 'light' | 'dark') => void
  toggleTheme: () => void
  setLeftCollapsed: (value: boolean | ((prev: boolean) => boolean)) => void
  setRibbonHidden: (value: boolean | ((prev: boolean) => boolean)) => void
  togglePureMode: (next?: boolean) => void
  openSwitcher: () => void
  openSettings: () => void
  openTemplatePicker: () => void
  openBookmarks: () => void
  printReading: () => void
}

function activeNote(host: CommandHost): NoteMeta | undefined {
  if (!host.activeFileId) return undefined
  return host.index.notesById.get(host.activeFileId)
}

function activeTab(host: CommandHost): OpenTab | undefined {
  return host.tabs.find((t) => t.id === host.activeFileId)
}

function insertOrAppend(host: CommandHost, text: string) {
  if (host.viewMode === 'reading') host.setViewMode('source')
  if (!insertSnippet(text)) {
    const cur = host.editorContent
    host.setEditorContent(cur && !cur.endsWith('\n') ? `${cur}\n${text}` : `${cur}${text}`)
  }
}

function wrapOrAppend(host: CommandHost, before: string, after: string) {
  if (host.viewMode === 'reading') host.setViewMode('source')
  if (!dispatchEditor({ type: 'wrap', before, after })) insertOrAppend(host, `${before}${after}`)
}

function formatOrSwitch(host: CommandHost, kind: Parameters<typeof formatEditor>[0]) {
  if (host.viewMode === 'reading') host.setViewMode('source')
  if (!formatEditor(kind)) {
    if (kind === 'table') insertOrAppend(host, MD_TABLE)
  }
}

async function openDaily(host: CommandHost, date: Date) {
  if (!host.vault) return
  const name = formatDailyNoteName(date)
  const existing = findNoteByFileName(host.index.notesById.values(), name)
  if (existing) {
    await host.openFile(existing.id)
    return
  }
  await host.createNote(host.vault.folderId, name, { content: seedDailyNote(name) })
}

export function buildAppCommands(host: CommandHost): CommandDef[] {
  const file = activeNote(host)
  const tab = activeTab(host)
  const parentId = host.vault?.folderId

  return [
    { id: 'command-palette:open', name: 'Open command palette', hotkey: 'Mod+P', bind: false, run: () => undefined },
    { id: 'switcher:open', name: 'Quick switcher: Open quick switcher', hotkey: 'Mod+O', keywords: 'go to file', run: host.openSwitcher },
    { id: 'app:open-settings', name: 'Open settings', hotkey: 'Mod+,', run: host.openSettings },
    { id: 'file-explorer:new-file', name: 'Create new note', hotkey: 'Mod+N', run: () => { if (parentId) void host.createNote(parentId, 'Untitled') } },
    { id: 'file-explorer:new-folder', name: 'Create new folder', run: () => {
      if (!parentId) return
      const name = window.prompt('New folder name', 'New folder')
      if (name?.trim()) void host.createDirectory(parentId, name.trim())
    } },
    { id: 'bases:new-file', name: 'Bases: Create new base', run: () => { if (parentId) void host.createBase(parentId, 'Untitled') } },
    { id: 'canvas:new-file', name: 'Canvas: Create new canvas', run: () => { if (parentId) void host.createCanvas(parentId, 'Untitled') } },
    { id: 'canvas:open-view', name: 'Canvas: Show canvases', keywords: 'board visual', run: () => {
      host.setLeftCollapsed(false)
      host.setLeftPanel('canvas')
    } },
    { id: 'workspace:new-tab', name: 'New tab', run: () => { if (parentId) void host.createNote(parentId, 'Untitled') } },
    { id: 'editor:save-file', name: 'Save current file', hotkey: 'Mod+S', run: () => void host.saveActiveFile() },
    { id: 'app:reload', name: 'Reload vault', keywords: 'refresh', run: () => void host.refreshVault() },
    {
      id: 'app:sync-pending',
      name: host.pendingCount ? `Sync pending changes (${host.pendingCount})` : 'Sync pending changes',
      keywords: 'offline queue upload',
      run: () => void host.syncPending?.(),
    },

    { id: 'workspace:close', name: 'Close current tab', hotkey: 'Mod+W', run: () => { if (host.activeFileId) host.closeTab(host.activeFileId) } },
    { id: 'workspace:close-others', name: 'Close all other tabs', run: () => { if (host.activeFileId) host.closeOtherTabs(host.activeFileId) } },
    { id: 'workspace:close-all', name: 'Close all tabs', run: host.closeAllTabs },
    { id: 'workspace:close-tabs-to-the-right', name: 'Close tabs to the right', run: () => { if (host.activeFileId) host.closeTabsToTheRight(host.activeFileId) } },
    { id: 'workspace:undo-close-pane', name: 'Undo close tab', hotkey: 'Mod+Shift+T', run: host.undoCloseTab },
    { id: 'workspace:next-tab', name: 'Go to next tab', hotkey: 'Mod+PageDown', keywords: 'ctrl tab next', run: () => cycleTab(host, 1) },
    { id: 'workspace:previous-tab', name: 'Go to previous tab', hotkey: 'Mod+PageUp', keywords: 'ctrl tab previous', run: () => cycleTab(host, -1) },
    { id: 'workspace:goto-last-tab', name: 'Go to last tab', hotkey: 'Mod+9', run: () => {
      const last = host.tabs[host.tabs.length - 1]
      if (last) void host.openFile(last.id)
    } },
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
      id: `workspace:goto-tab-${n}`,
      name: `Go to tab #${n}`,
      hotkey: `Mod+${n}`,
      run: () => {
        const t = host.tabs[n - 1]
        if (t) void host.openFile(t.id)
      },
    })),
    { id: 'app:go-back', name: 'Navigate back', hotkey: 'Alt+ArrowLeft', run: host.goBack },
    { id: 'app:go-forward', name: 'Navigate forward', hotkey: 'Alt+ArrowRight', run: host.goForward },

    { id: 'workspace:edit-file-title', name: 'Rename file', hotkey: 'F2', run: () => {
      if (!tab) return
      const next = promptFileRename(tab.name)
      if (next) void host.renameNode(tab.id, next)
    } },
    { id: 'file:sync-filename-from-heading', name: 'File: Sync filename from heading', keywords: 'rename title h1', run: () => {
      void host.syncFilenameFromHeading(host.activeFileId ?? undefined, { force: true })
    } },
    { id: 'app:delete-file', name: 'Delete current file', run: () => {
      if (!tab) return
      if (!window.confirm(`Move “${tab.name}” to trash?`)) return
      void host.deleteNode(tab.id)
    } },
    { id: 'file-explorer:duplicate-file', name: 'Make a copy of the current file', run: () => {
      if (host.activeFileId) void host.duplicateFile(host.activeFileId)
    } },
    { id: 'workspace:copy-path', name: 'Copy file path', run: () => {
      if (tab) void copyPath(tab.path || tab.name)
    } },
    { id: 'workspace:copy-wikilink', name: 'Copy wikilink', run: () => {
      if (tab) void copyWikilink(tab.name, tab.path, host.index)
    } },
    { id: 'file-explorer:reveal-active-file', name: 'Files: Reveal current file in navigation', run: () => {
      if (host.activeFileId) host.revealInNavigation(host.activeFileId)
    } },
    { id: 'file-explorer:open', name: 'Files: Show file explorer', hotkey: 'Mod+Shift+E', run: () => {
      host.setLeftCollapsed(false)
      host.setLeftPanel('files')
    } },
    { id: 'file-explorer:expand-all', name: 'Files: Expand all', run: host.expandAllFolders },
    { id: 'file-explorer:collapse-all', name: 'Files: Collapse all', run: host.collapseAllFolders },
    { id: 'global-search:open', name: 'Search: Search in all files', hotkey: 'Mod+Shift+F', run: () => {
      host.setLeftCollapsed(false)
      host.setLeftPanel('search')
    } },
    { id: 'graph:open', name: 'Graph view: Open graph view', run: () => {
      host.setLocalGraph(false)
      host.setLeftPanel('graph')
    } },
    { id: 'graph:open-local', name: 'Graph view: Open local graph', run: () => {
      host.setLocalGraph(true)
      host.setLeftPanel('graph')
    } },
    { id: 'graph:toggle-local', name: 'Graph view: Toggle local graph', run: () => host.setLocalGraph(!host.localGraph) },

    { id: 'app:toggle-left-sidebar', name: 'Toggle left sidebar', run: () => host.setLeftCollapsed((v) => !v) },
    { id: 'app:toggle-right-sidebar', name: 'Toggle right sidebar', run: () => host.setRightPanel(host.rightPanel ? null : 'backlinks') },
    { id: 'app:toggle-ribbon', name: 'Toggle ribbon', run: () => host.setRibbonHidden((v) => !v) },
    { id: 'workspace:toggle-pure', name: 'Toggle pure editor mode', hotkey: 'Mod+Shift+P', run: () => host.togglePureMode() },
    { id: 'backlink:open', name: 'Backlinks: Show backlinks', run: () => host.setRightPanel('backlinks') },
    { id: 'outgoing-links:open', name: 'Outgoing links: Show outgoing links', run: () => host.setRightPanel('outgoing') },
    { id: 'outline:open', name: 'Outline: Show outline', run: () => host.setRightPanel('outline') },
    { id: 'tag-pane:open', name: 'Tags view: Show tags', run: () => host.setRightPanel('tags') },

    { id: 'editor:toggle-source', name: 'Toggle Live Preview/Source mode', run: () => {
      host.setViewMode(host.viewMode === 'source' ? 'live' : 'source')
    } },
    { id: 'markdown:toggle-preview', name: 'Toggle reading view', hotkey: 'Mod+E', run: () => {
      host.setViewMode(host.viewMode === 'reading' ? 'wysiwyg' : 'reading')
    } },
    { id: 'view:source', name: 'Switch to source mode', run: () => host.setViewMode('source') },
    { id: 'view:live', name: 'Switch to live preview', run: () => host.setViewMode('live') },
    { id: 'view:wysiwyg', name: 'Switch to WYSIWYG', run: () => host.setViewMode('wysiwyg') },
    { id: 'view:reading', name: 'Switch to reading view', run: () => host.setViewMode('reading') },
    { id: 'editor:focus', name: 'Focus on last note', run: () => { dispatchEditor({ type: 'focus' }) } },
    { id: 'editor:open-search', name: 'Search current file', hotkey: 'Mod+F', run: () => { openEditorSearch() } },

    { id: 'editor:toggle-bold', name: 'Toggle bold', hotkey: 'Mod+B', run: () => formatOrSwitch(host, 'bold') },
    { id: 'editor:toggle-italics', name: 'Toggle italic', hotkey: 'Mod+I', run: () => formatOrSwitch(host, 'italic') },
    { id: 'editor:toggle-strikethrough', name: 'Toggle strikethrough', run: () => formatOrSwitch(host, 'strike') },
    { id: 'editor:toggle-code', name: 'Toggle code', run: () => formatOrSwitch(host, 'code') },
    { id: 'editor:toggle-highlight', name: 'Toggle highlight', run: () => formatOrSwitch(host, 'highlight') },
    { id: 'editor:toggle-comments', name: 'Toggle comment', run: () => formatOrSwitch(host, 'comment') },
    { id: 'editor:toggle-blockquote', name: 'Toggle blockquote', run: () => formatOrSwitch(host, 'quote') },
    { id: 'editor:toggle-bullet-list', name: 'Toggle bullet list', run: () => formatOrSwitch(host, 'ul') },
    { id: 'editor:toggle-numbered-list', name: 'Toggle numbered list', run: () => formatOrSwitch(host, 'ol') },
    { id: 'editor:toggle-checklist-status', name: 'Toggle checkbox status', run: () => formatOrSwitch(host, 'checkbox') },
    { id: 'editor:set-heading-1', name: 'Set as heading 1', run: () => formatOrSwitch(host, 'h1') },
    { id: 'editor:set-heading-2', name: 'Set as heading 2', run: () => formatOrSwitch(host, 'h2') },
    { id: 'editor:set-heading-3', name: 'Set as heading 3', run: () => formatOrSwitch(host, 'h3') },
    { id: 'editor:set-heading-4', name: 'Set as heading 4', run: () => formatOrSwitch(host, 'h4') },
    { id: 'editor:set-heading-5', name: 'Set as heading 5', run: () => formatOrSwitch(host, 'h5') },
    { id: 'editor:set-heading-6', name: 'Set as heading 6', run: () => formatOrSwitch(host, 'h6') },
    { id: 'editor:set-heading-0', name: 'Remove heading', run: () => formatOrSwitch(host, 'heading-remove') },
    { id: 'editor:insert-table', name: 'Insert table', run: () => formatOrSwitch(host, 'table') },
    { id: 'editor:insert-horizontal-rule', name: 'Insert horizontal rule', run: () => insertOrAppend(host, '\n---\n') },
    { id: 'editor:insert-codeblock', name: 'Insert code block', run: () => insertOrAppend(host, MD_CODEBLOCK) },
    { id: 'editor:insert-callout', name: 'Insert callout', run: () => insertOrAppend(host, MD_CALLOUT) },
    { id: 'editor:insert-wikilink', name: 'Add internal link', run: () => wrapOrAppend(host, '[[', ']]') },
    { id: 'editor:insert-link', name: 'Insert Markdown link', run: () => wrapOrAppend(host, '[', '](url)') },
    { id: 'editor:insert-embed', name: 'Add embed', run: () => wrapOrAppend(host, '![[', ']]') },
    { id: 'editor:insert-tag', name: 'Add tag', run: () => insertOrAppend(host, '#') },
    { id: 'insert-current-date', name: 'Insert current date', run: () => insertOrAppend(host, formatDailyNoteName().replace(/\.md$/, '')) },
    { id: 'insert-current-time', name: 'Insert current time', run: () => {
      const now = new Date()
      const hh = String(now.getHours()).padStart(2, '0')
      const mm = String(now.getMinutes()).padStart(2, '0')
      insertOrAppend(host, `${hh}:${mm}`)
    } },
    { id: 'insert-template', name: 'Templates: Insert template', run: host.openTemplatePicker },

    { id: 'daily-notes', name: "Daily notes: Open today's daily note", run: () => void openDaily(host, new Date()) },
    { id: 'daily-notes:goto-next', name: 'Daily notes: Open next daily note', run: () => {
      const current = file ? parseDailyNoteName(file.name) : new Date()
      void openDaily(host, shiftDate(current ?? new Date(), 1))
    } },
    { id: 'daily-notes:goto-prev', name: 'Daily notes: Open previous daily note', run: () => {
      const current = file ? parseDailyNoteName(file.name) : new Date()
      void openDaily(host, shiftDate(current ?? new Date(), -1))
    } },

    { id: 'markdown:add-alias', name: 'Add alias', run: () => {
      if (!file) return
      const alias = window.prompt('Alias')
      if (!alias?.trim()) return
      const aliases = extractAliases(file.frontmatter)
      if (!aliases.includes(alias.trim())) aliases.push(alias.trim())
      void host.writeFileContent(file.id, setFrontmatterProperty(file.content, 'aliases', aliases))
    } },
    { id: 'markdown:add-metadata-property', name: 'Add file property', run: () => {
      if (!file) return
      const key = window.prompt('Property name')
      if (!key?.trim()) return
      const value = window.prompt('Property value', '')
      void host.writeFileContent(file.id, setFrontmatterProperty(file.content, key.trim(), value ?? ''))
    } },
    { id: 'markdown:clear-metadata-properties', name: 'Clear file properties', run: () => {
      if (!file) return
      if (!window.confirm('Clear all properties (frontmatter) on this file?')) return
      const { body } = parseYamlFrontmatter(file.content)
      void host.writeFileContent(file.id, writeYamlFrontmatter({}, body))
    } },

    { id: 'bookmarks:bookmark-current-view', name: 'Bookmarks: Bookmark…', run: () => {
      if (!tab) return
      toggleBookmark({ id: tab.id, name: tab.name, path: tab.path })
    } },
    { id: 'bookmarks:unbookmark-current-view', name: 'Bookmarks: Remove bookmark for the current file', run: () => {
      if (!tab || !isBookmarked(tab.id)) return
      toggleBookmark({ id: tab.id, name: tab.name, path: tab.path })
    } },
    { id: 'bookmarks:open', name: 'Bookmarks: Show bookmarks', run: host.openBookmarks },
    { id: 'bookmarks:bookmark-all-tabs', name: 'Bookmarks: Bookmark all tabs', run: () => {
      for (const t of host.tabs) {
        if (!isBookmarked(t.id)) toggleBookmark({ id: t.id, name: t.name, path: t.path })
      }
    } },

    { id: 'theme:toggle-light-dark', name: 'Toggle light/dark mode', run: host.toggleTheme },
    { id: 'theme:use-dark', name: 'Use dark mode', run: () => host.setTheme('dark') },
    { id: 'theme:use-light', name: 'Use light mode', run: () => host.setTheme('light') },
    { id: 'workspace:export-pdf', name: 'Export to PDF…', keywords: 'print', run: host.printReading },
    { id: 'app:open-vault', name: 'Open another vault', keywords: 'change vault folder', run: host.clearVault },
    { id: 'window:zoom-in', name: 'Zoom in', run: () => applyZoom('in') },
    { id: 'window:zoom-out', name: 'Zoom out', run: () => applyZoom('out') },
    { id: 'window:reset-zoom', name: 'Reset zoom', run: () => applyZoom('reset') },
    { id: 'app:show-debug-info', name: 'Show debug info', run: () => {
      const info = [
        `Vault: ${host.vault?.folderName ?? 'none'}`,
        `Open file: ${tab?.path ?? 'none'}`,
        `Tabs: ${host.tabs.length}`,
        `Notes indexed: ${host.index.notesById.size}`,
        `View: ${host.viewMode}`,
        `Theme: ${host.theme}`,
      ].join('\n')
      void copyText(info)
      window.alert(info)
    } },
  ]
}

function applyZoom(op: 'in' | 'out' | 'reset') {
  const root = document.documentElement
  const current = Number(root.dataset.appZoom || '1')
  let next = current
  if (op === 'in') next = Math.min(2, Number((current * 1.1).toFixed(2)))
  else if (op === 'out') next = Math.max(0.6, Number((current / 1.1).toFixed(2)))
  else next = 1
  root.dataset.appZoom = String(next)
  root.style.setProperty('zoom', String(next))
}

function cycleTab(host: CommandHost, dir: number) {
  if (!host.tabs.length) return
  const idx = Math.max(0, host.tabs.findIndex((t) => t.id === host.activeFileId))
  const next = host.tabs[(idx + dir + host.tabs.length) % host.tabs.length]
  if (next) void host.openFile(next.id)
}