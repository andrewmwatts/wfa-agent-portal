import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

// ---------------------------------------------------------------------------
// Build milestones / named_milestones from agent_promotions rows
// ---------------------------------------------------------------------------
// promotion_type = 'commission'  → milestones[level]  (numeric levels 85–130)
// promotion_type = 'leadership'  → named_milestones[level]  (AO/TP/EP/TL/KL)
// promotion_type = 'badge'       → named_milestones[level]  (any badge label)
//
// Array layout:
//   Normal (is_slingshot = false): [month_1, month_2, month_3?]
//   Slingshot (is_slingshot = true): [month_1, slingshot_month, month_3?]
//   (month_3 is only set for commission 125/130 and AO leadership)
// ---------------------------------------------------------------------------
function buildPromotionMaps(promoRows) {
  const milestones       = {}   // { '85': [m1, m2, ...], '90': [...], ... }
  const named_milestones = {}   // { 'AO': [m1, m2, ...], 'TP': [...], ... }

  for (const row of promoRows) {
    const { promotion_type, level, month_1, month_2, month_3, slingshot_month, is_slingshot } = row

    const arr = []
    arr.push(month_1 ?? '')
    arr.push(is_slingshot ? (slingshot_month ?? '') : (month_2 ?? ''))
    if (month_3 != null) arr.push(month_3 ?? '')

    if (promotion_type === 'commission') {
      milestones[String(level)] = arr
    } else {
      // 'leadership' or 'badge'
      named_milestones[String(level).toUpperCase()] = arr
    }
  }

  return { milestones, named_milestones }
}

// ---------------------------------------------------------------------------
// Tree traversal helpers (unchanged from original)
// ---------------------------------------------------------------------------

// An agent qualifies as an owner if AO Month 1 + AO Month 2 are both filled,
// or if they appear in Supabase with role owner/super_admin.
function isOwnerFromData(record) {
  const ao = record.named_milestones?.AO ?? []
  return !!(ao[0] && ao[1])
}

// Traverse the full tree downward from root with no owner stopping (master agency mode).
function computeMasterAgency(rootSfgId, allPersonnel) {
  const childrenOf = {}
  for (const p of allPersonnel) {
    const up = p.upline_sfg_id?.trim().toLowerCase()
    if (!up) continue
    if (!childrenOf[up]) childrenOf[up] = []
    childrenOf[up].push(p.sfg_id.toLowerCase())
  }

  const root   = rootSfgId.toLowerCase()
  const result = new Set()

  function traverse(id) {
    result.add(id)
    for (const child of (childrenOf[id] ?? [])) traverse(child)
  }

  traverse(root)
  return result
}

// Traverse the tree downward from root, stopping branches at sub-owners.
function computeBaseshop(rootSfgId, allPersonnel, ownerSet) {
  const childrenOf = {}
  for (const p of allPersonnel) {
    const up = p.upline_sfg_id?.trim().toLowerCase()
    if (!up) continue
    if (!childrenOf[up]) childrenOf[up] = []
    childrenOf[up].push(p.sfg_id.toLowerCase())
  }

  const root   = rootSfgId.toLowerCase()
  const result = new Set()

  function traverse(id) {
    result.add(id)
    for (const child of (childrenOf[id] ?? [])) {
      if (ownerSet.has(child) && child !== root) continue  // stop at sub-owners
      traverse(child)
    }
  }

  traverse(root)
  return result
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const rootParam    = req.query.root?.trim()
  const masterMode   = req.query.mode === 'master'
  const sfgIdsParam  = req.query.sfg_ids ?? req.query.sfg_id ?? ''
  const requestedIds = sfgIdsParam
    ? sfgIdsParam.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    : []

  try {
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    // ── 1. Fetch all personnel ──────────────────────────────────────────────
    const { data: personnelRows, error: personnelError } = await supabase
      .from('personnel')
      .select('sfg_id, preferred_name, opt_name, upline_sfg_id, hire_date, birth_date, npn, surelc_profile_date, profile_issues, no_eando, contracting_to_producer, contracting_complete, status')

    if (personnelError) throw personnelError
    if (!personnelRows?.length) return res.status(200).json([])

    // ── 2. Fetch all agent_promotions ───────────────────────────────────────
    const { data: promoRows, error: promoError } = await supabase
      .from('agent_promotions')
      .select('sfg_id, promotion_type, level, month_1, month_2, month_3, slingshot_month, is_slingshot')

    if (promoError) throw promoError

    // Group promotions by sfg_id
    const promosBySfgId = {}
    for (const row of (promoRows ?? [])) {
      const id = row.sfg_id?.trim().toLowerCase()
      if (!id) continue
      ;(promosBySfgId[id] ??= []).push(row)
    }

    // ── 3. Build full records ───────────────────────────────────────────────
    // Build sfg_id → preferred display name lookup for upline_name derivation
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
        sfg_id:                    p.sfg_id?.trim()              ?? '',
        name:                      p.preferred_name?.trim()      || p.opt_name?.trim() || '',
        preferred_name:            p.preferred_name?.trim()      ?? '',
        opt_name:                  p.opt_name?.trim()            ?? '',
        upline_sfg_id:             p.upline_sfg_id?.trim()       ?? '',
        upline_name:               uplineName,
        hire_date:                 p.hire_date                   ?? '',
        birth_date:                p.birth_date                  ?? '',
        npn:                       p.npn?.trim()                 ?? '',
        surelc_profile_date:       p.surelc_profile_date         ?? '',
        profile_issues:            p.profile_issues?.trim()      ?? '',
        no_eando:                  p.no_eando ?? false,
        contracting_to_producer:   p.contracting_to_producer     ?? '',
        contracting_complete:      p.contracting_complete        ?? '',
        milestones,
        named_milestones,
      }
    })

    // ── 4. Filter / scope ───────────────────────────────────────────────────
    let results

    if (rootParam) {
      if (masterMode) {
        const masterIds = computeMasterAgency(rootParam, all)
        results = all.filter(p => masterIds.has(p.sfg_id.toLowerCase()))
      } else {
        // Build owner set from sheet data + portal roles
        const sheetOwnerIds = all
          .filter(isOwnerFromData)
          .map(p => p.sfg_id.toLowerCase())

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
    console.error('[personnel-data]', err)
    return res.status(500).json({ error: 'Failed to read personnel data' })
  }
}
