export type AuthProvider = 'google' | 'github'

export type MeResponse = {
  user: {
    id: string
    email: string | null
    name: string | null
    picture: string | null
    provider: AuthProvider
  } | null
  vault: {
    folderId: string
    folderName: string
  } | null
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) {
    throw new Error(data.error || res.statusText || 'Request failed')
  }
  return data
}

export function fetchMe(): Promise<MeResponse> {
  return api<MeResponse>('/api/auth/me')
}

export function logoutServer(): Promise<{ ok: boolean }> {
  return api('/api/auth/logout', { method: 'POST' })
}

export function saveVaultServer(folderId: string, folderName: string) {
  return api<{ ok: boolean }>('/api/vault', {
    method: 'PUT',
    body: JSON.stringify({ folderId, folderName }),
  })
}

export function clearVaultServer() {
  return api<{ ok: boolean }>('/api/vault', { method: 'DELETE' })
}

export function fetchDriveToken(): Promise<{ accessToken: string; expiresIn: number }> {
  return api('/api/auth/drive-token', { method: 'POST' })
}

export function fetchGithubToken(): Promise<{ accessToken: string; expiresIn: number }> {
  return api('/api/auth/github-token', { method: 'POST' })
}

export function startGoogleLogin(forceConsent = false) {
  window.location.href = forceConsent ? '/api/auth/login?consent=1' : '/api/auth/login'
}

export function startGithubLogin() {
  window.location.href = '/api/auth/github/login'
}
