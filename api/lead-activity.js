import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

/**
 * Lead Activity API
 *
 * GET  /api/lead-activity?lead_id=X        → { activity: [...] }
 * POST /api/lead-activity                   → { entry }
 *      body: { lead_id, sfg_id, type, body, note?, update_lead? }
 *      update_lead: partial lead fields to PATCH at the same time
 */

const sb = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

async function resolveCallerSfgId(req, fallback) {
  if (process.env.VITE_BYPASS_AUTH === 'true') {
    return fallback ? String(fallback).trim().toUpperCase() : null
  }
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data: { user }, error } = await sb.auth.getUser(token)
  if (error || !user) return null
  const { data } = await sb.from('users').select('sfg_id').eq('id', user.id).single()
  return data?.sfg_id?.toUpperCase() ?? null
}

export default async function handler(req, res) {
  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { lead_id } = req.query
    if (!lead_id) return res.status(400).json({ error: 'lead_id required' })

    // Verify the caller owns the lead
    const bypass = process.env.VITE_BYPASS_AUTH === 'true'
    if (!bypass) {
      const sfgId = await resolveCallerSfgId(req, null)
      if (!sfgId) return res.status(401).json({ error: 'Unauthorized' })
      const { data: lead } = await sb.from('leads').select('sfg_id').eq('id', lead_id).single()
      if (!lead || lead.sfg_id !== sfgId) return res.status(403).json({ error: 'Forbidden' })
    }

    const { data, error } = await sb
      .from('lead_activity')
      .select('*')
      .eq('lead_id', lead_id)
      .order('created_at', { ascending: false })

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ activity: data ?? [] })
  }

  // ── POST ──────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { lead_id, sfg_id, activity_type, body, note, update_lead } = req.body ?? {}
    if (!lead_id || !activity_type || !body) {
      return res.status(400).json({ error: 'lead_id, activity_type, and body are required' })
    }

    // Verify caller owns the lead
    const bypassPost = process.env.VITE_BYPASS_AUTH === 'true'
    if (!bypassPost) {
      const callerSfgId = await resolveCallerSfgId(req, sfg_id)
      if (!callerSfgId) return res.status(401).json({ error: 'Unauthorized' })
      const { data: lead } = await sb.from('leads').select('sfg_id').eq('id', lead_id).single()
      if (!lead || lead.sfg_id !== callerSfgId) return res.status(403).json({ error: 'Forbidden' })
    }

    // Insert activity entry
    const { data: entry, error: entryErr } = await sb
      .from('lead_activity')
      .insert({
        lead_id,
        sfg_id: sfg_id ?? '',
        activity_type,
        body,
        note: note || null,
      })
      .select()
      .single()

    if (entryErr) return res.status(500).json({ error: entryErr.message })

    // Optionally update the lead in the same request
    if (update_lead && Object.keys(update_lead).length) {
      const patch = {
        ...update_lead,
        last_activity_text: body,
        last_activity_at:   entry.created_at,
        updated_at:         new Date().toISOString(),
      }
      await sb.from('leads').update(patch).eq('id', lead_id)
    } else {
      // Always update denormalized activity fields on the lead
      await sb
        .from('leads')
        .update({
          last_activity_text: body,
          last_activity_at:   entry.created_at,
          updated_at:         new Date().toISOString(),
        })
        .eq('id', lead_id)
    }

    return res.status(201).json({ entry })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
