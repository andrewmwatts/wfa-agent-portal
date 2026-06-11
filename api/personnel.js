import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, authorizeScope, getAllowedSfgIds, requireSuperAdmin } from './_auth.js'

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

    if (is_slingshot) {
      // For slingshot rows the qualifying month is month_1 when present, otherwise the
      // slingshot month itself.  Both slots being equal triggers "(SS)" in the display.
      arr.push(month_1 ?? slingshot_month ?? '')
      arr.push(slingshot_month ?? '')
    } else {
      arr.push(month_1 ?? '')
      arr.push(month_2 ?? '')
      // Only push month_3 when it has real content — an empty string would fail allFilled
      if (month_3?.trim()) arr.push(month_3)
    }

    if (promotion_type === 'commission') {
      milestones[String(level)] = arr
    } else {
      named_milestones[String(level).toUpperCase()] = arr
    }
  }

  return { milestones, named_milestones }
}

// ── Policy fetch (mirrors api/policies.js — used for ?include=policies) ──────

const POLICY_COLS = [
  'id', 'sfg_id', 'applicant', 'carrier', 'policy_name', 'policy_number',
  'face_amount', 'submitted_apv', 'issued_apv', 'status',
  'submit_date', 'submit_week', 'submit_week_num', 'issue_date', 'last_update',
  'application_notes', 'policy_notes', 'not_in_opt', 'split_reset', 'chargeback_exempt',
  'conservation_status', 'conservation_date',
  'snapshot_chargeback_month', 'snapshot_chargeback_apv',
].join(', ')

