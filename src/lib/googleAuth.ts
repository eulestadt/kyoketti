import type { AuthSession } from '../types'

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'openid',
  'email',
  'profile',
].join(' ')

const TOKEN_KEY = 'kyoketti.google.session'
const GIS_SRC = 'https://accounts.google.com/gsi/client'

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string
            scope: string
            callback: (response: TokenResponse) => void
            error_callback?: (error: { type: string; message?: string }) => void
          }) => {
            requestAccessToken: (overrideConfig?: { prompt?: string }) => void
          }
          revoke: (token: string, done?: () => void) => void
        }
      }
    }
  }
}

type TokenResponse = {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

let gisReady: Promise<void> | null = null

export function getGoogleClientId(): string {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? ''
}

export function getGoogleApiKey(): string {
  return import.meta.env.VITE_GOOGLE_API_KEY?.trim() ?? ''
}

export function loadSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY)
    if (!raw) return null
    const session = JSON.parse(raw) as AuthSession
    if (!session.accessToken || session.expiresAt <= Date.now() + 30_000) {
      localStorage.removeItem(TOKEN_KEY)
      return null
    }
    return session
  } catch {
    return null
  }
}

export function saveSession(session: AuthSession): void {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(session))
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY)
}

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (gisReady) return gisReady
  gisReady = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GIS_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services')))
      return
    }
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'))
    document.head.appendChild(script)
  })
  return gisReady
}

async function fetchProfile(accessToken: string): Promise<Pick<AuthSession, 'email' | 'name' | 'picture'>> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return {}
  const data = (await res.json()) as { email?: string; name?: string; picture?: string }
  return { email: data.email, name: data.name, picture: data.picture }
}

export async function connectGoogleDrive(prompt = 'consent'): Promise<AuthSession> {
  const clientId = getGoogleClientId()
  if (!clientId || clientId.includes('your-client-id')) {
    throw new Error('Set VITE_GOOGLE_CLIENT_ID in .env to your Google OAuth Web Client ID.')
  }

  await loadGis()
  if (!window.google?.accounts?.oauth2) {
    throw new Error('Google Identity Services failed to initialize.')
  }

  const tokenResponse = await new Promise<TokenResponse>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (response) => {
        if (response.error) {
          reject(new Error(response.error_description || response.error))
          return
        }
        resolve(response)
      },
      error_callback: (error) => {
        reject(new Error(error.message || error.type || 'Google sign-in cancelled'))
      },
    })
    client.requestAccessToken({ prompt })
  })

  if (!tokenResponse.access_token) {
    throw new Error('No access token returned from Google.')
  }

  const profile = await fetchProfile(tokenResponse.access_token)
  const session: AuthSession = {
    accessToken: tokenResponse.access_token,
    expiresAt: Date.now() + (tokenResponse.expires_in ?? 3600) * 1000,
    ...profile,
  }
  saveSession(session)
  return session
}

export function disconnectGoogleDrive(session: AuthSession | null): void {
  if (session?.accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(session.accessToken)
  }
  clearSession()
}
