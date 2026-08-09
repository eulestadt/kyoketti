import { HardDrive, Loader2, NotebookPen } from 'lucide-react'
import { getGoogleClientId } from '../lib/googleAuth'
import { useApp } from '../hooks/useApp'
import './ConnectDrive.css'

export function ConnectDrive() {
  const { connect, connecting, error, startDemo } = useApp()
  const clientIdConfigured = Boolean(getGoogleClientId() && !getGoogleClientId().includes('your-client-id'))

  return (
    <div className="connect-screen">
      <div className="connect-atmosphere" aria-hidden />
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
          {connecting ? 'Connecting…' : 'Link Google Drive'}
        </button>
        <button className="connect-demo" onClick={startDemo}>
          Try a local demo vault
        </button>
        {!clientIdConfigured && (
          <p className="connect-hint">
            Add <code>VITE_GOOGLE_CLIENT_ID</code> (and optional <code>VITE_GOOGLE_API_KEY</code>) in{' '}
            <code>.env</code>. Enable Drive API on your Google Cloud project and authorize this origin.
          </p>
        )}
        {error && <p className="connect-error">{error}</p>}
      </main>
    </div>
  )
}
