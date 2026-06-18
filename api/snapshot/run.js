import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import { requireSuperAdmin } from '../_auth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../../.env.local') })

/**
 * POST /api/snapshot/run
 *
 * Body (JSON, parsed client-side from XLSX):
 * {
 *   month: "2026-05",
 *   min_diff: 1.50,               // optional, default 1.50
 *   snapshot_window: { from: "2026-04-26", to: "2026-05-30" },
 *   snapshot_agents: [
 *     { agent_name: "Jane Doe", carrier: "Americo", snapshot_apv: 12500.00 }
 *   ]
 * }
 */

// Snapshot-specific carrier aliases (superset of shared/carriers.js)
const SNAPSHOT_ALIASES = {
  'lga':                                    'Banner',
  'banner':                                 'Banner',
  'foresters':                              'Foresters',
  'foresters dfl':                          'Foresters',
  'american amicable':                      'American Amicable',
  'american amicable group':                'American Amicable',
  'occidental':                             'Occidental',
  'mutual of omaha':                        'Mutual of Omaha',
  'transamerica':                           'TransAmerica',
  'transamerica group':                     'TransAmerica',
  'fidelity and guaranty':                  'Fidelity and Guaranty',
  'fidelity and guaranty life annuity':     'Fidelity and Guaranty',
  'americo':                                'Americo',
  'american general':                       'American General',
  'corebridge':                             'American General',
  'sbli':                                   'SBLI',
  'united home life':                       'United Home Life',
  'assurity':                               'Assurity',
  'guaranty income life':                   'Guaranty Income Life',
}

function normalizeSnapshotCarrier(raw) {
  if (!raw) return raw
  return SNAPSHOT_ALIASES[raw.trim().toLowerCase()] ?? raw.trim()
}

function parseIsoDate(str) {
  if (!str) return null
  const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]))
}

function inWindow(dateStr, fromDate, toDate) {
  const d = parseIsoDate(dateStr)
  if (!d) return false
  return d >= fromDate && d <= toDate
}

function sumApv(policies) {
  return policies.reduce((s, p) => s + (Number(p.issued_apv) || 0), 0)
}

