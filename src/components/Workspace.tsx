import { useEffect, useState } from 'react'
import {
  Files,
  Search,
  Network,
  Settings,
  PanelRight,
  BookOpen,
  Columns2,
  Code2,
  RefreshCw,
  FolderInput,
  Moon,
  Sun,
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
    error,
  } = useApp()

  const { theme, toggleTheme } = useTheme()
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

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
      if (e.key === 'Escape') setSwitcherOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [vault, createNote])

  return (
    <div className={`workspace ${leftPanel === 'graph' ? 'graph-mode' : ''}`}>
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

      {leftPanel !== 'graph' && (
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
        {leftPanel === 'graph' ? (
          <GraphView />
        ) : (
          <>
            <div className="tab-bar">
              <div className="tabs">
                {tabs.map((tab) => (
                  <div
                    key={tab.id}
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
                  className={viewMode === 'reading' ? 'active' : ''}
                  title="Reading view"
                  onClick={() => setViewMode('reading')}
                >
                  <BookOpen size={15} />
                </button>
              </div>
            </div>
            <div className="editor-stage">
              <MarkdownEditor />
            </div>
          </>
        )}
        <footer className="status-bar">
          <span>{statusMessage}</span>
          <span className={`save-pill ${saveStatus}`}>{saveStatus}</span>
        </footer>
      </main>

      <RightSidebar />

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
              Sign out ends this device session. Your vault folder stays linked to your Google account for the next
              sign-in. Shortcuts: Ctrl/Cmd+O · Ctrl/Cmd+N · autosave
            </p>
          </div>
        </div>
      )}

      {error && <div className="toast-error">{error}</div>}
    </div>
  )
}
