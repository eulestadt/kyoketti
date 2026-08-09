import { useMemo, useState } from 'react'
import { FolderOpen, Loader2, Moon, Plus, Search, Sun } from 'lucide-react'
import { useApp } from '../hooks/useApp'
import { useTheme } from '../hooks/useTheme'
import { createFolder, searchFolders } from '../lib/googleDrive'
import type { DriveFile } from '../types'
import './VaultPicker.css'

export function VaultPicker() {
  const { session, setVault, disconnect, error, setError } = useApp()
  const { theme, toggleTheme } = useTheme()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DriveFile[]>([])
  const [searching, setSearching] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('Obsidian Vault')

  const greeting = useMemo(() => session?.name?.split(' ')[0] ?? session?.email ?? 'there', [session])

  async function runSearch(value: string) {
    if (!session) return
    setQuery(value)
    if (!value.trim()) {
      setResults([])
      return
    }
    setSearching(true)
    setError(null)
    try {
      const folders = await searchFolders(session.accessToken, value.trim())
      setResults(folders)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Folder search failed')
    } finally {
      setSearching(false)
    }
  }

  async function createVault() {
    if (!session || !newName.trim()) return
    setCreating(true)
    setError(null)
    try {
      const folder = await createFolder(session.accessToken, 'root', newName.trim())
      await setVault({ folderId: folder.id, folderName: folder.name })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create vault folder')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="vault-screen">
      <header className="vault-header">
        <div>
          <p className="vault-kicker">Welcome, {greeting}</p>
          <h1>Open a vault</h1>
          <p className="vault-sub">Choose a Google Drive folder to use as your markdown vault.</p>
        </div>
        <div className="vault-header-actions">
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          >
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            {theme === 'light' ? 'Dark' : 'Light'}
          </button>
          <button className="ghost-btn" onClick={disconnect}>
            Disconnect
          </button>
        </div>
      </header>

      <section className="vault-create">
        <h2>Create new vault</h2>
        <div className="vault-create-row">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Vault name"
            aria-label="New vault name"
          />
          <button onClick={() => void createVault()} disabled={creating}>
            {creating ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
            Create
          </button>
        </div>
      </section>

      <section className="vault-search">
        <h2>Open existing folder</h2>
        <label className="search-field">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => void runSearch(e.target.value)}
            placeholder="Search Drive folders…"
            aria-label="Search Drive folders"
          />
          {searching && <Loader2 className="spin" size={16} />}
        </label>
        <ul className="folder-results">
          {results.map((folder) => (
            <li key={folder.id}>
              <button
                onClick={() => void setVault({ folderId: folder.id, folderName: folder.name })}
              >
                <FolderOpen size={16} />
                <span>{folder.name}</span>
              </button>
            </li>
          ))}
          {!searching && query && results.length === 0 && (
            <li className="empty">No folders matched “{query}”.</li>
          )}
        </ul>
      </section>

      {error && <p className="vault-error">{error}</p>}
    </div>
  )
}
