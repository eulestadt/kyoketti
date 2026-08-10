import { Folder, Loader2, Moon, Sun } from 'lucide-react'
import { useApp } from '../hooks/useApp'
import { useTheme } from '../hooks/useTheme'
import { isLocalFolderSupported } from '../lib/localVault'
import { KyokettiLogo } from './KyokettiLogo'
import './ConnectDrive.css'

function GoogleMark() {
  return (
    <svg className="google-mark" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  )
}

function GithubMark() {
  return (
    <svg className="github-mark" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 1.5C6.2 1.5 1.5 6.2 1.5 12c0 4.64 3.01 8.57 7.19 9.96.53.1.72-.23.72-.51 0-.25-.01-.92-.01-1.8-2.93.64-3.55-1.41-3.55-1.41-.48-1.22-1.17-1.55-1.17-1.55-.96-.65.07-.64.07-.64 1.06.07 1.62 1.09 1.62 1.09.94 1.61 2.47 1.15 3.07.88.1-.68.37-1.15.67-1.41-2.34-.27-4.8-1.17-4.8-5.21 0-1.15.41-2.09 1.09-2.83-.11-.27-.47-1.36.1-2.83 0 0 .89-.28 2.91 1.08a10.1 10.1 0 0 1 2.65-.36c.9 0 1.81.12 2.65.36 2.02-1.36 2.91-1.08 2.91-1.08.57 1.47.21 2.56.1 2.83.68.74 1.09 1.68 1.09 2.83 0 4.05-2.47 4.94-4.82 5.2.38.33.72.97.72 1.96 0 1.41-.01 2.55-.01 2.9 0 .28.19.61.73.51A10.52 10.52 0 0 0 22.5 12c0-5.8-4.7-10.5-10.5-10.5z"
      />
    </svg>
  )
}

export function ConnectDrive() {
  const { connect, connectGithub, connectLocal, connecting, error, startDemo } = useApp()
  const { theme, toggleTheme } = useTheme()
  const localSupported = isLocalFolderSupported()

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
          <KyokettiLogo className="connect-logo" />
          <h1>Kyoketti</h1>
        </div>
        <p className="connect-tagline">
          Your second brain on the web — Obsidian markdown notes in Google Drive, GitHub, or a local
          folder (including iCloud Drive on Mac).
        </p>

        <div className="connect-auth">
          <button
            className="provider-btn"
            onClick={() => void connect()}
            disabled={connecting}
            aria-label="Continue with Google"
          >
            {connecting ? <Loader2 className="spin" size={22} /> : <GoogleMark />}
            <span className="provider-btn-label">
              <span className="provider-btn-kicker">Continue with</span>
              <span>Google</span>
            </span>
          </button>

          <button
            className="provider-btn"
            onClick={() => void connectGithub()}
            disabled={connecting}
            aria-label="Continue with GitHub"
          >
            {connecting ? <Loader2 className="spin" size={22} /> : <GithubMark />}
            <span className="provider-btn-label">
              <span className="provider-btn-kicker">Continue with</span>
              <span>GitHub</span>
            </span>
          </button>

          <button
            className="provider-btn"
            onClick={() => void connectLocal()}
            disabled={connecting || !localSupported}
            aria-label="Continue with Local"
            title={
              localSupported
                ? 'Open a folder on this device. Works with iCloud Drive vaults on Mac.'
                : 'Needs Chrome or Edge on desktop'
            }
          >
            <Folder className="local-mark" size={28} strokeWidth={1.75} />
            <span className="provider-btn-label">
              <span className="provider-btn-kicker">Continue with</span>
              <span>Local</span>
            </span>
          </button>
        </div>

        {!localSupported && (
          <p className="connect-local-note">
            Local folders need Chrome or Edge on desktop.
          </p>
        )}

        <button className="connect-demo-link" onClick={startDemo}>
          Try a local demo vault
        </button>

        <p className="connect-legal">
          Kyoketti is not affiliated with, endorsed by, or associated with Obsidian. But I am a huge lover of all that
          they've done. I'm not a lawyer but whatever is required to communicate that Obsidian® is reserved by its
          registered owner belong here.
        </p>

        {error && <p className="connect-error">{error}</p>}
      </main>
    </div>
  )
}
