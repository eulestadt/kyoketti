import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Files,
  Search,
  Network,
  Settings,
  PanelRight,
  BookOpen,
  Columns2,
  Code2,
  PenLine,
  RefreshCw,
  FolderInput,
  Moon,
  Sun,
  Maximize2,
  Minimize2,
  Terminal,
  LayoutDashboard,
} from 'lucide-react'
import { useApp } from '../hooks/useApp'
import { useTheme } from '../hooks/useTheme'
import { FileTree } from './sidebar/FileTree'
import { CanvasList } from './sidebar/CanvasList'
import { GlobalSearch } from './search/GlobalSearch'
import { GraphView } from './graph/GraphView'
import { MarkdownEditor } from './editor/MarkdownEditor'
import { TabBar } from './tabs/TabBar'
import { RightSidebar } from './panels/RightSidebar'
import { QuickSwitcher } from './search/QuickSwitcher'
import { CommandPalette } from './search/CommandPalette'
import { isBaseFileName } from '../lib/bases'
import { isCanvasFileName } from '../lib/canvas'
import { isImageFileName } from '../lib/media'
import { compactItems, ContextMenu, useContextMenu } from './ui/ContextMenu'
import { copyPath, copyWikilink } from '../lib/clipboard'
import { buildAppCommands } from '../commands/appCommands'
import {
  hotkeyAllowedWhileTyping,
  hotkeyEventMatch,
  isTypingField,
} from '../lib/commandStore'
import { insertSnippet, openEditorSearch } from '../lib/editorBridge'
import { parseYamlFrontmatter } from '../lib/bases/frontmatter'
import { loadBookmarks } from '../lib/bookmarks'
import type { OpenTab } from '../types'
import './Workspace.css'

const PURE_KEY = 'kyoketti.pureMode'
const LEFT_COLLAPSED_KEY = 'kyoketti.leftCollapsed'
const RIBBON_HIDDEN_KEY = 'kyoketti.ribbonHidden'

function loadFlag(key: string, onValue = '1'): boolean {
  try {
    return localStorage.getItem(key) === onValue
  } catch {
    return false
  }
}

function persistFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export function Workspace() {
  const {
    vault,
    tabs,
    activeFileId,
    openFile,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    closeTabsToTheRight,
    goBack,
    goForward,
    undoCloseTab,
    index,
    leftPanel,
    setLeftPanel,
    viewMode,
    setViewMode,
    rightPanel,
    setRightPanel,
    saveStatus,
    statusMessage,
    refreshVault,
    loadingVault,
    clearVault,
    disconnect,
    createNote,
    createBase,
    createCanvas,
    createDirectory,
    renameNode,
    deleteNode,
    duplicateFile,
    saveActiveFile,
    syncFilenameFromHeading,
    writeFileContent,
    setEditorContent,
    editorContent,
    setSearchQuery,
    localGraph,
    setLocalGraph,
    revealInNavigation,
    expandAllFolders,
    collapseAllFolders,
    session,
    local,
    authProvider,
    error,
    offline,
    pendingCount,
    localPermissionNeeded,
    syncPending,
    grantLocalAccess,
  } = useApp()

  const { theme, setTheme, toggleTheme } = useTheme()
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [picker, setPicker] = useState<null | 'template' | 'bookmarks'>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pureMode, setPureMode] = useState(() => loadFlag(PURE_KEY))
  const [leftCollapsed, setLeftCollapsedState] = useState(() => loadFlag(LEFT_COLLAPSED_KEY))
  const [ribbonHidden, setRibbonHiddenState] = useState(() => loadFlag(RIBBON_HIDDEN_KEY))
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(document.fullscreenElement))
  const activeTabRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const { menu: tabMenu, open: openTabMenu, close: closeTabMenu } = useContextMenu<OpenTab>()

  const setLeftCollapsed = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setLeftCollapsedState((prev) => {
      const next = typeof value === 'function' ? value(prev) : value
      persistFlag(LEFT_COLLAPSED_KEY, next)
      return next
    })
  }, [])

  const setRibbonHidden = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setRibbonHiddenState((prev) => {
      const next = typeof value === 'function' ? value(prev) : value
      persistFlag(RIBBON_HIDDEN_KEY, next)
      return next
    })
  }, [])

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [activeFileId])

  useEffect(() => {
    const el = tabsRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      if (!el) return
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) {
        e.preventDefault()
        el.scrollLeft += e.deltaY
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const togglePureMode = useCallback((next?: boolean) => {
    setPureMode((prev) => {
      const value = typeof next === 'boolean' ? next : !prev
      persistFlag(PURE_KEY, value)
      return value
    })
  }, [])

  const printReading = useCallback(() => {
    const previousMode = viewMode
    setViewMode('reading')
    const printFn = () => {
      const restore = () => {
        if (previousMode !== 'reading') setViewMode(previousMode)
        window.removeEventListener('afterprint', restore)
      }
      window.addEventListener('afterprint', restore)
      window.print()
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(printFn)
    })
  }, [viewMode, setViewMode])

  function insertTemplate(id: string) {
    const note = index.notesById.get(id)
    if (!note) return
    const { body } = parseYamlFrontmatter(note.content)
    const text = body.trimEnd() ? `${body.trimEnd()}\n` : body
    const apply = () => {
      if (!insertSnippet(text)) {
        setEditorContent(
          editorContent && !editorContent.endsWith('\n') ? `${editorContent}\n${text}` : `${editorContent}${text}`,
        )
      }
    }
    if (viewMode === 'reading') {
      setViewMode('source')
      window.setTimeout(apply, 80)
      return
    }
    apply()
  }

  const commands = useMemo(
    () =>
      buildAppCommands({
        vault,
        index,
        tabs,
        activeFileId,
        editorContent,
        viewMode,
        leftPanel,
        rightPanel,
        localGraph,
        theme,
        leftCollapsed,
        ribbonHidden,
        pureMode,
        openFile,
        closeTab,
        closeOtherTabs,
        closeAllTabs,
        closeTabsToTheRight,
        goBack,
        goForward,
        undoCloseTab,
        createNote,
        createBase,
        createCanvas,
        createDirectory,
        renameNode,
        deleteNode,
        duplicateFile,
        saveActiveFile,
        syncFilenameFromHeading,
        writeFileContent,
        setEditorContent,
        setViewMode,
        setLeftPanel,
        setRightPanel,
        setSearchQuery,
        setLocalGraph,
        revealInNavigation,
        expandAllFolders,
        collapseAllFolders,
        refreshVault,
        syncPending,
        pendingCount,
        clearVault,
        setTheme,
        toggleTheme,
        setLeftCollapsed,
        setRibbonHidden,
        togglePureMode,
        openSwitcher: () => setSwitcherOpen(true),
        openSettings: () => setSettingsOpen(true),
        openTemplatePicker: () => setPicker('template'),
        openBookmarks: () => setPicker('bookmarks'),
        printReading,
      }),
    [
      vault,
      index,
      tabs,
      activeFileId,
      editorContent,
      viewMode,
      leftPanel,
      rightPanel,
      localGraph,
      theme,
      leftCollapsed,
      ribbonHidden,
      pureMode,
      openFile,
      closeTab,
      closeOtherTabs,
      closeAllTabs,
      closeTabsToTheRight,
      goBack,
      goForward,
      undoCloseTab,
      createNote,
      createBase,
      createCanvas,
      createDirectory,
      renameNode,
      deleteNode,
      duplicateFile,
      saveActiveFile,
      syncFilenameFromHeading,
      writeFileContent,
      setEditorContent,
      setViewMode,
      setLeftPanel,
      setRightPanel,
      setSearchQuery,
      setLocalGraph,
      revealInNavigation,
      expandAllFolders,
      collapseAllFolders,
      refreshVault,
      syncPending,
      pendingCount,
      clearVault,
      setTheme,
      toggleTheme,
      setLeftCollapsed,
      setRibbonHidden,
      togglePureMode,
      printReading,
    ],
  )

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (hotkeyEventMatch(e, 'Mod+P') && commands.find((c) => c.id === 'command-palette:open')) {
        e.preventDefault()
        setPaletteOpen((open) => !open)
        setSwitcherOpen(false)
        setPicker(null)
        return
      }

      if (e.key === 'Escape') {
        if (paletteOpen) {
          setPaletteOpen(false)
          return
        }
        if (switcherOpen) {
          setSwitcherOpen(false)
          return
        }
        if (picker) {
          setPicker(null)
          return
        }
        if (settingsOpen) {
          setSettingsOpen(false)
          return
        }
        if (pureMode) {
          togglePureMode(false)
        }
        return
      }

      if (paletteOpen || switcherOpen || picker || settingsOpen) return
      if (e.defaultPrevented) return

      const typing = isTypingField(e.target)
      for (const command of commands) {
        if (!command.hotkey || command.bind === false) continue
        if (!hotkeyEventMatch(e, command.hotkey)) continue
        if (typing && !hotkeyAllowedWhileTyping(command.hotkey)) continue
        if (command.id === 'editor:open-search') {
          if (openEditorSearch()) e.preventDefault()
          return
        }
        e.preventDefault()
        void command.run()
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [commands, paletteOpen, switcherOpen, picker, settingsOpen, pureMode, togglePureMode])

  const activeTab = tabs.find((t) => t.id === activeFileId)
  const activeIsBase = activeTab ? isBaseFileName(activeTab.name) : false
  const activeIsCanvas = activeTab ? isCanvasFileName(activeTab.name) : false
  const hideMarkdownModes = activeIsBase || activeIsCanvas || (activeTab ? isImageFileName(activeTab.name) : false)
  const bookmarkItems = picker === 'bookmarks'
    ? loadBookmarks().map((b) => ({ id: b.id, title: b.name, path: b.path }))
    : undefined

  return (
    <div
      className={`workspace ${leftPanel === 'graph' ? 'graph-mode' : ''} ${pureMode ? 'pure-mode' : ''} ${pureMode && isFullscreen ? 'pure-fullscreen' : ''} ${leftCollapsed ? 'left-collapsed' : ''} ${ribbonHidden ? 'ribbon-hidden' : ''}`}
    >
      {!pureMode && !ribbonHidden && (
        <nav className="ribbon" aria-label="Primary">
          <button
            className={leftPanel === 'files' ? 'active' : ''}
            title="Files"
            onClick={() => {
              setLeftCollapsed(false)
              setLeftPanel('files')
            }}
          >
            <Files size={18} />
          </button>
          <button
            className={leftPanel === 'search' ? 'active' : ''}
            title="Search"
            onClick={() => {
              setLeftCollapsed(false)
              setLeftPanel('search')
            }}
          >
            <Search size={18} />
          </button>
          <button
            className={leftPanel === 'canvas' ? 'active' : ''}
            title="Canvas"
            onClick={() => {
              setLeftCollapsed(false)
              setLeftPanel('canvas')
            }}
          >
            <LayoutDashboard size={18} />
          </button>
          <button
            className={leftPanel === 'graph' ? 'active' : ''}
            title="Graph view"
            onClick={() => setLeftPanel('graph')}
          >
            <Network size={18} />
          </button>
          <button
            title="Command palette (Ctrl/Cmd+P)"
            onClick={() => setPaletteOpen(true)}
          >
            <Terminal size={18} />
          </button>
          <div className="ribbon-spacer" />
          <button
            className="theme-toggle icon-only"
            title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            aria-label="Toggle color theme"
            onClick={toggleTheme}
          >
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <button title="Toggle right sidebar" onClick={() => setRightPanel(rightPanel ? null : 'backlinks')}>
            <PanelRight size={18} />
          </button>
          <button title="Settings" onClick={() => setSettingsOpen((v) => !v)}>
            <Settings size={18} />
          </button>
        </nav>
      )}

      {leftPanel !== 'graph' && !pureMode && (
        <aside className="left-sidebar">
          <div className="left-header">
            <div>
              <strong>{vault?.folderName ?? 'Vault'}</strong>
              <span>{session?.email}</span>
            </div>
            <button title="Refresh vault" onClick={() => void refreshVault()} disabled={loadingVault}>
              <RefreshCw size={14} className={loadingVault ? 'spin' : ''} />
            </button>
          </div>
          {localPermissionNeeded && (
            <div className="offline-banner">
              <span>Folder access is needed to save to disk.</span>
              <button type="button" onClick={() => void grantLocalAccess()}>
                Allow access
              </button>
            </div>
          )}
          {leftPanel === 'files' ? (
            <FileTree />
          ) : leftPanel === 'canvas' ? (
            <CanvasList />
          ) : (
            <GlobalSearch />
          )}
        </aside>
      )}

      <main className="main-stage">
        {leftPanel === 'graph' && !pureMode ? (
          <GraphView />
        ) : (
          <>
            {!pureMode && (
              <div className="tab-bar">
                <TabBar
                  tabs={tabs}
                  activeFileId={activeFileId}
                  tabsRef={tabsRef}
                  activeTabRef={activeTabRef}
                  onOpen={(id) => void openFile(id)}
                  onClose={closeTab}
                  onRename={(id, name) => void renameNode(id, name)}
                  onContextMenu={openTabMenu}
                />
                {tabMenu && (
                  <ContextMenu
                    x={tabMenu.x}
                    y={tabMenu.y}
                    onClose={closeTabMenu}
                    items={compactItems([
                      { label: 'Close', onClick: () => closeTab(tabMenu.data.id) },
                      {
                        label: 'Close others',
                        disabled: tabs.length < 2,
                        onClick: () => closeOtherTabs(tabMenu.data.id),
                      },
                      { label: 'Close all', onClick: () => closeAllTabs() },
                      {
                        label: 'Close tabs to the right',
                        disabled: tabs.findIndex((t) => t.id === tabMenu.data.id) >= tabs.length - 1,
                        onClick: () => closeTabsToTheRight(tabMenu.data.id),
                      },
                      { type: 'separator' as const },
                      {
                        label: 'Copy path',
                        onClick: () => void copyPath(tabMenu.data.path || tabMenu.data.name),
                      },
                      {
                        label: 'Copy wikilink',
                        onClick: () => void copyWikilink(tabMenu.data.name, tabMenu.data.path, index),
                      },
                    ])}
                  />
                )}
                <div className="view-modes">
                  {!hideMarkdownModes && (
                    <>
                      <button
                        className={viewMode === 'source' ? 'active' : ''}
                        title="Source"
                        onClick={() => setViewMode('source')}
                      >
                        <Code2 size={15} />
                      </button>
                      <button
                        className={viewMode === 'live' ? 'active' : ''}
                        title="Live preview"
                        onClick={() => setViewMode('live')}
                      >
                        <Columns2 size={15} />
                      </button>
                      <button
                        className={viewMode === 'wysiwyg' ? 'active' : ''}
                        title="WYSIWYG"
                        onClick={() => setViewMode('wysiwyg')}
                      >
                        <PenLine size={15} />
                      </button>
                      <button
                        className={viewMode === 'reading' ? 'active' : ''}
                        title="Reading view"
                        onClick={() => setViewMode('reading')}
                      >
                        <BookOpen size={15} />
                      </button>
                    </>
                  )}
                  <button
                    title="Pure editor mode (Ctrl/Cmd+Shift+P)"
                    aria-pressed={pureMode}
                    onClick={() => togglePureMode(true)}
                  >
                    <Maximize2 size={15} />
                  </button>
                </div>
              </div>
            )}
            <div className="editor-stage">
              <MarkdownEditor />
            </div>
          </>
        )}
        {!pureMode && (
          <footer className="status-bar">
            <span>{statusMessage}</span>
            <span className="status-right">
              {offline && <span className="offline-pill">Offline</span>}
              {pendingCount > 0 && (
                <button
                  type="button"
                  className="sync-pill"
                  onClick={() => void syncPending()}
                  title="Sync pending changes"
                >
                  {pendingCount} to sync
                </button>
              )}
              <span className={`save-pill ${saveStatus}`}>
                {saveStatus === 'pending' ? 'local' : saveStatus}
              </span>
            </span>
          </footer>
        )}
      </main>

      {!pureMode && <RightSidebar />}

      {pureMode && (
        <button
          type="button"
          className="pure-exit"
          title="Exit (Esc)"
          aria-label="Exit"
          onClick={() => togglePureMode(false)}
        >
          <Minimize2 size={16} />
          <span>Exit</span>
        </button>
      )}

      <CommandPalette open={paletteOpen} commands={commands} onClose={() => setPaletteOpen(false)} />
      <QuickSwitcher open={switcherOpen} onClose={() => setSwitcherOpen(false)} />
      <QuickSwitcher
        open={picker === 'template'}
        onClose={() => setPicker(null)}
        placeholder="Insert template — pick a note"
        emptyText="No matching notes"
        onChoose={(id) => insertTemplate(id)}
      />
      <QuickSwitcher
        open={picker === 'bookmarks'}
        onClose={() => setPicker(null)}
        placeholder="Bookmarks"
        items={bookmarkItems}
        emptyText="No bookmarks yet"
      />

      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Vault settings</h2>
            <p>
              Connected vault: <strong>{vault?.folderName}</strong>
            </p>
            <div className="settings-actions">
              <button onClick={toggleTheme}>
                {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
                Use {theme === 'light' ? 'dark' : 'light'} mode
              </button>
              <button
                onClick={() => {
                  clearVault()
                  setSettingsOpen(false)
                }}
              >
                <FolderInput size={16} />
                Change vault folder
              </button>
              <button
                className="danger"
                onClick={() => {
                  disconnect()
                  setSettingsOpen(false)
                }}
              >
                Sign out
              </button>
            </div>
            <p className="settings-hint">
              {local
                ? 'Local mode reads and writes a folder on this device. If that folder is in iCloud Drive, Apple syncs it. Shortcuts: Ctrl/Cmd+P (commands) · Ctrl/Cmd+O · Ctrl/Cmd+N · Ctrl/Cmd+Shift+P (pure editor) · autosave'
                : authProvider === 'github'
                  ? 'GitHub mode stores notes as markdown in your repo. Each save creates a commit. Shortcuts: Ctrl/Cmd+P (commands) · Ctrl/Cmd+O · Ctrl/Cmd+N · Ctrl/Cmd+Shift+P (pure editor) · autosave'
                  : 'Sign out ends this device session. Your vault folder stays linked to your Google account for the next sign-in. Shortcuts: Ctrl/Cmd+P (commands) · Ctrl/Cmd+O · Ctrl/Cmd+N · Ctrl/Cmd+Shift+P (pure editor) · autosave'}
            </p>
          </div>
        </div>
      )}

      {error && <div className="toast-error">{error}</div>}
    </div>
  )
}
