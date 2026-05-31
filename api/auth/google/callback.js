import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../../../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../../../.env.local') })

/**
 * Google OAuth Callback
 *
 *   GET /api/auth/google/callback?code=...&state=...
 *     → exchanges authorization code for tokens, stores refresh token,
 *       then redirects back to the app with ?calendar=connected or ?calendar=error
 */

export default async function handler(req, res) {
  // Derive app base URL from the incoming request so we work on any environment
  const proto  = req.headers['x-forwarded-proto'] || 'http'
  const host   = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000'
  const appUrl = `${proto}://${host}`

  const { code, state, error: oauthError } = req.query

  if (oauthError) {
    return res.redirect(`${appUrl}?calendar=error&reason=${encodeURIComponent(oauthError)}`)
  }

  if (!code || !state) {
    return res.redirect(`${appUrl}?calendar=error&reason=missing_params`)
  }

  // Decode the state param to get userId
  let userId
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'))
    userId = parsed.userId
    if (!userId) throw new Error('no userId in state')
  } catch {
    return res.redirect(`${appUrl}?calendar=error&reason=invalid_state`)
  }

  const clientId     = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri  = process.env.GOOGLE_REDIRECT_URI

  if (!clientId || !clientSecret || !redirectUri) {
    return res.redirect(`${appUrl}?calendar=error&reason=server_config`)
  }

  // Exchange authorization code for tokens
  let refreshToken
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        code,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  redirectUri,
        grant_type:    'authorization_code',
      }),
    })

    if (!tokenRes.ok) {
      const text = await tokenRes.text()
      console.error('Token exchange failed:', text)
      return res.redirect(`${appUrl}?calendar=error&reason=token_exchange`)
    }

    const tokens = await tokenRes.json()
    refreshToken  = tokens.refresh_token

    if (!refreshToken) {
      console.error('No refresh_token in token response:', JSON.stringify(tokens))
      return res.redirect(`${appUrl}?calendar=error&reason=no_refresh_token`)
    }
  } catch (err) {
    console.error('Token exchange error:', err)
    return res.redirect(`${appUrl}?calendar=error&reason=token_exchange`)
  }

  // Store the refresh token and mark calendar as connected
  const sb = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  const { error: dbErr } = await sb
    .from('users')
    .update({ google_refresh_token: refreshToken, google_calendar_connected: true })
    .eq('id', userId)

  if (dbErr) {
    console.error('DB update failed:', dbErr.message)
    return res.redirect(`${appUrl}?calendar=error&reason=db_error`)
  }

  return res.redirect(`${appUrl}?calendar=connected`)
}
