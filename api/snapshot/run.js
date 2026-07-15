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
 * 1. Parse snapshot_agents (name + carrier + APV)
 * 2. Skip $0 entries
 * 3. Convert agent names → sfg_ids via personnel
 * 4. Query issued policies in window, group by sfg_id + carrier
 * 5. Compare; missing side = 0
 * 6. Filter: |delta| > min_diff OR hard mechanical flag
 * 7. Batch-fetch candidate pools for all discrepant agents
 * 8. Run deterministic candidate matching per discrepancy
 * 9. Store results (including analysis) in snapshot_reconciliations
 */

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

// These carriers round their Snapshot reports to the nearest dollar
const DOLLAR_ROUND_CARRIERS = new Set(['Americo', 'Mutual of Omaha'])

function normalizeSnapshotCarrier(raw) {
  if (!raw) return raw
  return SNAPSHOT_ALIASES[raw.trim().toLowerCase()] ?? raw.trim()
}

function getTolerance(carrier) {
  return DOLLAR_ROUND_CARRIERS.has(carrier) ? 1.00 : 0.02
}

function near(a, b, tol) {
  return Math.abs(a - b) <= tol
}

function sumApv(policies) {
  return policies.reduce((s, p) => s + (Number(p.issued_apv) || 0), 0)
}

/**
 * Deterministic candidate matching for a single discrepancy.
 * Returns an array of candidate objects, or [] if no match found.
 */
