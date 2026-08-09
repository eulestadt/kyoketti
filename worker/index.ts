import type { Env } from './types'
import {
  appOrigin,
  clearSessionCookie,
  clearVault,
  consumeOauthState,
  createOauthState,
  createSession,
  destroySession,
  exchangeCode,
  fetchGoogleProfile,
  getDriveAccessToken,
  getUserBySession,
  googleAuthUrl,
  json,
  readSessionId,
  saveVault,
  setSessionCookie,
  toPublicUser,
  toVault,
  upsertUserFromGoogle,
} from './auth'

async function requireUser(request: Request, env: Env) {
  const sessionId = readSessionId(request)
  if (!sessionId) return { error: json({ error: 'Unauthorized' }, { status: 401 }) }
  const user = await getUserBySession(env, sessionId)
  if (!user) return { error: json({ error: 'Unauthorized' }, { status: 401 }) }
  return { user, sessionId }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request)
    }

    try {
      if (url.pathname === '/api/health' && request.method === 'GET') {
        return json({ ok: true })
      }

      if ((url.pathname === '/api/auth/login') && (request.method === 'GET' || request.method === 'HEAD')) {
        const origin = appOrigin(request, env)
        const forceConsent = url.searchParams.get('consent') === '1'
        const state = await createOauthState(env)
        return new Response(null, {
          status: 302,
          headers: {
            Location: googleAuthUrl(origin, state, env.GOOGLE_CLIENT_ID, forceConsent),
            'Cache-Control': 'no-store',
          },
        })
      }

      if (url.pathname === '/api/auth/callback' && request.method === 'GET') {
        const origin = appOrigin(request, env)
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        const oauthError = url.searchParams.get('error')
        if (oauthError) {
          return Response.redirect(`${origin}/?authError=${encodeURIComponent(oauthError)}`, 302)
        }
        if (!code || !state || !(await consumeOauthState(env, state))) {
          return Response.redirect(`${origin}/?authError=invalid_state`, 302)
        }

        const token = await exchangeCode(env, origin, code)
        if (!token.access_token) {
          const message = token.error_description || token.error || 'token_exchange_failed'
          return Response.redirect(`${origin}/?authError=${encodeURIComponent(message)}`, 302)
        }

        try {
          const profile = await fetchGoogleProfile(token.access_token)
          const user = await upsertUserFromGoogle(env, profile, token.refresh_token)
          const sessionId = await createSession(env, user.id)
          const headers = new Headers({ Location: `${origin}/` })
          headers.append('Set-Cookie', setSessionCookie(sessionId))
          return new Response(null, { status: 302, headers })
        } catch (err) {
          const message = err instanceof Error ? err.message : 'login_failed'
          if (message.toLowerCase().includes('refresh token')) {
            return Response.redirect(`${origin}/api/auth/login?consent=1`, 302)
          }
          return Response.redirect(`${origin}/?authError=${encodeURIComponent(message)}`, 302)
        }
      }

      if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
        const sessionId = readSessionId(request)
        if (sessionId) await destroySession(env, sessionId)
        return json(
          { ok: true },
          { headers: { 'Set-Cookie': clearSessionCookie() } },
        )
      }

      if (url.pathname === '/api/auth/me' && request.method === 'GET') {
        const sessionId = readSessionId(request)
        if (!sessionId) return json({ user: null, vault: null })
        const user = await getUserBySession(env, sessionId)
        if (!user) {
          return json(
            { user: null, vault: null },
            { headers: { 'Set-Cookie': clearSessionCookie() } },
          )
        }
        return json({
          user: toPublicUser(user),
          vault: toVault(user),
        })
      }

      if (url.pathname === '/api/auth/drive-token' && request.method === 'POST') {
        const auth = await requireUser(request, env)
        if ('error' in auth && auth.error) return auth.error
        const tokens = await getDriveAccessToken(env, auth.user!)
        return json(tokens)
      }

      if (url.pathname === '/api/vault' && request.method === 'PUT') {
        const auth = await requireUser(request, env)
        if ('error' in auth && auth.error) return auth.error
        const body = (await request.json()) as { folderId?: string; folderName?: string }
        if (!body.folderId || !body.folderName) {
          return json({ error: 'folderId and folderName are required' }, { status: 400 })
        }
        await saveVault(env, auth.user!.id, body.folderId, body.folderName)
        return json({ ok: true, vault: { folderId: body.folderId, folderName: body.folderName } })
      }

      if (url.pathname === '/api/vault' && request.method === 'DELETE') {
        const auth = await requireUser(request, env)
        if ('error' in auth && auth.error) return auth.error
        await clearVault(env, auth.user!.id)
        return json({ ok: true })
      }

      return json({ error: 'Not found' }, { status: 404 })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Server error'
      return json({ error: message }, { status: 500 })
    }
  },
}
