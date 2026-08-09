import { HardDrive, Loader2, Moon, NotebookPen, Sun } from 'lucide-react'
import { useApp } from '../hooks/useApp'
import { useTheme } from '../hooks/useTheme'
import './ConnectDrive.css'

export function ConnectDrive() {
  const { connect, connecting, error, startDemo } = useApp()
  const { theme, toggleTheme } = useTheme()

  return (
    <div className="connect-screen">
      <div className="connect-atmosphere" aria-hidden />
      <button
        className="theme-toggle connect-theme-toggle"
        onClick={toggleTheme}
        title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
        aria-label="Toggle color theme"
      >
        {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
        {theme === 'light' ? 'Dark' : 'Light'}
      </button>
      <main className="connect-panel">
        <div className="connect-brand">
          <NotebookPen className="connect-logo" strokeWidth={1.5} />
          <h1>Kyoketti</h1>
        </div>
        <p className="connect-tagline">
          Your second brain on the web — markdown notes living in your Google Drive, linked like Obsidian.
        </p>
        <button className="connect-cta" onClick={() => void connect()} disabled={connecting}>
          {connecting ? <Loader2 className="spin" size={18} /> : <HardDrive size={18} />}
          {connecting ? 'Redirecting…' : 'Sign in with Google'}
        </button>
        <button className="connect-demo" onClick={startDemo}>
          Try a local demo vault
        </button>
        <p className="connect-hint">
          Sign in once. Your Google Drive vault stays linked across devices — no re-picking the folder.
        </p>
        {error && <p className="connect-error">{error}</p>}
      </main>
    </div>
  )
}