async function fetchPolicies(supabase, sfgIds) {
  const PAGE = 10000
  const rows = []
  let from = 0
  while (true) {
    let q = supabase.from('policies').select(POLICY_COLS).order('id')
    if (sfgIds?.length) q = q.in('sfg_id', sfgIds.map(id => id.toUpperCase()))
    const { data, error } = await q.range(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return rows
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

// Direct DB column names (personnel table)
const ALLOWED_FIELDS = new Set([
  'preferred_name', 'opt_name',
  'hire_date', 'birth_date', 'npn',
  'upline_sfg_id', 'profile_issues', 'no_eando',
  'contracting_to_producer', 'contracting_complete', 'surelc_profile_date',
  'phone', 'address', 'city', 'state', 'zip', 'status',
])

// Frontend key → DB column (for fields whose names differ)
const FIELD_MAP = { name: 'preferred_name' }

const DATE_FIELDS = new Set(['hire_date', 'birth_date', 'contracting_to_producer', 'contracting_complete', 'surelc_profile_date'])

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const caller = await requireAuth(req, res)
  if (!caller) return

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  // ── GET ?action=contract_counts — core-carrier contract count per agent ──────
  // Returns { counts: { [sfg_id]: number } } for a set of agents.
  // Used by the Contracting page table to show "X of 11" progress.
  if (req.method === 'GET' && req.query.action === 'contract_counts') {
    const sfgIdsParam = req.query.sfg_ids ?? ''
    const sfgIds = sfgIdsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    if (!sfgIds.length) return res.status(200).json({ counts: {} })
    if (!(await authorizeScope(req, res, caller, supabase, sfgIds))) return

    try {
      // Fetch core carrier names
      const { data: carriers, error: cErr } = await supabase
        .from('carriers')
        .select('name')
      if (cErr) throw cErr
      const coreCarriers = (carriers ?? []).map(c => c.name)

      // Fetch contract numbers for these agents restricted to core carriers
      const { data: cns, error: cnErr } = await supabase
        .from('contract_numbers')
        .select('sfg_id, carrier')
        .in('sfg_id', sfgIds)
        .in('carrier', coreCarriers)
      if (cnErr) throw cnErr

      // Count distinct core carriers per agent + track which carriers each agent has
      const counts = {}
      const agentCarrierMap = {}
      for (const row of cns ?? []) {
        const id = row.sfg_id
        if (!counts[id]) { counts[id] = new Set(); agentCarrierMap[id] = [] }
        counts[id].add(row.carrier)
        agentCarrierMap[id].push(row.carrier)
      }
      const result = {}
      const carrierSets = {}
      for (const [id, set] of Object.entries(counts)) {
        result[id] = set.size
        carrierSets[id] = [...set]
      }

      return res.status(200).json({ counts: result, carrierSets, total: coreCarriers.length, coreCarriers })
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  // ── PUT ?action=upsert_contract — save or clear a single contract number ──────
  if (req.method === 'PUT' && req.query.action === 'upsert_contract') {
    const { sfg_id, carrier, contract_number } = req.body ?? {}
    if (!sfg_id || !carrier) return res.status(400).json({ error: 'sfg_id and carrier required' })
    if (!(await authorizeScope(req, res, caller, supabase, [sfg_id.trim().toUpperCase()]))) return

    try {
      if (!contract_number?.trim()) {
        // Empty → delete the record
        const { error } = await supabase
          .from('contract_numbers')
          .delete()
          .eq('sfg_id', sfg_id.trim().toUpperCase())
          .eq('carrier', carrier.trim())
        if (error) throw error
      } else {
        // Non-empty → upsert
        const { error } = await supabase
          .from('contract_numbers')
          .upsert(
            {
              sfg_id:          sfg_id.trim().toUpperCase(),
              carrier:         carrier.trim(),
              contract_number: contract_number.trim(),
              source:          'manual',
            },
            { onConflict: 'sfg_id,carrier,contract_number' },
          )
        if (error) throw error
      }
      return res.status(200).json({ ok: true })
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  // ── GET ?action=contracts — contract numbers + carriers for one agent ────────
  if (req.method === 'GET' && req.query.action === 'contracts') {
    const sfgId = req.query.sfg_id?.trim().toUpperCase()
    if (!sfgId) return res.status(400).json({ error: 'sfg_id required' })
    if (!(await authorizeScope(req, res, caller, supabase, [sfgId]))) return

    try {
      const [{ data: cnData, error: cnErr }, { data: carrierData, error: cErr }] = await Promise.all([
        supabase
          .from('contract_numbers')
          .select('carrier, contract_number, effective_date, source')
          .eq('sfg_id', sfgId)
          .order('carrier')
          .order('contract_number', { ascending: false }),
        supabase
          .from('carriers')
          .select('name, alert_threshold_days')
          .order('name'),
      ])

      if (cnErr)  return res.status(500).json({ error: cnErr.message })
      if (cErr)   return res.status(500).json({ error: cErr.message })

      // Keep only the alphanumerically highest contract number per carrier
      const best = {}
      for (const row of cnData ?? []) {
        if (!best[row.carrier]) best[row.carrier] = row
      }

      return res.status(200).json({
        contracts: best,           // { [carrierName]: { carrier, contract_number, effective_date, source } }
        carriers:  carrierData ?? [],
      })
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  // ── GET — personnel data ───────────────────────────────────────────────────
  if (req.method === 'GET') {
    const rootParam    = req.query.root?.trim()
    const masterMode   = req.query.mode === 'master'
    const sfgIdsParam  = req.query.sfg_ids ?? req.query.sfg_id ?? ''
    const requestedIds = sfgIdsParam
      ? sfgIdsParam.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
      : []

    // Authorize the requested scope. root=X → X must be in scope (its subtree is
    // a subset). Explicit ids → each must be in scope. Neither → super_admin only.
    {
      const scopeIds = rootParam ? [rootParam] : requestedIds
      if (scopeIds.length) {
        if (!(await authorizeScope(req, res, caller, supabase, scopeIds))) return
      } else {
        const allowed = await getAllowedSfgIds(caller, supabase)
        if (allowed !== null) return res.status(403).json({ error: 'Forbidden' })
      }
    }

    try {
      // For direct sfg_id lookups (no tree traversal needed), filter at the DB level
      // so we don't fetch every row in both tables just to filter them in JS.
      const PERS_COLS  = 'sfg_id, preferred_name, opt_name, upline_sfg_id, hire_date, birth_date, npn, surelc_profile_date, profile_issues, no_eando, contracting_to_producer, contracting_complete, status, phone, address, city, state, zip'
      const PROMO_COLS = 'sfg_id, promotion_type, level, month_1, month_2, month_3, slingshot_month, is_slingshot'
      const upperIds   = requestedIds.map(id => id.toUpperCase())
      const useDbFilter = !rootParam && requestedIds.length > 0

      const [
        { data: personnelRows, error: personnelError },
        { data: promoRows,     error: promoError     },
      ] = await Promise.all([
        useDbFilter
          ? supabase.from('personnel').select(PERS_COLS).in('sfg_id', upperIds)
          : supabase.from('personnel').select(PERS_COLS),
        useDbFilter
          ? supabase.from('agent_promotions').select(PROMO_COLS).in('sfg_id', upperIds)
          : supabase.from('agent_promotions').select(PROMO_COLS),
      ])

      if (personnelError) throw personnelError
      if (promoError)     throw promoError
      if (!personnelRows?.length) return res.status(200).json(
        req.query.include === 'policies' ? { personnel: [], policies: [] } : []
      )

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
          status:                  p.status?.trim()            ?? '',
          phone:                   p.phone?.trim()             ?? '',
          address:                 p.address?.trim()           ?? '',
          city:                    p.city?.trim()              ?? '',
          state:                   p.state?.trim()             ?? '',
          zip:                     p.zip?.trim()               ?? '',
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
        // If useDbFilter, the DB already scoped the rows; JS filter is a no-op safety net
        results = useDbFilter ? all : all.filter(p => requestedIds.includes(p.sfg_id.toLowerCase()))
      } else {
        results = all
      }

      // Cache-Control: PRIVATE only. This response is scoped to the caller's
      // authorized subjects, so it must never be cached at the shared edge (that
      // would let one user's data be served to another). Browser-only caching for
      // 30 s still de-dupes rapid in-session reloads.
      res.setHeader('Cache-Control', 'private, max-age=30')

      // ?include=policies — fetch policies for the result set and return both
      // together so callers need only one round-trip instead of two.
      // Apply the same field aliases used by GET /api/policies?sfg_ids so pages
      // receive the expected names (subm_apv, policy_type, policy_no, face_amt).
      if (req.query.include === 'policies') {
        const sfgIds = results.map(p => p.sfg_id)
        const raw    = sfgIds.length ? await fetchPolicies(supabase, sfgIds) : []

        // Build name lookup from the personnel we already have — no extra query needed
        const nameById = {}
        for (const p of results) nameById[p.sfg_id.toLowerCase()] = p.name || ''

        const policies = raw.map(p => ({
          ...p,
          agent:       nameById[p.sfg_id?.toLowerCase()] ?? '',
          subm_apv:    p.submitted_apv  ?? null,
          policy_type: p.policy_name    ?? '',
          policy_no:   p.policy_number  ?? '',
          face_amt:    p.face_amount != null ? String(p.face_amount) : '',
        }))
        return res.status(200).json({ personnel: results, policies })
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

    const normalSfgId = sfg_id.trim().toUpperCase()
    if (!(await authorizeScope(req, res, caller, supabase, [normalSfgId]))) return
    const patch = {}
    const milChanges = {} // { 'commission:2': { type, level, 0: val, 1: val }, ... }

    for (const [key, val] of Object.entries(updates)) {
      // Milestone fields → agent_promotions table
      const milMatch      = key.match(/^mil_(\d+)_(\d+)$/)
      const namedMilMatch = key.match(/^namedmil_([A-Za-z0-9]+)_(\d+)$/)
      if (milMatch) {
        const [, level, idx] = milMatch
        const k = `commission:${level}`
        if (!milChanges[k]) milChanges[k] = { type: 'commission', level }
        milChanges[k][Number(idx)] = val?.trim() || null
        continue
      }
      if (namedMilMatch) {
        const [, level, idx] = namedMilMatch
        const k = `named:${level.toUpperCase()}`
        if (!milChanges[k]) milChanges[k] = { type: 'named', level: level.toUpperCase() }
        milChanges[k][Number(idx)] = val?.trim() || null
        continue
      }

      // Map frontend key → DB column (e.g. name → preferred_name)
      const col = FIELD_MAP[key] ?? key
      if (!ALLOWED_FIELDS.has(col)) continue

      if (col === 'no_eando') {
        patch[col] = typeof val === 'boolean' ? val : ['true', 'yes', 'y', '1', 'x'].includes(String(val ?? '').toLowerCase())
      } else if (DATE_FIELDS.has(col)) {
        patch[col] = val?.trim() || null
      } else {
        patch[col] = val?.trim() || null
      }
    }

    const hasPatch      = Object.keys(patch).length > 0
    const hasMilChanges = Object.keys(milChanges).length > 0

    if (!hasPatch && !hasMilChanges) {
      return res.status(400).json({ error: 'No valid fields to update' })
    }

    try {
      // Update personnel table
      if (hasPatch) {
        const { error } = await supabase
          .from('personnel')
          .update(patch)
          .eq('sfg_id', normalSfgId)
        if (error) return res.status(500).json({ error: error.message })
      }

      // Update agent_promotions — fetch existing rows first to preserve non-month fields
      if (hasMilChanges) {
        const { data: existingRows } = await supabase
          .from('agent_promotions')
          .select('*')
          .eq('sfg_id', normalSfgId)

        const existingMap = {}
        for (const row of (existingRows ?? [])) {
          existingMap[`${row.promotion_type}:${String(row.level).toUpperCase()}`] = row
        }

        const upsertRows = Object.values(milChanges).map(change => {
          const mapKey  = `${change.type}:${String(change.level).toUpperCase()}`
          const existing = existingMap[mapKey] ?? {}
          const monthFields = {
            month_1: 0 in change ? change[0] : (existing.month_1 ?? null),
            month_2: 1 in change ? change[1] : (existing.month_2 ?? null),
            month_3: 2 in change ? change[2] : (existing.month_3 ?? null),
          }
          return {
            sfg_id:         normalSfgId,
            promotion_type: change.type,
            level:          isNaN(Number(change.level)) ? change.level : Number(change.level),
            ...monthFields,
            slingshot_month: existing.slingshot_month ?? null,
            is_slingshot:    existing.is_slingshot    ?? false,
          }
        })

        const { error: milError } = await supabase
          .from('agent_promotions')
          .upsert(upsertRows, { onConflict: 'sfg_id,promotion_type,level' })
        if (milError) return res.status(500).json({ error: milError.message })
      }

      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('[personnel/put]', err)
      return res.status(500).json({ error: 'Failed to update personnel data' })
    }
  }

  // ── POST — bulk upsert agents (super_admin only) ──────────────────────────
  if (req.method === 'POST') {
    if (!(await requireSuperAdmin(req, res))) return
    let rows, agentUpdates
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
      rows         = body.rows
      agentUpdates = body.agentUpdates
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' })
    }

    if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows must be an array' })

    // Fields allowed to be updated on existing agents (sfg_id, preferred_name,
    // hire_date, birth_date are protected and never overwritten by the importer)
    const UPSERT_FIELDS = ['opt_name', 'upline_sfg_id', 'npn', 'phone', 'address', 'city', 'state', 'zip', 'status']

    try {
      let inserted = 0, skipped = 0
      const errors = []

      let insertedAgents = []
      if (rows.length > 0) {
        const { data, error } = await supabase
          .from('personnel')
          .upsert(rows, { onConflict: 'sfg_id', ignoreDuplicates: true })
          .select('sfg_id, preferred_name, hire_date, upline_sfg_id')
        if (error) throw error
        insertedAgents = data ?? []
        inserted = insertedAgents.length
        skipped  = rows.length - inserted
      }

      let updated = 0
      if (Array.isArray(agentUpdates) && agentUpdates.length > 0) {
        for (const entry of agentUpdates) {
          const { sfg_id } = entry
          const patch = {}
          for (const field of UPSERT_FIELDS) {
            if (entry[field] !== null && entry[field] !== undefined) patch[field] = entry[field]
          }
          if (!Object.keys(patch).length) continue
          const { error } = await supabase.from('personnel').update(patch).eq('sfg_id', sfg_id)
          if (error) { errors.push({ sfg_id, error: error.message }) } else { updated++ }
        }
      }

      return res.status(200).json({ inserted, skipped, updated, errors, insertedAgents })
    } catch (err) {
      console.error('[personnel/post]', err)
      return res.status(500).json({ error: err?.message ?? 'Failed to import agents' })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
