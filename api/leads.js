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
 *   GET    /api/leads?action=hire_candidates&upline_sfg_id=X  → recruiting leads eligible for matching
 *   GET    /api/leads?action=unlinked_hires&sfg_id=X          → personnel with no hired_sfg_id lead
 *   POST   /api/leads
 *   POST   /api/leads?action=create_stub                      → insert stub lead for unmatched hire
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

// Token → sfgId cache — avoids two sequential Supabase calls (auth.getUser + users lookup)
// on every leads/scripts request. Keyed by bearer token with a 10-minute TTL.
const tokenCache = new Map()
const TOKEN_TTL  = 10 * 60 * 1000

async function resolveCallerSfgId(req, fallback) {
  if (process.env.VITE_BYPASS_AUTH === 'true') {
    return fallback ? String(fallback).trim().toUpperCase() : null
  }
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return null

  const hit = tokenCache.get(token)
  if (hit && hit.exp > Date.now()) return hit.sfgId

  const { data: { user }, error } = await sb.auth.getUser(token)
  if (error || !user) return null
  const { data } = await sb.from('users').select('sfg_id').eq('id', user.id).single()
  const sfgId = data?.sfg_id?.toUpperCase() ?? null
  if (sfgId) tokenCache.set(token, { sfgId, exp: Date.now() + TOKEN_TTL })
  return sfgId
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

  // ── HIRE CANDIDATE LOOKUP ─────────────────────────────────────────────────
  // Returns recruiting leads owned by upline_sfg_id that are not yet linked
  // and not Dead — used as the candidate pool for fuzzy name matching.
  if (req.method === 'GET' && req.query.action === 'hire_candidates') {
    const callerSfgId = await resolveCallerSfgId(req, req.query.sfg_id)
    if (!callerSfgId) return res.status(401).json({ error: 'Unauthorized' })

    const uplineSfgId = (req.query.upline_sfg_id ?? '').trim().toUpperCase()
    if (!uplineSfgId) return res.status(400).json({ error: 'upline_sfg_id required' })

    const { data, error } = await sb
      .from('leads')
      .select('id, name, phone, email, state, city, added, source, status')
      .eq('sfg_id', uplineSfgId)
      .eq('category', 'recruiting')
      .is('hired_sfg_id', null)
      .neq('status', 'dead')
      .order('added', { ascending: false })

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ candidates: data ?? [] })
  }

  // ── UNLINKED HIRES LOOKUP ─────────────────────────────────────────────────
  // Returns personnel who are direct reports of sfg_id and have no lead with
  // hired_sfg_id set, ordered by hire_date desc.
  if (req.method === 'GET' && req.query.action === 'unlinked_hires') {
    const callerSfgId = await resolveCallerSfgId(req, req.query.sfg_id)
    if (!callerSfgId) return res.status(401).json({ error: 'Unauthorized' })

    const ownerSfgId = (req.query.sfg_id ?? '').trim().toUpperCase() || callerSfgId

    // Fetch direct-report personnel
    const { data: personnel, error: pErr } = await sb
      .from('personnel')
      .select('sfg_id, preferred_name, hire_date, upline_sfg_id')
      .eq('upline_sfg_id', ownerSfgId)
      .order('hire_date', { ascending: false })

    if (pErr) return res.status(500).json({ error: pErr.message })
    if (!personnel?.length) return res.status(200).json({ unlinked: [] })

    // Fetch which sfg_ids already have a linked lead
    const { data: linked } = await sb
      .from('leads')
      .select('hired_sfg_id')
      .in('hired_sfg_id', personnel.map(p => p.sfg_id))
      .not('hired_sfg_id', 'is', null)

    const linkedSet = new Set((linked ?? []).map(r => r.hired_sfg_id))
    const unlinked  = personnel.filter(p => !linkedSet.has(p.sfg_id))

    return res.status(200).json({ unlinked })
  }

  // ── CREATE STUB ───────────────────────────────────────────────────────────
  if (req.method === 'POST' && req.query.action === 'create_stub') {
    const callerSfgId = await resolveCallerSfgId(req, req.body?.sfg_id)
    if (!callerSfgId) return res.status(401).json({ error: 'Unauthorized' })

    const { upline_sfg_id, name, hire_date, hired_sfg_id } = req.body ?? {}
    if (!upline_sfg_id || !name || !hired_sfg_id) {
      return res.status(400).json({ error: 'upline_sfg_id, name, and hired_sfg_id are required' })
    }

    const now = new Date().toISOString()
    const { data, error } = await sb
      .from('leads')
      .insert({
        sfg_id:       upline_sfg_id.trim().toUpperCase(),
        name:         name.trim(),
        hire_date:    hire_date || null,
        hired_sfg_id: hired_sfg_id.trim().toUpperCase(),
        is_stub:      true,
        source:       'stub',
        category:     'recruiting',
        lead_type:    'recruiting',
        status:       'hired',
        added:        now.slice(0, 10),
        created_at:   now,
        updated_at:   now,
      })
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(201).json({ lead: data })
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
    // Verify the caller is authenticated, then honour the requested sfg_id.
    // resolveCallerSfgId() in production resolves from the JWT (the logged-in
    // user), ignoring the query param. For "view as" scenarios (e.g. directors
    // viewing a downline owner's leads) we need to use the requested sfg_id
    // instead of locking to the caller's own identity.
    const bypass = process.env.VITE_BYPASS_AUTH === 'true'
    if (!bypass) {
      const callerSfgId = await resolveCallerSfgId(req, null)
      if (!callerSfgId) return res.status(401).json({ error: 'Unauthorized' })
    }
    const sfgId = req.query.sfg_id
      ? req.query.sfg_id.trim().toUpperCase()
      : await resolveCallerSfgId(req, null)
    if (!sfgId) return res.status(401).json({ error: 'Unauthorized' })

    const { category, include } = req.query

    // ?include=scripts returns leads + scripts in one round-trip so the page
    // doesn't need a second fetch to the same function.
    // For recruiting leads, also merges contracting fields from personnel for
    // any lead that has hired_sfg_id set.
    if (include === 'scripts') {
      let leadsQuery = sb.from('leads').select('*').eq('sfg_id', sfgId)
      if (category) leadsQuery = leadsQuery.eq('category', category)
      leadsQuery = leadsQuery.order('added', { ascending: false }).order('id', { ascending: false })

      const [{ data: rawLeads, error: leadsErr }, { data: scripts, error: scriptsErr }] = await Promise.all([
        leadsQuery,
        sb.from('lead_scripts').select('*').eq('sfg_id', sfgId).order('category').order('created_at'),
      ])
      if (leadsErr)   return res.status(500).json({ error: leadsErr.message })
      if (scriptsErr) return res.status(500).json({ error: scriptsErr.message })

      // Merge contracting fields for hired leads
      let leads = rawLeads ?? []
      const hiredIds = leads.map(l => l.hired_sfg_id).filter(Boolean)
      if (hiredIds.length > 0) {
        const { data: personnel } = await sb
          .from('personnel')
          .select('sfg_id, preferred_name, surelc_profile_date, contracting_to_producer, contracting_complete, no_eando, profile_issues')
          .in('sfg_id', hiredIds)
        if (personnel?.length) {
          const byId = Object.fromEntries(personnel.map(p => [p.sfg_id, p]))
          leads = leads.map(l =>
            l.hired_sfg_id && byId[l.hired_sfg_id]
              ? { ...l, contracting: byId[l.hired_sfg_id] }
              : l
          )
        }
      }

      return res.status(200).json({ leads, scripts: scripts ?? [] })
    }

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