function findDuplicatePolicies(allPolicies) {
  const byNum = {}
  for (const p of allPolicies) {
    const num = p.policy_number?.trim()
    if (!num) continue
    ;(byNum[num] ??= []).push(p)
  }
  const dupes = []
  for (const [, group] of Object.entries(byNum)) {
    if (group.length > 1) {
      for (const p of group) {
        dupes.push({
          policy_no:  p.policy_number,
          applicant:  p.applicant   ?? '',
          agent:      p.agent_name  ?? '',
          carrier:    normalizeSnapshotCarrier(p.carrier),
          issue_date: p.issue_date  ?? '',
          apv:        p.issued_apv  ?? 0,
        })
      }
    }
  }
  return dupes
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!(await requireSuperAdmin(req, res))) return

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  const {
    month,
    min_diff = 1.50,
    snapshot_window,
    snapshot_agents = [],
  } = req.body ?? {}

  if (!month || !snapshot_window?.from || !snapshot_window?.to) {
    return res.status(400).json({ error: 'month, snapshot_window.from, and snapshot_window.to are required' })
  }

  const fromDate = parseIsoDate(snapshot_window.from)
  const toDate   = parseIsoDate(snapshot_window.to)
  if (!fromDate || !toDate) {
    return res.status(400).json({ error: 'Invalid snapshot_window dates' })
  }

  try {
    // ── 1. Upsert snapshot_cycles ────────────────────────────────────────────
    let cycleId
    {
      const { data: existing } = await supabase
        .from('snapshot_cycles')
        .select('id')
        .eq('month', month)
        .maybeSingle()

      if (existing) {
        cycleId = existing.id
        await supabase.from('snapshot_cycles').update({
          snapshot_date_from: snapshot_window.from,
          snapshot_date_to:   snapshot_window.to,
        }).eq('id', cycleId)
      } else {
        const { data, error } = await supabase
          .from('snapshot_cycles')
          .insert({ month, step: 1, snapshot_date_from: snapshot_window.from, snapshot_date_to: snapshot_window.to })
          .select('id')
          .single()
        if (error) throw error
        cycleId = data.id
      }
    }

    // ── 2. Load all policies joined to personnel ──────────────────────────────
    const PAGE = 10000
    const allPolicies = []
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from('policies')
        .select(`
          id, policy_number, applicant, carrier,
          issue_date, issued_apv, status,
          conservation_status, conservation_date,
          snapshot_chargeback_month, snapshot_chargeback_apv,
          split_reset, policy_notes, sfg_id,
          personnel!inner(opt_name)
        `)
        .range(from, from + PAGE - 1)
      if (error) throw error
      const rows = (data ?? []).map(p => ({
        ...p,
        agent_name: p.personnel?.opt_name ?? '',
      }))
      allPolicies.push(...rows)
      if (!data || data.length < PAGE) break
      from += PAGE
    }

    // ── 3. Load personnel for name → sfg_id crosswalk ────────────────────────
    const { data: people } = await supabase
      .from('personnel')
      .select('sfg_id, opt_name')
    const nameCrosswalk = {}
    for (const p of people ?? []) {
      if (p.opt_name) nameCrosswalk[p.opt_name.trim().toLowerCase()] = p.sfg_id
    }

    // ── 4. Match snapshot agents → sfg_ids ───────────────────────────────────
    const warnings = []
    const snapshotBySfgCarrier = {} // key: `${sfg_id}||${carrier}`

    for (const row of snapshot_agents) {
      const carrier = normalizeSnapshotCarrier(row.carrier)
      const sfgId   = nameCrosswalk[row.agent_name?.trim().toLowerCase()]
      if (!sfgId) {
        warnings.push({ agent_name: row.agent_name, carrier })
        continue
      }
      const key = `${sfgId}||${carrier}`
      snapshotBySfgCarrier[key] = (snapshotBySfgCarrier[key] ?? 0) + (Number(row.snapshot_apv) || 0)
    }

    // ── 5. Filter policies into buckets for each agent+carrier ───────────────
    const policyBuckets = {} // sfg_id → carrier → { issued, non_issued, cb_candidates, prior }

    for (const p of allPolicies) {
      const sfgId  = p.sfg_id?.trim()
      if (!sfgId) continue
      const carrier = normalizeSnapshotCarrier(p.carrier)
      const key     = `${sfgId}||${carrier}`

      if (!policyBuckets[sfgId]) policyBuckets[sfgId] = {}
      if (!policyBuckets[sfgId][carrier]) {
        policyBuckets[sfgId][carrier] = {
          issued:         [],
          non_issued:     [],
          cb_candidates:  [],
          prior_in_window: [],
        }
      }
      const b = policyBuckets[sfgId][carrier]
      const issueInWindow  = inWindow(p.issue_date, fromDate, toDate)
      const issuedStatus   = (p.status ?? '').toLowerCase() === 'issued'
      const activeStatus   = ['pending', 'incomplete'].includes((p.status ?? '').toLowerCase())
      const hasConsvStatus = !!p.conservation_status?.trim()

      if (issuedStatus && issueInWindow) {
        b.issued.push(p)
        if (hasConsvStatus) b.cb_candidates.push(p)
      } else if (activeStatus) {
        // Non-issued policies in the window (still pending/incomplete)
        b.non_issued.push(p)
      } else if (issuedStatus && p.issue_date && !issueInWindow) {
        // Issued before or after window — prior_in_window if still in same carrier scope
        // Only flag if the policy might affect snapshot (issued prior to window but not beyond toDate + ~30d)
        const issueD = parseIsoDate(p.issue_date)
        if (issueD && issueD >= new Date(fromDate.getTime() - 90 * 86400000) && issueD < fromDate) {
          b.prior_in_window.push(p)
        }
      }
    }

    // ── 6. Find duplicate policy numbers ─────────────────────────────────────
    const duplicate_policies = findDuplicatePolicies(allPolicies)

    // ── 7. Build reconciliation rows ──────────────────────────────────────────
    // Collect all (sfg_id, carrier) pairs from both snapshot and DB
    const allKeys = new Set([
      ...Object.keys(snapshotBySfgCarrier),
      ...Object.entries(policyBuckets).flatMap(([sfgId, carriers]) =>
        Object.keys(carriers).map(c => `${sfgId}||${c}`)
      ),
    ])

    const discrepancies   = []
    const cleanAgents     = new Set()
    const discrepantAgents = new Set()

    const upsertRows = []

    for (const key of allKeys) {
      const [sfgId, carrier] = key.split('||')
      const buckets     = policyBuckets[sfgId]?.[carrier] ?? { issued: [], non_issued: [], cb_candidates: [], prior_in_window: [] }
      const snapshotApv = snapshotBySfgCarrier[key] ?? 0
      const dbApv       = sumApv(buckets.issued)
      const delta       = snapshotApv - dbApv

      // Build mechanical flags
      const mechanical_flags = []
      if (buckets.issued.some(p => p.split_reset))     mechanical_flags.push('Split/Reset policy')
      if (buckets.cb_candidates.length > 0)            mechanical_flags.push(`${buckets.cb_candidates.length} chargeback candidate${buckets.cb_candidates.length > 1 ? 's' : ''}`)
      if (buckets.prior_in_window.length > 0)          mechanical_flags.push(`${buckets.prior_in_window.length} prior-month policy in window`)
      if (duplicate_policies.some(d => buckets.issued.some(p => p.policy_number === d.policy_no))) {
        mechanical_flags.push('Duplicate policy number')
      }

      const hasFlags  = mechanical_flags.length > 0
      const absDelta  = Math.abs(delta)

      // Skip clean rows with no flags and delta below threshold
      if (absDelta < min_diff && !hasFlags) {
        cleanAgents.add(sfgId)
        continue
      }

      discrepantAgents.add(sfgId)

      const toJson = arr => JSON.stringify(arr.map(p => ({
        id:                  p.id,
        policy_number:       p.policy_number      ?? '',
        applicant:           p.applicant          ?? '',
        carrier:             normalizeSnapshotCarrier(p.carrier),
        issue_date:          p.issue_date         ?? '',
        issued_apv:          p.issued_apv         ?? null,
        status:              p.status             ?? '',
        conservation_status: p.conservation_status ?? '',
        conservation_date:   p.conservation_date  ?? '',
        snapshot_chargeback_month: p.snapshot_chargeback_month ?? '',
        snapshot_chargeback_apv:   p.snapshot_chargeback_apv   ?? null,
        split_reset:         p.split_reset        ?? false,
        policy_notes:        p.policy_notes       ?? '',
        agent_name:          p.agent_name         ?? '',
      })))

      upsertRows.push({
        cycle_id:            cycleId,
        sfg_id:              sfgId,
        carrier,
        snapshot_apv:        snapshotApv,
        db_apv:              dbApv,
        delta,
        policy_count:        buckets.issued.length,
        mechanical_flags,
        issued_policies:     toJson(buckets.issued),
        non_issued_policies: toJson(buckets.non_issued),
        chargeback_candidates: toJson(buckets.cb_candidates),
        prior_in_window:     toJson(buckets.prior_in_window),
      })

      discrepancies.push({
        sfg_id:           sfgId,
        carrier,
        snapshot_apv:     snapshotApv,
        db_apv:           dbApv,
        delta,
        mechanical_flags,
        policy_count:     buckets.issued.length,
      })
    }

    // ── 8. Upsert reconciliations ────────────────────────────────────────────
    if (upsertRows.length > 0) {
      const { error } = await supabase
        .from('snapshot_reconciliations')
        .upsert(upsertRows, { onConflict: 'cycle_id,sfg_id,carrier' })
      if (error) throw error
    }

    // ── 9. Load agent names for response ────────────────────────────────────
    const sfgIds = [...new Set([...discrepantAgents, ...cleanAgents])]
    const nameLookup = {}
    if (sfgIds.length) {
      const { data: nameData } = await supabase
        .from('personnel')
        .select('sfg_id, opt_name')
        .in('sfg_id', sfgIds)
      for (const p of nameData ?? []) nameLookup[p.sfg_id] = p.opt_name ?? p.sfg_id
    }

    return res.status(200).json({
      cycle_id: cycleId,
      month,
      snapshot_window,
      duplicate_policies,
      discrepancies: discrepancies.map(d => ({
        ...d,
        agent_name: nameLookup[d.sfg_id] ?? d.sfg_id,
      })),
      unmatched_agents: warnings,
      summary: {
        total_agents:      discrepantAgents.size + cleanAgents.size,
        discrepant_agents: discrepantAgents.size,
        clean_agents:      cleanAgents.size,
      },
    })
  } catch (err) {
    console.error('[snapshot/run]', err)
    return res.status(500).json({ error: err?.message ?? 'Failed to run snapshot comparison' })
  }
}
