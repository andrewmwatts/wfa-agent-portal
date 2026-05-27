import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

/**
 * Personnel API  (consolidated: personnel-data + update-personnel + import-agents)
 *
 *   GET  /api/personnel?root=X&mode=master   → full personnel tree / filtered list
 *   PUT  /api/personnel                      → update single agent fields
 *   POST /api/personnel                      → bulk upsert agents (import)
 */

// ── Promotion map builder ─────────────────────────────────────────────────────

function buildPromotionMaps(promoRows) {
  const milestones       = {}
  const named_milestones = {}

  for (const row of promoRows) {
    const { promotion_type, level, month_1, month_2, month_3, slingshot_month, is_slingshot } = row
    const arr = []
    arr.push(month_1 ?? '')
    arr.push(is_slingshot ? (slingshot_month ?? '') : (month_2 ?? ''))
    if (month_3 != null) arr.push(month_3 ?? '')

    if (promotion_type === 'commission') {
      milestones[String(level)] = arr
    } else {
      named_milestones[String(level).toUpperCase()] = arr
    }
  }

  return { milestones, named_milestones }
}

// ── Tree traversal ────────────────────────────────────────────────────────────

function isOwnerFromData(record) {
  const ao = record.named_milestones?.AO ?? []
  return !!(ao[0] && ao[1])
}

function computeMasterAgency(rootSfgId, allPersonnel) {
  const childrenOf = {}
  for (const p of allPersonnel) {
    const up = p.upline_sfg_id?.trim().toLowerCase()
    if (!up) continue
    if (!childrenOf[up]) childrenOf[up] = []
    childrenOf[up].push(p.sfg_id.toLowerCase())
  }
  const root = rootSfgId.toLowerCase()
  const result = new Set()
  function traverse(id) {
    result.add(id)
    for (const child of (childrenOf[id] ?? [])) traverse(child)
  }
  traverse(root)
  return result
}

function computeBaseshop(rootSfgId, allPersonnel, ownerSet) {
  const childrenOf = {}
  for (const p of allPersonnel) {
    const up = p.upline_sfg_id?.trim().toLowerCase()
    if (!up) continue
    if (!childrenOf[up]) childrenOf[up] = []
    childrenOf[up].push(p.sfg_id.toLowerCase())
  }
  const root = rootSfgId.toLowerCase()
  const result = new Set()
  function traverse(id) {
    result.add(id)
    for (const child of (childrenOf[id] ?? [])) {
      if (ownerSet.has(child) && child !== root) continue
      traverse(child)
    }
  }
  traverse(root)
  return result
}

// ── Allowed fields for update-personnel ──────────────────────────────────────

