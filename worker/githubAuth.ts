import type { Env, UserRow } from './types'
import { decryptSecret, encryptSecret, randomId } from './crypto'

const GITHUB_SCOPES = ['read:user', 'user:email', 'repo'].join(' ')

export function githubAuthUrl(origin: string, state: string, clientId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${origin}/api/auth/github/callback`,
    scope: GITHUB_SCOPES,
    state,
    allow_signup: 'true',
  })
  return `https://github.com/login/oauth/authorize?${params}`
}

export async function createGithubOauthState(env: Env): Promise<string> {
  const state = randomId(16)
  const now = new Date()
  const expires = new Date(now.getTime() + 10 * 60 * 1000)
  await env.DB.prepare(
    `INSERT INTO oauth_states (state, created_at, expires_at, provider) VALUES (?, ?, ?, 'github')`,
  )
    .bind(state, now.toISOString(), expires.toISOString())
    .run()
  return state
}

type GithubTokenResponse = {
  access_token?: string
  scope?: string
  token_type?: string
  error?: string
  error_description?: string
}

export async function exchangeGithubCode(
  env: Env,
  origin: string,
  code: string,
): Promise<GithubTokenResponse> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${origin}/api/auth/github/callback`,
    }),
  })
  return (await res.json()) as GithubTokenResponse
}

export async function fetchGithubProfile(accessToken: string): Promise<{
  id: number
  login: string
  name: string | null
  email: string | null
  avatar_url: string | null
}> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Kyoketti',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!res.ok) throw new Error('Failed to fetch GitHub profile')
  const profile = (await res.json()) as {
    id: number
    login: string
    name: string | null
    email: string | null
    avatar_url: string | null
  }

  if (!profile.email) {
    const emailRes = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Kyoketti',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (emailRes.ok) {
      const emails = (await emailRes.json()) as Array<{
        email: string
        primary: boolean
        verified: boolean
      }>
      const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified)
      if (primary) profile.email = primary.email
    }
  }

  return profile
}

export function githubUserId(githubId: number): string {
  return `github:${githubId}`
}

export async function upsertUserFromGithub(
  env: Env,
  profile: {
    id: number
    login: string
    name: string | null
    email: string | null
    avatar_url: string | null
  },
  accessToken: string,
): Promise<UserRow> {
  const id = githubUserId(profile.id)
  const existing = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`)
    .bind(id)
    .first<UserRow>()
  const now = new Date().toISOString()
  const enc = await encryptSecret(accessToken, env.SESSION_SECRET)
  const name = profile.name || profile.login

  if (!existing) {
    await env.DB.prepare(
      `INSERT INTO users (id, email, name, picture, refresh_token_enc, provider, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'github', ?, ?)`,
    )
      .bind(id, profile.email ?? null, name, profile.avatar_url ?? null, enc, now, now)
      .run()
  } else {
    await env.DB.prepare(
      `UPDATE users SET email = ?, name = ?, picture = ?, refresh_token_enc = ?, provider = 'github', updated_at = ?
       WHERE id = ?`,
    )
      .bind(profile.email ?? null, name, profile.avatar_url ?? null, enc, now, id)
      .run()
  }

  const user = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<UserRow>()
  if (!user) throw new Error('Failed to persist GitHub user')
  return user
}

export async function getGithubAccessToken(
  env: Env,
  user: UserRow,
): Promise<{ accessToken: string; expiresIn: number }> {
  const accessToken = await decryptSecret(user.refresh_token_enc, env.SESSION_SECRET)
  const probe = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Kyoketti',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!probe.ok) {
    throw new Error('GitHub token expired or revoked. Sign in again.')
  }
  return { accessToken, expiresIn: 60 * 60 * 8 }
}