function matchCandidates({ delta, carrier, chargebacks, nonIssued, straddle, notTaken, issuedPolicies }) {
  const absDelta = Math.abs(delta)
  const tol      = getTolerance(carrier)
  const candidates = []

  // Chargebacks (delta < 0: snapshot less than tracker)
  if (delta < 0) for (const p of chargebacks) {
    const apv = Number(p.issued_apv) || 0
    if (!apv) continue

    if (near(apv, absDelta, tol)) {
      candidates.push({
        type: 'chargeback', flag: 'Log chargeback', match: 'full',
        policy_id: p.id, policy_number: p.policy_number, applicant: p.applicant,
        issued_apv: apv, conservation_date: p.conservation_date,
        conservation_status: p.conservation_status, delta_contribution: apv,
      })
      continue
    }

    // Prorated (n/12)
    for (let n = 1; n <= 11; n++) {
      const prorated = Math.round(apv * n / 12 * 100) / 100
      if (near(prorated, absDelta, tol)) {
        candidates.push({
          type: 'chargeback', flag: 'Log chargeback', match: `${n}/12`,
          policy_id: p.id, policy_number: p.policy_number, applicant: p.applicant,
          issued_apv: apv, conservation_date: p.conservation_date,
          conservation_status: p.conservation_status, delta_contribution: prorated,
        })
        break
      }
    }
  }

  // Non-issued in snapshot (delta > 0: snapshot greater than tracker)
  if (delta > 0) {
    for (const p of nonIssued) {
      const apv = Number(p.issued_apv) || 0
      if (apv && near(apv, delta, tol)) {
        candidates.push({
          type: 'non_issued', flag: 'Flag for review', match: 'full',
          policy_id: p.id, policy_number: p.policy_number, applicant: p.applicant,
          issued_apv: apv, status: p.status, submit_date: p.submit_date,
          delta_contribution: apv,
        })
      }
    }
  }

  // Effective-date straddle (delta < 0)
  if (delta < 0) {
    for (const p of straddle) {
      const apv = Number(p.issued_apv) || 0
      if (apv && near(apv, absDelta, tol)) {
        candidates.push({
          type: 'straddle', flag: 'Confirm issue/effective date', match: 'full',
          policy_id: p.id, policy_number: p.policy_number, applicant: p.applicant,
          issued_apv: apv, issue_date: p.issue_date, delta_contribution: apv,
        })
      }
    }
  }

  // Not taken (delta < 0)
  if (delta < 0) {
    for (const p of notTaken) {
      const apv = Number(p.issued_apv) || 0
      if (apv && near(apv, absDelta, tol)) {
        candidates.push({
          type: 'not_taken', flag: 'Remove chargeback', match: 'full',
          policy_id: p.id, policy_number: p.policy_number, applicant: p.applicant,
          issued_apv: apv, delta_contribution: apv,
        })
      }
    }
  }

  // Missing from snapshot — fallback when no external candidate matches
  if (candidates.length === 0 && delta < 0 && issuedPolicies.length > 0) {
    for (const p of issuedPolicies) {
      const apv = Number(p.issued_apv) || 0
      if (apv && near(apv, absDelta, tol)) {
        candidates.push({
          type: 'missing', flag: 'Missing from snapshot', match: 'full',
          policy_id: p.id, policy_number: p.policy_number, applicant: p.applicant,
          issued_apv: apv, issue_date: p.issue_date, delta_contribution: apv,
        })
      }
    }
  }

  return candidates
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

    // ── 2. Build name crosswalk from personnel ───────────────────────────────
    const { data: people } = await supabase
      .from('personnel')
      .select('sfg_id, opt_name')

    const nameCrosswalk = {}  // opt_name.toLowerCase() → sfg_id
    const nameFromSfgId = {}  // sfg_id.toUpperCase()  → opt_name
    for (const p of people ?? []) {
      if (p.opt_name) nameCrosswalk[p.opt_name.trim().toLowerCase()] = p.sfg_id
      if (p.sfg_id)  nameFromSfgId[p.sfg_id.trim().toUpperCase()]  = p.opt_name ?? ''
    }

    // ── 3. Match snapshot agents → sfg_ids (skip $0 entries) ────────────────
    const warnings = []
    const snapshotBySfgCarrier = {}  // `${sfg_id}||${carrier}` → APV

    for (const row of snapshot_agents) {
      if (!row.snapshot_apv || Number(row.snapshot_apv) === 0) continue
      const carrier = normalizeSnapshotCarrier(row.carrier)
      const sfgId   = nameCrosswalk[row.agent_name?.trim().toLowerCase()]
      if (!sfgId) {
        warnings.push({ agent_name: row.agent_name, carrier, snapshot_apv: row.snapshot_apv })
        continue
      }
      const key = `${sfgId}||${carrier}`
      snapshotBySfgCarrier[key] = (snapshotBySfgCarrier[key] ?? 0) + (Number(row.snapshot_apv) || 0)
    }

    // ── 4. Query issued policies in window ───────────────────────────────────
    const { data: windowPolicies, error: polErr } = await supabase
      .from('policies')
      .select('id, policy_number, applicant, carrier, issue_date, issued_apv, split_reset, policy_notes, sfg_id')
      .ilike('status', 'issued')
      .gte('issue_date', snapshot_window.from)
      .lte('issue_date', snapshot_window.to)
    if (polErr) throw polErr

    // Group by sfg_id + carrier; only include agents with a known display name
    const knownSfgIds = new Set(
      Object.values(nameCrosswalk).map(id => id?.trim().toUpperCase()).filter(Boolean)
    )
    const policyBuckets = {}  // `${sfg_id}||${carrier}` → [policies]

    for (const p of windowPolicies ?? []) {
      const sfgId = p.sfg_id?.trim().toUpperCase()
      if (!sfgId || !knownSfgIds.has(sfgId)) continue
      const carrier = normalizeSnapshotCarrier(p.carrier)
      const key = `${sfgId}||${carrier}`
      ;(policyBuckets[key] ??= []).push(p)
    }

    // ── 5. Find duplicate policy numbers ─────────────────────────────────────
    const byPolicyNum = {}
    for (const policies of Object.values(policyBuckets)) {
      for (const p of policies) {
        const num = p.policy_number?.trim()
        if (num) (byPolicyNum[num] ??= []).push(p)
      }
    }
    const duplicateNums = new Set(
      Object.entries(byPolicyNum).filter(([, g]) => g.length > 1).map(([num]) => num)
    )
    const duplicate_policies = [...duplicateNums].flatMap(num =>
      byPolicyNum[num].map(p => ({
        policy_no:  p.policy_number,
        applicant:  p.applicant ?? '',
        agent:      nameFromSfgId[p.sfg_id?.trim().toUpperCase()] ?? p.sfg_id ?? '',
        carrier:    normalizeSnapshotCarrier(p.carrier),
        issue_date: p.issue_date ?? '',
        apv:        p.issued_apv ?? 0,
      }))
    )

    // ── 6. Pass 1 — identify discrepancies ───────────────────────────────────
    const allKeys = new Set([
      ...Object.keys(snapshotBySfgCarrier),
      ...Object.keys(policyBuckets),
    ])

    const cleanAgents      = new Set()
    const discrepantAgents = new Set()
    const discrepancies    = []         // for API response
    const discrepancyList  = []         // for pass 2

    for (const key of allKeys) {
      const [sfgId, carrier] = key.split('||')
      const policies    = policyBuckets[key] ?? []
      const snapshotApv = snapshotBySfgCarrier[key] ?? 0
      const dbApv       = sumApv(policies)
      const delta       = snapshotApv - dbApv
      const absDelta    = Math.abs(delta)

      const mechanical_flags = []
      if (policies.some(p => p.split_reset))                      mechanical_flags.push('Split/Reset policy')
      if (policies.some(p => duplicateNums.has(p.policy_number))) mechanical_flags.push('Duplicate policy number')

      const hasHardFlag = policies.some(p => duplicateNums.has(p.policy_number))
      if (absDelta < min_diff && !hasHardFlag) { cleanAgents.add(sfgId); continue }

      discrepantAgents.add(sfgId)
      const agentName = nameFromSfgId[sfgId?.toUpperCase()] || sfgId

      discrepancyList.push({ sfgId, carrier, snapshotApv, dbApv, delta, policies, agentName, mechanical_flags })
      discrepancies.push({ sfg_id: sfgId, agent_name: agentName, carrier, snapshot_apv: snapshotApv, db_apv: dbApv, delta, mechanical_flags, policy_count: policies.length })
    }

    // ── 7. Batch-fetch candidate pools for all discrepant agents ─────────────
    const discrepantSfgIds = [...discrepantAgents]
    const dayAfterWindow = new Date(new Date(snapshot_window.to).getTime() + 86400000).toISOString().slice(0, 10)
    const straddleEnd    = new Date(new Date(snapshot_window.to).getTime() + 31 * 86400000).toISOString().slice(0, 10)

    let cbAll = [], nonIssuedAll = [], straddleAll = [], notTakenAll = []
    if (discrepantSfgIds.length > 0) {
      const [cbRes, niRes, stRes, ntRes] = await Promise.all([
        supabase
          .from('policies')
          .select('id, policy_number, applicant, carrier, issue_date, issued_apv, conservation_status, conservation_date, sfg_id')
          .in('sfg_id', discrepantSfgIds)
          .ilike('status', 'issued')
          .not('conservation_date', 'is', null),

        supabase
          .from('policies')
          .select('id, policy_number, applicant, carrier, issued_apv, status, submit_date, sfg_id')
          .in('sfg_id', discrepantSfgIds)
          .in('status', ['Pending', 'Incomplete', 'pending', 'incomplete']),

        supabase
          .from('policies')
          .select('id, policy_number, applicant, carrier, issue_date, issued_apv, sfg_id')
          .in('sfg_id', discrepantSfgIds)
          .ilike('status', 'issued')
          .gte('issue_date', dayAfterWindow)
          .lte('issue_date', straddleEnd),

        supabase
          .from('policies')
          .select('id, policy_number, applicant, carrier, issued_apv, status, sfg_id')
          .in('sfg_id', discrepantSfgIds)
          .ilike('status', 'not taken'),
      ])
      cbAll         = cbRes.data  ?? []
      nonIssuedAll  = niRes.data  ?? []
      straddleAll   = stRes.data  ?? []
      notTakenAll   = ntRes.data  ?? []
    }

    // ── 8. Pass 2 — build upsert rows with analysis ───────────────────────────
    const upsertRows = []
    for (const dm of discrepancyList) {
      const { sfgId, carrier, snapshotApv, dbApv, delta, policies, agentName, mechanical_flags } = dm

      // Filter each candidate pool to this agent+carrier
      const matchKey = sfgId.toUpperCase()
      const byAgent  = arr => arr.filter(p => p.sfg_id?.trim().toUpperCase() === matchKey
                                           && normalizeSnapshotCarrier(p.carrier) === carrier)

      const candidates = matchCandidates({
        delta,
        carrier,
        chargebacks:    byAgent(cbAll),
        nonIssued:      byAgent(nonIssuedAll),
        straddle:       byAgent(straddleAll),
        notTaken:       byAgent(notTakenAll),
        issuedPolicies: policies,
      })

      const issuedJson = JSON.stringify(policies.map(p => ({
        id:            p.id,
        policy_number: p.policy_number  ?? '',
        applicant:     p.applicant      ?? '',
        carrier:       normalizeSnapshotCarrier(p.carrier),
        issue_date:    p.issue_date     ?? '',
        issued_apv:    p.issued_apv     ?? null,
        split_reset:   p.split_reset    ?? false,
        policy_notes:  p.policy_notes   ?? '',
        agent_name:    agentName,
      })))

      upsertRows.push({
        cycle_id:        cycleId,
        sfg_id:          sfgId,
        carrier,
        snapshot_apv:    snapshotApv,
        db_apv:          dbApv,
        delta,
        policy_count:    policies.length,
        mechanical_flags,
        issued_policies: issuedJson,
        non_issued_policies:   '[]',
        chargeback_candidates: '[]',
        prior_in_window:       '[]',
        claude_hypothesis:     JSON.stringify({ candidates, unmatched: candidates.length === 0 }),
      })
    }

    // ── 9. Replace reconciliations for this cycle ────────────────────────────
    await supabase.from('snapshot_reconciliations').delete().eq('cycle_id', cycleId)
    if (upsertRows.length > 0) {
      const { error } = await supabase.from('snapshot_reconciliations').insert(upsertRows)
      if (error) throw error
    }

    return res.status(200).json({
      cycle_id: cycleId,
      month,
      snapshot_window,
      duplicate_policies,
      discrepancies,
      unmatched_agents: warnings,
      summary: {
        total_snapshot_agents: snapshot_agents.length,
        discrepant_agents:     discrepantAgents.size,
        clean_agents:          cleanAgents.size,
        unmatched:             warnings.length,
      },
    })
  } catch (err) {
    console.error('[snapshot/run]', err)
    return res.status(500).json({ error: err?.message ?? 'Failed to run snapshot comparison' })
  }
}
