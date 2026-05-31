import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

/**
 * Leads API  (consolidated: leads + lead-activity + lead-scripts)
 *
 * Leads
 *   GET    /api/leads?sfg_id=X
 *   POST   /api/leads
 *   PATCH  /api/leads?id=X
 *
 * Lead Activity  (?resource=activity)
 *   GET    /api/leads?resource=activity&lead_id=X
 *   POST   /api/leads?resource=activity
 *
 * Lead Scripts  (?resource=scripts)
 *   GET    /api/leads?resource=scripts&sfg_id=X
 *   POST   /api/leads?resource=scripts
 *   DELETE /api/leads?resource=scripts&id=X
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
  const { resource } = req.query

  // ── LEAD ACTIVITY ─────────────────────────────────────────────────────────
  if (resource === 'activity') {
    if (req.method === 'GET') {
      const { lead_id } = req.query
      if (!lead_id) return res.status(400).json({ error: 'lead_id required' })

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

    if (req.method === 'POST') {
      const { lead_id, sfg_id, activity_type, body, note, update_lead } = req.body ?? {}
      if (!lead_id || !activity_type || !body) {
        return res.status(400).json({ error: 'lead_id, activity_type, and body are required' })
      }

      const bypass = process.env.VITE_BYPASS_AUTH === 'true'
      if (!bypass) {
        const callerSfgId = await resolveCallerSfgId(req, sfg_id)
        if (!callerSfgId) return res.status(401).json({ error: 'Unauthorized' })
        const { data: lead } = await sb.from('leads').select('sfg_id').eq('id', lead_id).single()
        if (!lead || lead.sfg_id !== callerSfgId) return res.status(403).json({ error: 'Forbidden' })
      }

      const { data: entry, error: entryErr } = await sb
        .from('lead_activity')
        .insert({ lead_id, sfg_id: sfg_id ?? '', activity_type, body, note: note || null })
        .select()
        .single()

      if (entryErr) return res.status(500).json({ error: entryErr.message })

      const activityPatch = {
        last_activity_text: body,
        last_activity_at:   entry.created_at,
        updated_at:         new Date().toISOString(),
      }

      if (update_lead && Object.keys(update_lead).length) {
        await sb.from('leads').update({ ...update_lead, ...activityPatch }).eq('id', lead_id)
      } else {
        await sb.from('leads').update(activityPatch).eq('id', lead_id)
      }

      return res.status(201).json({ entry })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── LEAD SCRIPTS ──────────────────────────────────────────────────────────
  if (resource === 'scripts') {
    if (req.method === 'GET') {
      const sfgId = await resolveCallerSfgId(req, req.query.sfg_id)
      if (!sfgId) return res.status(401).json({ error: 'Unauthorized' })

      const { data, error } = await sb
        .from('lead_scripts')
        .select('*')
        .eq('sfg_id', sfgId)
        .order('category')
        .order('created_at')

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ scripts: data ?? [] })
    }

    if (req.method === 'POST') {
      const body = req.body ?? {}
      const sfgId = await resolveCallerSfgId(req, body.sfg_id)
      if (!sfgId) return res.status(401).json({ error: 'Unauthorized' })

      const { category, title, body: scriptBody, tag } = body
      if (!title?.trim() || !scriptBody?.trim()) {
        return res.status(400).json({ error: 'title and body are required' })
      }

      const { data, error } = await sb
        .from('lead_scripts')
        .insert({
          sfg_id:   sfgId,
          category: category?.trim() || 'General',
          title:    title.trim(),
          body:     scriptBody.trim(),
          tag:      tag?.trim() || null,
        })
        .select()
        .single()

      if (error) return res.status(500).json({ error: error.message })
      return res.status(201).json({ script: data })
    }

    if (req.method === 'DELETE') {
      const { id } = req.query
      if (!id) return res.status(400).json({ error: 'id required' })

      const bypass = process.env.VITE_BYPASS_AUTH === 'true'
      if (!bypass) {
        const sfgId = await resolveCallerSfgId(req, null)
        if (!sfgId) return res.status(401).json({ error: 'Unauthorized' })
        const { data: script } = await sb.from('lead_scripts').select('sfg_id').eq('id', id).single()
        if (!script || script.sfg_id !== sfgId) return res.status(403).json({ error: 'Forbidden' })
      }

      const { error } = await sb.from('lead_scripts').delete().eq('id', id)
      if (error) return res.status(500).json({ error: error.message })
      return res.status(204).end()
    }

    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── BULK IMPORT ───────────────────────────────────────────────────────────
  if (req.method === 'POST' && req.query.action === 'bulk') {
    const body   = req.body ?? {}
    const sfgId  = (body.sfg_id ?? '').toString().trim().toUpperCase()
    const leads  = Array.isArray(body.leads) ? body.leads : []

    if (!sfgId)        return res.status(400).json({ error: 'sfg_id is required' })
    if (!leads.length) return res.status(400).json({ error: 'No leads provided' })

    // Verify caller is super_admin (or bypass for dev)
    const bypass = process.env.VITE_BYPASS_AUTH === 'true'
    if (!bypass) {
      const callerSfgId = await resolveCallerSfgId(req, null)
      if (!callerSfgId) return res.status(401).json({ error: 'Unauthorized' })
      const { data: caller } = await sb.from('users').select('role').eq('sfg_id', callerSfgId).single()
      if (caller?.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden: super_admin required' })
    }

    // Fetch existing phones for this agent to detect duplicates
    const { data: existing } = await sb
      .from('leads')
      .select('phone')
      .eq('sfg_id', sfgId)
    const existingPhones = new Set((existing ?? []).map(r => r.phone))

    const toInsert = []
    let skipped = 0

    for (const lead of leads) {
      if (!lead.name || !lead.phone) { skipped++; continue }
      if (existingPhones.has(lead.phone)) { skipped++; continue }
      existingPhones.add(lead.phone) // prevent dupes within this batch
      const now = new Date().toISOString()
      toInsert.push({
        ...lead,
        sfg_id:     sfgId,
        created_at: now,
        updated_at: now,
      })
    }

    let inserted = []
    let errors   = 0

    if (toInsert.length) {
      // Insert in chunks to stay within Supabase payload limits
      const CHUNK = 200
      for (let i = 0; i < toInsert.length; i += CHUNK) {
        const { data: chunk, error: chunkErr } = await sb
          .from('leads')
          .insert(toInsert.slice(i, i + CHUNK))
          .select()
        if (chunkErr) {
          errors += toInsert.slice(i, i + CHUNK).length
        } else {
          inserted = inserted.concat(chunk ?? [])
        }
      }
    }

    return res.status(200).json({ inserted, skipped, errors })
  }

  // ── LEADS ─────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const sfgId = await resolveCallerSfgId(req, req.query.sfg_id)
    if (!sfgId) return res.status(401).json({ error: 'Unauthorized' })

    const { category } = req.query
    let query = sb.from('leads').select('*').eq('sfg_id', sfgId)
    if (category) query = query.eq('category', category)
    query = query.order('added', { ascending: false }).order('id', { ascending: false })
    const { data, error } = await query

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ leads: data ?? [] })
  }

  if (req.method === 'POST') {
    const body = req.body ?? {}
    const sfgId = await resolveCallerSfgId(req, body.sfg_id)
    if (!sfgId) return res.status(401).json({ error: 'Unauthorized' })

    const { name, ...fields } = body
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' })

    const { data, error } = await sb
      .from('leads')
      .insert({
        sfg_id:     sfgId,
        name:       name.trim(),
        ...fields,
        added:      fields.added || new Date().toISOString().slice(0, 10),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(201).json({ lead: data })
  }

  if (req.method === 'PATCH') {
    const { id } = req.query
    if (!id) return res.status(400).json({ error: 'id required' })

    const bypass = process.env.VITE_BYPASS_AUTH === 'true'
    const patch = { ...req.body }
    delete patch.id
    delete patch.sfg_id
    delete patch.created_at
    patch.updated_at = new Date().toISOString()

    if (!bypass) {
      const sfgId = await resolveCallerSfgId(req, null)
      if (!sfgId) return res.status(401).json({ error: 'Unauthorized' })

      const { data, error } = await sb
        .from('leads')
        .update(patch)
        .eq('id', id)
        .eq('sfg_id', sfgId)
        .select()
        .single()

      if (error) return res.status(500).json({ error: error.message })
      if (!data)  return res.status(404).json({ error: 'Lead not found' })
      return res.status(200).json({ lead: data })
    }

    const { data, error } = await sb
      .from('leads')
      .update(patch)
      .eq('id', id)
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ lead: data })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
