import { Loader2, Moon, Sun } from 'lucide-react'
import { useApp } from '../hooks/useApp'
import { useTheme } from '../hooks/useTheme'
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
          <KyokettiLogo className="connect-logo" />
          <h1>Kyoketti</h1>
        </div>
        <p className="connect-tagline">
          Your second brain on the web — your Obsidian markdown notes living in your Google Drive.
        </p>

        <div className="connect-auth">
          <button
            className="provider-btn"
            onClick={() => void connect()}
            disabled={connecting}
            aria-label="Sign in with Google"
          >
            {connecting ? <Loader2 className="spin" size={22} /> : <GoogleMark />}
            <span className="provider-btn-label">
              <span className="provider-btn-kicker">Continue with</span>
              <span>{connecting ? 'Redirecting…' : 'Google'}</span>
            </span>
          </button>
        </div>

        <button className="connect-demo-link" onClick={startDemo}>
          Try a local demo vault
        </button>

        <p className="connect-legal">
          Kyoketti is an independent product and is not affiliated with, endorsed by, or associated with Obsidian.
          Obsidian® is a trademark of Dynalist Inc. All rights reserved by their respective owners.
        </p>

        {error && <p className="connect-error">{error}</p>}
      </main>
    </div>
  )
}
