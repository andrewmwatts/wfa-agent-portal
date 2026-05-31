import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

/**
 * Google Calendar API
 *
 *   POST /api/google-calendar   { title, description, startDateTime, endDateTime, guestEmail, timeZone }
 *     → creates a Google Calendar event for the authenticated user
 *
 *   DELETE /api/google-calendar
 *     → disconnects Google Calendar (clears stored tokens)
 */

async function getAccessToken(sb, userId) {
  const { data: userData, error } = await sb
    .from('users')
    .select('google_refresh_token')
    .eq('id', userId)
    .single()

  if (error || !userData?.google_refresh_token) {
    return { error: 'Google Calendar not connected. Please connect from your profile menu.' }
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: userData.google_refresh_token,
      grant_type:    'refresh_token',
    }),
  })

  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({}))
    if (err.error === 'invalid_grant') {
      // Token was revoked — clear it
      await sb
        .from('users')
        .update({ google_refresh_token: null, google_calendar_connected: false })
        .eq('id', userId)
      return { error: 'Google Calendar authorization has expired. Please reconnect from your profile menu.' }
    }
    return { error: 'Failed to refresh Google access token.' }
  }

  const { access_token } = await tokenRes.json()
  return { access_token }
}

export default async function handler(req, res) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const sb = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  const { data: { user }, error: authErr } = await sb.auth.getUser(token)
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })

  // ── DELETE: disconnect Google Calendar ────────────────────────────────────────

  if (req.method === 'DELETE') {
    const { error: dbErr } = await sb
      .from('users')
      .update({ google_refresh_token: null, google_calendar_connected: false })
      .eq('id', user.id)

    if (dbErr) return res.status(500).json({ error: dbErr.message })
    return res.status(200).json({ ok: true })
  }

  // ── POST: create a calendar event ─────────────────────────────────────────────

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { title, description, startDateTime, endDateTime, guestEmail, timeZone } = req.body ?? {}

  if (!title || !startDateTime || !endDateTime) {
    return res.status(400).json({ error: 'title, startDateTime, and endDateTime are required' })
  }

  const { access_token, error: tokenErr } = await getAccessToken(sb, user.id)
  if (tokenErr) return res.status(400).json({ error: tokenErr })

  const tz = timeZone || 'America/New_York'

  const event = {
    summary:     title,
    description: description || '',
    start:       { dateTime: startDateTime, timeZone: tz },
    end:         { dateTime: endDateTime,   timeZone: tz },
  }

  if (guestEmail?.trim()) {
    event.attendees = [{ email: guestEmail.trim() }]
  }

  const calRes = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all',
    {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    },
  )

  if (!calRes.ok) {
    const err = await calRes.json().catch(() => ({}))
    return res.status(500).json({ error: err.error?.message || 'Failed to create calendar event' })
  }

  const created = await calRes.json()
  return res.status(200).json({ eventId: created.id, htmlLink: created.htmlLink })
}