const ALLOWED_FIELDS = new Set([
  'hire_date', 'upline_sfg_id', 'profile_issues', 'no_eando',
  'contracting_to_producer', 'contracting_complete', 'surelc_profile_date',
])

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  // ── GET — personnel data ───────────────────────────────────────────────────
  if (req.method === 'GET') {
    const rootParam    = req.query.root?.trim()
    const masterMode   = req.query.mode === 'master'
    const sfgIdsParam  = req.query.sfg_ids ?? req.query.sfg_id ?? ''
    const requestedIds = sfgIdsParam
      ? sfgIdsParam.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
      : []

    try {
      const { data: personnelRows, error: personnelError } = await supabase
        .from('personnel')
        .select('sfg_id, preferred_name, opt_name, upline_sfg_id, hire_date, birth_date, npn, surelc_profile_date, profile_issues, no_eando, contracting_to_producer, contracting_complete, status')

      if (personnelError) throw personnelError
      if (!personnelRows?.length) return res.status(200).json([])

      const { data: promoRows, error: promoError } = await supabase
        .from('agent_promotions')
        .select('sfg_id, promotion_type, level, month_1, month_2, month_3, slingshot_month, is_slingshot')

      if (promoError) throw promoError

      const promosBySfgId = {}
      for (const row of (promoRows ?? [])) {
        const id = row.sfg_id?.trim().toLowerCase()
        if (!id) continue
        ;(promosBySfgId[id] ??= []).push(row)
      }

      const nameById = {}
      for (const p of personnelRows) {
        const id = p.sfg_id?.trim().toLowerCase()
        if (id) nameById[id] = p.preferred_name?.trim() || p.opt_name?.trim() || ''
      }

      const all = personnelRows.map(p => {
        const id = p.sfg_id?.trim().toLowerCase()
        const { milestones, named_milestones } = buildPromotionMaps(promosBySfgId[id] ?? [])
        const uplineId   = p.upline_sfg_id?.trim().toLowerCase() ?? ''
        const uplineName = uplineId ? (nameById[uplineId] ?? '') : ''
        return {
          sfg_id:                  p.sfg_id?.trim()           ?? '',
          name:                    p.preferred_name?.trim()   || p.opt_name?.trim() || '',
          preferred_name:          p.preferred_name?.trim()   ?? '',
          opt_name:                p.opt_name?.trim()         ?? '',
          upline_sfg_id:           p.upline_sfg_id?.trim()    ?? '',
          upline_name:             uplineName,
          hire_date:               p.hire_date                ?? '',
          birth_date:              p.birth_date               ?? '',
          npn:                     p.npn?.trim()              ?? '',
          surelc_profile_date:     p.surelc_profile_date      ?? '',
          profile_issues:          p.profile_issues?.trim()   ?? '',
          no_eando:                p.no_eando ?? false,
          contracting_to_producer: p.contracting_to_producer  ?? '',
          contracting_complete:    p.contracting_complete      ?? '',
          milestones,
          named_milestones,
        }
      })

      let results
      if (rootParam) {
        if (masterMode) {
          const masterIds = computeMasterAgency(rootParam, all)
          results = all.filter(p => masterIds.has(p.sfg_id.toLowerCase()))
        } else {
          const sheetOwnerIds = all.filter(isOwnerFromData).map(p => p.sfg_id.toLowerCase())
          const { data: portalOwners } = await supabase
            .from('users')
            .select('sfg_id')
            .in('role', ['owner', 'super_admin'])
          const ownerSet = new Set([
            ...sheetOwnerIds,
            ...(portalOwners ?? []).map(u => u.sfg_id?.toLowerCase()).filter(Boolean),
          ])
          const baseshopIds = computeBaseshop(rootParam, all, ownerSet)
          results = all.filter(p => baseshopIds.has(p.sfg_id.toLowerCase()))
        }
      } else if (requestedIds.length) {
        results = all.filter(p => requestedIds.includes(p.sfg_id.toLowerCase()))
      } else {
        results = all
      }

      return res.status(200).json(results)
    } catch (err) {
      console.error('[personnel/get]', err)
      return res.status(500).json({ error: 'Failed to read personnel data' })
    }
  }

  // ── PUT — update single agent ──────────────────────────────────────────────
  if (req.method === 'PUT') {
    const { sfg_id, updates } = req.body ?? {}

    if (!sfg_id?.trim()) return res.status(400).json({ error: 'sfg_id is required' })
    if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'updates object is required' })
    }

    const patch = {}
    for (const [key, val] of Object.entries(updates)) {
      if (!ALLOWED_FIELDS.has(key)) continue
      if (key === 'no_eando') {
        if (typeof val === 'boolean') {
          patch[key] = val
        } else {
          const s = String(val ?? '').toLowerCase()
          patch[key] = ['true', 'yes', 'y', '1', 'x'].includes(s)
        }
      } else if (['hire_date', 'contracting_to_producer', 'contracting_complete', 'surelc_profile_date'].includes(key)) {
        patch[key] = val?.trim() || null
      } else {
        patch[key] = val?.trim() || null
      }
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' })
    }

    try {
      const { data, error } = await supabase
        .from('personnel')
        .update(patch)
        .eq('sfg_id', sfg_id.trim().toUpperCase())
        .select()
        .single()
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ personnel: data })
    } catch (err) {
      console.error('[personnel/put]', err)
      return res.status(500).json({ error: 'Failed to update personnel data' })
    }
  }

  // ── POST — bulk upsert agents ──────────────────────────────────────────────
  if (req.method === 'POST') {
    let rows, statusUpdates
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
      rows          = body.rows
      statusUpdates = body.statusUpdates
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' })
    }

    if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows must be an array' })

    try {
      let inserted = 0, skipped = 0
      const errors = []

      if (rows.length > 0) {
        const { data, error } = await supabase
          .from('personnel')
          .upsert(rows, { onConflict: 'sfg_id', ignoreDuplicates: true })
          .select('sfg_id')
        if (error) throw error
        inserted = data?.length ?? 0
        skipped  = rows.length - inserted
      }

      let statusUpdated = 0
      if (Array.isArray(statusUpdates) && statusUpdates.length > 0) {
        for (const { sfg_id, status } of statusUpdates) {
          const { error } = await supabase.from('personnel').update({ status }).eq('sfg_id', sfg_id)
          if (error) { errors.push({ sfg_id, error: error.message }) } else { statusUpdated++ }
        }
      }

      return res.status(200).json({ inserted, skipped, statusUpdated, errors })
    } catch (err) {
      console.error('[personnel/post]', err)
      return res.status(500).json({ error: 'Failed to import agents' })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
