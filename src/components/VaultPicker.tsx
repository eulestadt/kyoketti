import { useEffect, useMemo, useState } from 'react'
import { FolderOpen, Loader2, Lock, Moon, Plus, Search, Sun } from 'lucide-react'
import { useApp } from '../hooks/useApp'
import { useTheme } from '../hooks/useTheme'
import { createFolder, searchFolders } from '../lib/googleDrive'
import {
  createGithubVaultRepo,
  listGithubRepos,
  type GithubRepo,
} from '../lib/githubVault'
import type { DriveFile } from '../types'
import './VaultPicker.css'

export function VaultPicker() {
  const { session, setVault, disconnect, error, setError, authProvider } = useApp()
  const { theme, toggleTheme } = useTheme()
  const isGithub = authProvider === 'github'
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DriveFile[]>([])
  const [repos, setRepos] = useState<GithubRepo[]>([])
  const [searching, setSearching] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState(isGithub ? 'kyoketti-vault' : 'Kyoketti Vault')

  const greeting = useMemo(() => session?.name?.split(' ')[0] ?? session?.email ?? 'there', [session])

  useEffect(() => {
    if (!isGithub || !session) return
    let cancelled = false
    async function loadRepos() {
      setSearching(true)
      setError(null)
      try {
        const list = await listGithubRepos(session!.accessToken)
        if (!cancelled) setRepos(list)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to list repositories')
      } finally {
        if (!cancelled) setSearching(false)
      }
    }
    void loadRepos()
    return () => {
      cancelled = true
    }
  }, [isGithub, session, setError])

  async function runSearch(value: string) {
    if (!session) return
    setQuery(value)
    if (isGithub) {
      setSearching(true)
      setError(null)
      try {
        const list = await listGithubRepos(session.accessToken, value)
        setRepos(list)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Repository search failed')
      } finally {
        setSearching(false)
      }
      return
    }
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
      if (isGithub) {
        const repoName = newName
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9._-]+/g, '-')
          .replace(/^-+|-+$/g, '')
        const repo = await createGithubVaultRepo(session.accessToken, repoName || 'kyoketti-vault')
        await setVault({ folderId: repo.full_name, folderName: repo.full_name })
      } else {
        const folder = await createFolder(session.accessToken, 'root', newName.trim())
        await setVault({ folderId: folder.id, folderName: folder.name })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create vault')
    } finally {
      setCreating(false)
    }
  }

  const filteredRepos = useMemo(() => {
    if (!isGithub) return []
    const q = query.trim().toLowerCase()
    if (!q) return repos
    return repos.filter(
      (r) =>
        r.full_name.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q),
    )
  }, [isGithub, repos, query])

  return (
    <div className="vault-screen">
      <header className="vault-header">
        <div>
          <p className="vault-kicker">Welcome, {greeting}</p>
          <h1>Open a vault</h1>
          <p className="vault-sub">
            {isGithub
              ? 'Choose a private GitHub repository to use as your markdown vault.'
              : 'Choose a Google Drive folder to use as your markdown vault.'}
          </p>
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
            Sign out
          </button>
        </div>
      </header>

      <section className="vault-create">
        <h2>{isGithub ? 'Create private vault repo' : 'Create new vault'}</h2>
        <div className="vault-create-row">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={isGithub ? 'Repository name' : 'Vault name'}
            aria-label={isGithub ? 'New repository name' : 'New vault name'}
          />
          <button onClick={() => void createVault()} disabled={creating}>
            {creating ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
            Create
          </button>
        </div>
      </section>

      <section className="vault-search">
        <h2>{isGithub ? 'Open existing repository' : 'Open existing folder'}</h2>
        <label className="search-field">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => void runSearch(e.target.value)}
            placeholder={isGithub ? 'Filter repositories…' : 'Search Drive folders…'}
            aria-label={isGithub ? 'Filter repositories' : 'Search Drive folders'}
          />
          {searching && <Loader2 className="spin" size={16} />}
        </label>
        <ul className="folder-results">
          {isGithub
            ? filteredRepos.map((repo) => (
                <li key={repo.id}>
                  <button
                    onClick={() =>
                      void setVault({ folderId: repo.full_name, folderName: repo.full_name })
                    }
                  >
                    {repo.private ? <Lock size={16} /> : <FolderOpen size={16} />}
                    <span>
                      {repo.full_name}
                      {repo.private ? '' : ' (public)'}
                    </span>
                  </button>
                </li>
              ))
            : results.map((folder) => (
                <li key={folder.id}>
                  <button
                    onClick={() => void setVault({ folderId: folder.id, folderName: folder.name })}
                  >
                    <FolderOpen size={16} />
                    <span>{folder.name}</span>
                  </button>
                </li>
              ))}
          {!searching && isGithub && filteredRepos.length === 0 && (
            <li className="empty">No repositories matched.</li>
          )}
          {!searching && !isGithub && query && results.length === 0 && (
            <li className="empty">No folders matched “{query}”.</li>
          )}
        </ul>
      </section>

      {error && <p className="vault-error">{error}</p>}
    </div>
  )
}
