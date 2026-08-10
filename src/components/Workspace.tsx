import { useEffect, useRef, useState } from 'react'
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
} from 'lucide-react'
import { useApp } from '../hooks/useApp'
import { useTheme } from '../hooks/useTheme'
import { FileTree } from './sidebar/FileTree'
import { GlobalSearch } from './search/GlobalSearch'
import { GraphView } from './graph/GraphView'
import { MarkdownEditor } from './editor/MarkdownEditor'
import { RightSidebar } from './panels/RightSidebar'
import { QuickSwitcher } from './search/QuickSwitcher'
import { displayNoteName } from '../lib/noteNames'
import './Workspace.css'

const PURE_KEY = 'kyoketti.pureMode'

function loadPureMode(): boolean {
  try {
    return localStorage.getItem(PURE_KEY) === '1'
  } catch {
    return false
  }
}

export function Workspace() {
  const {
    vault,
    tabs,
    activeFileId,
    openFile,
    closeTab,
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
    session,
    local,
    error,
  } = useApp()

  const { theme, toggleTheme } = useTheme()
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pureMode, setPureMode] = useState(loadPureMode)
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(document.fullscreenElement))
  const activeTabRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [activeFileId])

  useEffect(() => {
    const el = tabsRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      if (!el) return
      // Convert vertical wheel / trackpad into horizontal tab scrolling.
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) {
        e.preventDefault()
        el.scrollLeft += e.deltaY
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  function togglePureMode(next?: boolean) {
    setPureMode((prev) => {
      const value = typeof next === 'boolean' ? next : !prev
      try {
        localStorage.setItem(PURE_KEY, value ? '1' : '0')
      } catch {
        /* ignore */
      }
      return value
    })
  }

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        setSwitcherOpen(true)
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
      }
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        if (vault) void createNote(vault.folderId, 'Untitled')
      }
      // Pure editor mode: Ctrl/Cmd+Shift+P
      if (mod && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        togglePureMode()
        return
      }
      // Print Reading view: Ctrl/Cmd+P
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        const previousMode = viewMode
        setViewMode('reading')
        const printReading = () => {
          const restore = () => {
            if (previousMode !== 'reading') setViewMode(previousMode)
            window.removeEventListener('afterprint', restore)
          }
          window.addEventListener('afterprint', restore)
          window.print()
        }
        // Wait a frame so Reading view is mounted before the print dialog.
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(printReading)
        })
        return
      }
      if (e.key === 'Escape') {
        if (switcherOpen) {
          setSwitcherOpen(false)
          return
        }
        if (pureMode) {
          togglePureMode(false)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [vault, createNote, pureMode, switcherOpen, viewMode, setViewMode])

  return (
    <div
      className={`workspace ${leftPanel === 'graph' ? 'graph-mode' : ''} ${pureMode ? 'pure-mode' : ''} ${pureMode && isFullscreen ? 'pure-fullscreen' : ''}`}
    >
      {!pureMode && (
        <nav className="ribbon" aria-label="Primary">
          <button
            className={leftPanel === 'files' ? 'active' : ''}
            title="Files"
            onClick={() => setLeftPanel('files')}
          >
            <Files size={18} />
          </button>
          <button
            className={leftPanel === 'search' ? 'active' : ''}
            title="Search"
            onClick={() => setLeftPanel('search')}
          >
            <Search size={18} />
          </button>
          <button
            className={leftPanel === 'graph' ? 'active' : ''}
            title="Graph"
            onClick={() => setLeftPanel('graph')}
          >
            <Network size={18} />
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
          {leftPanel === 'files' ? <FileTree /> : <GlobalSearch />}
        </aside>
      )}

      <main className="main-stage">
        {leftPanel === 'graph' && !pureMode ? (
          <GraphView />
        ) : (
          <>
            {!pureMode && (
              <div className="tab-bar">
                <div className="tabs" ref={tabsRef}>
                  {tabs.map((tab) => (
                    <div
                      key={tab.id}
                      ref={tab.id === activeFileId ? activeTabRef : undefined}
                      className={`tab ${tab.id === activeFileId ? 'active' : ''}`}
                      onClick={() => void openFile(tab.id)}
                    >
                      <span>
                        {tab.dirty ? '• ' : ''}
                        {displayNoteName(tab.name)}
                      </span>
                      <button
                        className="tab-close"
                        onClick={(e) => {
                          e.stopPropagation()
                          closeTab(tab.id)
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <div className="view-modes">
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
            <span className={`save-pill ${saveStatus}`}>{saveStatus}</span>
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

      <QuickSwitcher open={switcherOpen} onClose={() => setSwitcherOpen(false)} />

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
                ? 'Local mode reads and writes a folder on this device. If that folder is in iCloud Drive, Apple syncs it. Shortcuts: Ctrl/Cmd+O · Ctrl/Cmd+N · Ctrl/Cmd+Shift+P (pure editor) · autosave'
                : 'Sign out ends this device session. Your vault folder stays linked to your Google account for the next sign-in. Shortcuts: Ctrl/Cmd+O · Ctrl/Cmd+N · Ctrl/Cmd+Shift+P (pure editor) · autosave'}
            </p>
          </div>
        </div>
      )}

      {error && <div className="toast-error">{error}</div>}
    </div>
  )
}
