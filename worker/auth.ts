import type { Env, PublicUser, UserRow, VaultInfo } from './types'
import { decryptSecret, encryptSecret, randomId } from './crypto'

const SESSION_COOKIE = 'kyoketti_session'
const SESSION_DAYS = 30
const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive',
].join(' ')

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  headers.set('cache-control', 'no-store')
  return new Response(JSON.stringify(data), { ...init, headers })
}

export function appOrigin(request: Request, env: Env): string {
  if (env.APP_ORIGIN) return env.APP_ORIGIN.replace(/\/$/, '')
  return new URL(request.url).origin
}

function cookieOptions(maxAge: number): string {
  return `Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
}

export function setSessionCookie(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}; ${cookieOptions(SESSION_DAYS * 24 * 60 * 60)}`
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; ${cookieOptions(0)}`
}

export function readSessionId(request: Request): string | null {
  const cookie = request.headers.get('Cookie') ?? ''
  const match = cookie.match(/(?:^|;\s*)kyoketti_session=([^;]+)/)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

export function toPublicUser(user: UserRow): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
  }
}

export function toVault(user: UserRow): VaultInfo {
  if (!user.vault_folder_id) return null
  return {
    folderId: user.vault_folder_id,
    folderName: user.vault_folder_name || 'Vault',
  }
}

export async function getUserBySession(env: Env, sessionId: string): Promise<UserRow | null> {
  const row = await env.DB.prepare(
    `SELECT u.* FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
  )
    .bind(sessionId, new Date().toISOString())
    .first<UserRow>()
  return row ?? null
}

export async function createSession(env: Env, userId: string): Promise<string> {
  const id = randomId(24)
  const now = new Date()
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
  )
    .bind(id, userId, expires.toISOString(), now.toISOString())
    .run()
  return id
}

export async function destroySession(env: Env, sessionId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sessionId).run()
}

export async function createOauthState(env: Env): Promise<string> {
  const state = randomId(16)
  const now = new Date()
  const expires = new Date(now.getTime() + 10 * 60 * 1000)
  await env.DB.prepare(
    `INSERT INTO oauth_states (state, created_at, expires_at) VALUES (?, ?, ?)`,
  )
    .bind(state, now.toISOString(), expires.toISOString())
    .run()
  return state
}

export async function consumeOauthState(env: Env, state: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT state FROM oauth_states WHERE state = ? AND expires_at > ?`,
  )
    .bind(state, new Date().toISOString())
    .first<{ state: string }>()
  if (!row) return false
  await env.DB.prepare(`DELETE FROM oauth_states WHERE state = ?`).bind(state).run()
  return true
}

export function googleAuthUrl(origin: string, state: string, clientId: string, forceConsent: boolean): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${origin}/api/auth/callback`,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    include_granted_scopes: 'true',
    state,
    prompt: forceConsent ? 'consent' : 'select_account',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

type TokenResponse = {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  error?: string
  error_description?: string
}

export async function exchangeCode(
  env: Env,
  origin: string,
  code: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: `${origin}/api/auth/callback`,
    grant_type: 'authorization_code',
  })
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  return (await res.json()) as TokenResponse
}

export async function refreshAccessToken(env: Env, refreshToken: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  return (await res.json()) as TokenResponse
}

export async function fetchGoogleProfile(accessToken: string): Promise<{
  sub: string
  email?: string
  name?: string
  picture?: string
}> {
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error('Failed to fetch Google profile')
  return (await res.json()) as { sub: string; email?: string; name?: string; picture?: string }
}

export async function upsertUserFromGoogle(
  env: Env,
  profile: { sub: string; email?: string; name?: string; picture?: string },
  refreshToken: string | undefined,
): Promise<UserRow> {
  const existing = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`)
    .bind(profile.sub)
    .first<UserRow>()
  const now = new Date().toISOString()

  if (!existing) {
    if (!refreshToken) {
      throw new Error('Google did not return a refresh token. Retry login with consent.')
    }
    const enc = await encryptSecret(refreshToken, env.SESSION_SECRET)
    await env.DB.prepare(
      `INSERT INTO users (id, email, name, picture, refresh_token_enc, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(profile.sub, profile.email ?? null, profile.name ?? null, profile.picture ?? null, enc, now, now)
      .run()
  } else {
    const enc = refreshToken
      ? await encryptSecret(refreshToken, env.SESSION_SECRET)
      : existing.refresh_token_enc
    await env.DB.prepare(
      `UPDATE users SET email = ?, name = ?, picture = ?, refresh_token_enc = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(profile.email ?? null, profile.name ?? null, profile.picture ?? null, enc, now, profile.sub)
      .run()
  }

  const user = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`)
    .bind(profile.sub)
    .first<UserRow>()
  if (!user) throw new Error('Failed to persist user')
  return user
}

export async function saveVault(
  env: Env,
  userId: string,
  folderId: string,
  folderName: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE users SET vault_folder_id = ?, vault_folder_name = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(folderId, folderName, new Date().toISOString(), userId)
    .run()
}

export async function clearVault(env: Env, userId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE users SET vault_folder_id = NULL, vault_folder_name = NULL, updated_at = ? WHERE id = ?`,
  )
    .bind(new Date().toISOString(), userId)
    .run()
}

export async function getDriveAccessToken(env: Env, user: UserRow): Promise<{
  accessToken: string
  expiresIn: number
}> {
  const refreshToken = await decryptSecret(user.refresh_token_enc, env.SESSION_SECRET)
  const token = await refreshAccessToken(env, refreshToken)
  if (!token.access_token) {
    throw new Error(token.error_description || token.error || 'Failed to refresh Google access token')
  }
  return {
    accessToken: token.access_token,
    expiresIn: token.expires_in ?? 3600,
  }
}
