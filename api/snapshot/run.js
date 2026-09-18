import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import { requireSuperAdmin } from '../_auth.js'
import { loadAllSplits, fetchPoliciesForAgents, explodeCreditedRows } from '../_policySplits.js'
import { fetchTrackerPolicies } from '../_snapshotTracker.js'
import { attachSplits, participants, creditedAmount } from '../../shared/policySplit.js'
import { getBaseshopIds, ownerIdsFromPromotions } from '../../shared/agencyScope.js'
import { normalizeSnapshotCarrier } from '../../shared/snapshotFile.js'
import {
  groupLinesByAgent, resolveFileAgents, adjudicateBuckets, normalizePolicyNumber, chargebackAmount,
} from '../../shared/snapshotReconcile.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../../.env.local') })

/**
 * POST /api/snapshot/run
 *
 * Accepts EITHER export in one request — the payload says which:
 *   snapshot_agents   [{ agent_name, carrier, snapshot_apv }]   the Snapshot workbook
 *   snapshot_policies [{ agent_name, policy_number, client, apv, carrier, ... }]
 *                                                                a Placed Policies export
 *
 * Snapshot workbook (compareAgentTotals):
 *   1. Skip $0 entries; convert agent names → sfg_ids via personnel (exact Opt name)
 *   2. Query issued policies in window, group by sfg_id + carrier
 *   3. Compare; missing side = 0
 *   4. Filter: |delta| > min_diff OR hard mechanical flag
 *   5. Batch-fetch candidate pools for all discrepant agents
 *   6. Run deterministic candidate matching per discrepancy
 *
 * Placed Policies export (comparePolicyLines):
 *   1. Resolve each agent name to an sfg_id — policy numbers first, names as corroboration
 *   2. Compare per agent + carrier against "issued minus logged chargebacks", and
 *      explain every difference at the policy level (shared/snapshotReconcile.js)
 *   3. Lines with no policy number (TransAmerica sends one lump per agent) get the
 *      same bucket-level explanation the workbook does
 *
 * Either way the results are stored in snapshot_reconciliations.
 *
 * `phase` says which pass this is:
 *   draft (default) — Step 1, the draft ledger. Chargebacks are treated as NOT yet
 *                     logged: the tracker figure is what was issued, so every reversal
 *                     is flagged for logging. Stored in snapshot_reconciliations.
 *   final           — Final Review, the ledger after internal edits and disputes. The
 *                     tracker figure is issued minus the chargebacks logged for the
 *                     window (what Promotions uses), so anything left is unaligned.
 *                     Stored apart, in snapshot_final_reconciliations, so it never
 *                     disturbs the Step 1 cards the disputes hang off.
 */

const RECON_TABLES = { draft: 'snapshot_reconciliations', final: 'snapshot_final_reconciliations' }

// These carriers round their Snapshot reports to the nearest dollar
const DOLLAR_ROUND_CARRIERS = new Set(['Americo', 'Mutual of Omaha'])

const normalizeCarrierLabel = normalizeSnapshotCarrier

function getTolerance(carrier) {
  return DOLLAR_ROUND_CARRIERS.has(carrier) ? 1.00 : 0.02
}

function near(a, b, tol) {
  return Math.abs(a - b) <= tol
}

// True when a policy's chargeback is logged for the month being reconciled.
function chargebackLoggedIn(p, window) {
  const m = String(p.snapshot_chargeback_month ?? '').slice(0, 10)
  return !!m && m >= window.from && m <= window.to
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

/**
 * Batch-fetches the candidate pools matchCandidates draws on, for the agents
 * whose bucket needs a bucket-level explanation.
 */
async function fetchCandidatePools(supabase, sfgIds, snapshot_window) {
  if (sfgIds.length === 0) return { cbAll: [], nonIssuedAll: [], straddleAll: [], notTakenAll: [] }

  const dayAfterWindow = new Date(new Date(snapshot_window.to).getTime() + 86400000).toISOString().slice(0, 10)
  const straddleEnd    = new Date(new Date(snapshot_window.to).getTime() + 31 * 86400000).toISOString().slice(0, 10)

  // Each pool is fetched split-aware (so a policy an agent only shares still
  // appears) and then exploded to one row per credited agent with issued_apv
  // rewritten to their share — the amounts matchCandidates compares against
  // the delta have to be the same amounts Snapshot reports.
  const pool = (columns, applyFilter) =>
    fetchPoliciesForAgents(supabase, sfgIds, columns, applyFilter)
      .then(rows => explodeCreditedRows(rows, sfgIds))

  const [cbAll, nonIssuedAll, straddleAll, notTakenAll] = await Promise.all([
    pool(
      'id, policy_number, applicant, carrier, issue_date, issued_apv, conservation_status, conservation_date, snapshot_chargeback_month, sfg_id',
      q => q.ilike('status', 'issued').not('conservation_date', 'is', null),
    ),
    pool(
      'id, policy_number, applicant, carrier, issued_apv, status, submit_date, sfg_id',
      q => q.in('status', ['Pending', 'Incomplete', 'pending', 'incomplete']),
    ),
    pool(
      'id, policy_number, applicant, carrier, issue_date, issued_apv, sfg_id',
      q => q.ilike('status', 'issued').gte('issue_date', dayAfterWindow).lte('issue_date', straddleEnd),
    ),
    pool(
      'id, policy_number, applicant, carrier, issued_apv, status, sfg_id',
      q => q.ilike('status', 'not taken'),
    ),
  ])
  return { cbAll, nonIssuedAll, straddleAll, notTakenAll }
}

// ── Snapshot workbook (one figure per agent + carrier) ───────────────────────

async function compareAgentTotals({
  supabase, cycleId, snapshot_agents, snapshot_window, min_diff,
  nameCrosswalk, nameFromSfgId, inCycleScope, netChargebacks = false,
}) {
  // ── 3. Match snapshot agents → sfg_ids (skip $0 entries) ────────────────
  const warnings = []
  const snapshotBySfgCarrier = {}  // `${sfg_id}||${carrier}` → APV
  let outOfScopeRows = 0

  for (const row of snapshot_agents) {
    if (!row.snapshot_apv || Number(row.snapshot_apv) === 0) continue
    const carrier = normalizeCarrierLabel(row.carrier)
    const sfgId   = nameCrosswalk[row.agent_name?.trim().toLowerCase()]
    if (!sfgId) {
      warnings.push({ agent_name: row.agent_name, carrier, snapshot_apv: row.snapshot_apv })
      continue
    }
    // Belongs to a baseshop this cycle isn't running — someone else's to
    // reconcile, so it is not an unmatched-agent warning.
    if (!inCycleScope(sfgId)) { outOfScopeRows++; continue }
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

  // Group by credited agent + carrier; only include agents with a known display
  // name. Snapshot reports each agent their share of a split sale, so a shared
  // policy lands in BOTH agents' buckets carrying only that agent's portion —
  // otherwise every split would read as a discrepancy every month.
  const knownSfgIds = new Set(
    Object.values(nameCrosswalk).map(id => id?.trim().toUpperCase()).filter(Boolean)
  )
  const splitRows        = await loadAllSplits(supabase)
  const windowWithSplits = attachSplits(windowPolicies ?? [], splitRows)
  const policyBuckets    = {}  // `${sfg_id}||${carrier}` → [policies, APV credited to that agent]

  for (const p of windowWithSplits) {
    const carrier = normalizeCarrierLabel(p.carrier)
    for (const agentId of participants(p)) {
      if (!knownSfgIds.has(agentId)) continue
      if (!inCycleScope(agentId)) continue
      const key = `${agentId}||${carrier}`
      ;(policyBuckets[key] ??= []).push({
        ...p,
        sfg_id:     agentId,
        issued_apv: creditedAmount(p, agentId, 'issued_apv'),
      })
    }
  }

  // Final ledger: the tracker figure is what was issued minus the chargebacks
  // already logged for this window, which is what Promotions counts.
  const chargebackByBucket = {}   // `${sfg_id}||${carrier}` → credited chargebacks logged this month
  if (netChargebacks) {
    const { data: cbPolicies, error: cbErr } = await supabase
      .from('policies')
      .select('id, policy_number, carrier, issued_apv, sfg_id, snapshot_chargeback_month, snapshot_chargeback_apv')
      .not('snapshot_chargeback_month', 'is', null)
      .gte('snapshot_chargeback_month', snapshot_window.from)
      .lte('snapshot_chargeback_month', snapshot_window.to)
    if (cbErr) throw cbErr
    for (const p of attachSplits(cbPolicies ?? [], splitRows)) {
      const carrier = normalizeCarrierLabel(p.carrier)
      for (const agentId of participants(p)) {
        if (!knownSfgIds.has(agentId) || !inCycleScope(agentId)) continue
        const key = `${agentId}||${carrier}`
        chargebackByBucket[key] = (chargebackByBucket[key] ?? 0) + chargebackAmount(p, agentId)
      }
    }
  }

  // ── 5. Find duplicate policy numbers ─────────────────────────────────────
  // Deduplicated by policy id first: a split policy sits in two buckets, and
  // without this its shared policy number would look like a duplicate.
  const byPolicyNum = {}
  const seenPolicyIds = new Set()
  for (const policies of Object.values(policyBuckets)) {
    for (const p of policies) {
      if (seenPolicyIds.has(p.id)) continue
      seenPolicyIds.add(p.id)
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
      carrier:    normalizeCarrierLabel(p.carrier),
      issue_date: p.issue_date ?? '',
      apv:        p.issued_apv ?? 0,
    }))
  )

  // ── 6. Pass 1 — identify discrepancies ───────────────────────────────────
  const allKeys = new Set([
    ...Object.keys(snapshotBySfgCarrier),
    ...Object.keys(policyBuckets),
    ...Object.keys(chargebackByBucket),
  ])

  const cleanAgents      = new Set()
  const discrepantAgents = new Set()
  const discrepancies    = []         // for API response
  const discrepancyList  = []         // for pass 2

  for (const key of allKeys) {
    const [sfgId, carrier] = key.split('||')
    const policies    = policyBuckets[key] ?? []
    const snapshotApv = snapshotBySfgCarrier[key] ?? 0
    const dbApv       = sumApv(policies) - (chargebackByBucket[key] ?? 0)
    const delta       = snapshotApv - dbApv
    const absDelta    = Math.abs(delta)

    const mechanical_flags = []
    if (policies.some(p => p.split_reset))                      mechanical_flags.push('Split/Reset policy')
    if (policies.some(p => p.splits?.length))                   mechanical_flags.push('Shared credit policy')
    if (policies.some(p => duplicateNums.has(p.policy_number))) mechanical_flags.push('Duplicate policy number')

    const hasHardFlag = policies.some(p => duplicateNums.has(p.policy_number))
    if (absDelta < min_diff && !hasHardFlag) { cleanAgents.add(sfgId); continue }

    discrepantAgents.add(sfgId)
    const agentName = nameFromSfgId[sfgId?.toUpperCase()] || sfgId

    discrepancyList.push({ sfgId, carrier, snapshotApv, dbApv, delta, policies, agentName, mechanical_flags })
    discrepancies.push({ sfg_id: sfgId, agent_name: agentName, carrier, snapshot_apv: snapshotApv, db_apv: dbApv, delta, mechanical_flags, policy_count: policies.length })
  }

  // ── 7. Batch-fetch candidate pools for all discrepant agents ─────────────
  const { cbAll, nonIssuedAll, straddleAll, notTakenAll } =
    await fetchCandidatePools(supabase, [...discrepantAgents], snapshot_window)

  // ── 8. Pass 2 — build upsert rows with analysis ───────────────────────────
  const upsertRows = []
  for (const dm of discrepancyList) {
    const { sfgId, carrier, snapshotApv, dbApv, delta, policies, agentName, mechanical_flags } = dm

    // Filter each candidate pool to this agent+carrier
    const matchKey = sfgId.toUpperCase()
    const byAgent  = arr => arr.filter(p => p.sfg_id?.trim().toUpperCase() === matchKey
                                         && normalizeCarrierLabel(p.carrier) === carrier)

    // On a final ledger a chargeback already logged for this month is already
    // netted out of the tracker figure, so it can't also explain what's left over.
    const candidates = matchCandidates({
      delta,
      carrier,
      chargebacks:    byAgent(cbAll).filter(p => !netChargebacks || !chargebackLoggedIn(p, snapshot_window)),
      nonIssued:      byAgent(nonIssuedAll),
      straddle:       byAgent(straddleAll),
      notTaken:       byAgent(notTakenAll),
      issuedPolicies: policies,
    })

    const issuedJson = JSON.stringify(policies.map(p => ({
      id:            p.id,
      policy_number: p.policy_number  ?? '',
      applicant:     p.applicant      ?? '',
      carrier:       normalizeCarrierLabel(p.carrier),
      issue_date:    p.issue_date     ?? '',
      // This agent's credited share, matching what Snapshot reports for them
      issued_apv:    p.issued_apv     ?? null,
      split_reset:   p.split_reset    ?? false,
      splits:        p.splits         ?? null,
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
      claude_hypothesis:     JSON.stringify({
        candidates,
        unmatched: candidates.length === 0,
        // Only a final ledger nets chargebacks, so only then is the breakdown worth showing.
        ...(netChargebacks ? { tracker: { issued: sumApv(policies), chargebacks: chargebackByBucket[`${sfgId}||${carrier}`] ?? 0 } } : {}),
      }),
    })
  }

  return {
    warnings, outOfScopeRows, snapshotBySfgCarrier, duplicate_policies,
    discrepancies, cleanAgents, discrepantAgents, upsertRows,
    totalAgents: snapshot_agents.length,
  }
}

// ── Placed Policies export (one line per policy transaction) ─────────────────

async function comparePolicyLines({
  supabase, cycleId, snapshot_policies, agent_overrides, snapshot_window, min_diff,
  people, nameFromSfgId, inCycleScope, scopeIds, netChargebacks = false,
}) {
  const splitRows = await loadAllSplits(supabase)
  const tracker = await fetchTrackerPolicies(supabase, {
    fileNumbers: snapshot_policies.map(l => l.policy_number),
    window: snapshot_window,
    splitRows,
  })

  const dbByNum = new Map()
  for (const p of tracker) {
    const n = normalizePolicyNumber(p.policy_number)
    if (!n) continue
    if (!dbByNum.has(n)) dbByNum.set(n, [])
    dbByNum.get(n).push(p)
  }

  const nameOf = id => {
    const key = String(id ?? '').trim().toUpperCase()
    return nameFromSfgId[key] || key
  }
  const displayNameOf = new Map(
    (people ?? []).filter(p => p.sfg_id)
      .map(p => [p.sfg_id.trim().toUpperCase(), p.preferred_name?.trim() || p.opt_name?.trim() || p.sfg_id])
  )
  const label = id => displayNameOf.get(String(id ?? '').trim().toUpperCase()) ?? nameOf(id)

  // ── 1. Who is each agent in the file? ────────────────────────────────────
  const agents = groupLinesByAgent(snapshot_policies)
  const { resolved, unresolved } = resolveFileAgents({
    agents, people, dbByNum, scopeIds, overrides: agent_overrides,
  })

  const carriersOf = a => [...new Set(a.lines.map(l => normalizeCarrierLabel(l.carrier)).filter(Boolean))]
  const netOf      = a => a.lines.reduce((s, l) => s + l.apv, 0)

  const agentMatches = agents.filter(a => resolved.has(a.key)).map(a => {
    const r = resolved.get(a.key)
    return {
      agent_name:     a.name,
      sfg_id:         r.sfg_id,
      matched_name:   label(r.sfg_id),
      basis:          r.basis,
      exact:          r.exact,
      name_score:     Math.round(r.name_score * 100) / 100,
      policy_matches: r.votes,
      shared_matches: r.shared ?? 0,
      lines:          a.lines.length,
      snapshot_apv:   netOf(a),
      in_scope:       inCycleScope(r.sfg_id),
    }
  })

  const warnings = unresolved.map(u => {
    const a = agents.find(x => x.key === u.key)
    return {
      agent_name:   u.name,
      carrier:      carriersOf(a).join(', '),
      snapshot_apv: netOf(a),
      lines:        a.lines.length,
      candidates:   u.candidates,
    }
  })

  const resolvedLines = []
  for (const a of agents) {
    const r = resolved.get(a.key)
    if (!r) continue
    for (const l of a.lines) resolvedLines.push({ ...l, sfg_id: r.sfg_id })
  }
  const outOfScopeRows = resolvedLines.filter(l => !inCycleScope(l.sfg_id)).length

  // ── 2. Compare per agent + carrier, explained at the policy level ────────
  const { buckets, numberFixes } = adjudicateBuckets({
    lines: resolvedLines, tracker, window: snapshot_window, inScope: inCycleScope, nameOf: label,
    netChargebacks,
  })

  const isIssuedInWindow = p =>
    /^issued$/i.test(String(p.status ?? '').trim()) &&
    String(p.issue_date ?? '').slice(0, 10) >= snapshot_window.from &&
    String(p.issue_date ?? '').slice(0, 10) <= snapshot_window.to

  // Each bucket's issued policies, credited to that agent.
  for (const b of buckets) {
    const seen = new Set()
    b.issued = []
    for (const p of b.tracker_policies) {
      if (!isIssuedInWindow(p) || seen.has(p.id)) continue
      seen.add(p.id)
      b.issued.push({ ...p, sfg_id: b.sfg_id, issued_apv: creditedAmount(p, b.sfg_id, 'issued_apv') })
    }
  }

  // Duplicate policy numbers among what the tracker issued in the window.
  const byPolicyNum = {}
  const seenPolicyIds = new Set()
  for (const b of buckets) {
    for (const p of b.issued) {
      if (seenPolicyIds.has(p.id)) continue
      seenPolicyIds.add(p.id)
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
      agent:      label(p.sfg_id),
      carrier:    normalizeCarrierLabel(p.carrier),
      issue_date: p.issue_date ?? '',
      apv:        p.issued_apv ?? 0,
    }))
  )

  // ── 3. Which buckets need reporting? ─────────────────────────────────────
  const cleanAgents      = new Set()
  const discrepantAgents = new Set()
  const discrepancies    = []
  const flagged          = []

  for (const b of buckets) {
    const mechanical_flags = []
    if (b.issued.some(p => p.split_reset))                      mechanical_flags.push('Split/Reset policy')
    if (b.issued.some(p => p.splits?.length))                   mechanical_flags.push('Shared credit policy')
    if (b.issued.some(p => duplicateNums.has(p.policy_number))) mechanical_flags.push('Duplicate policy number')
    const hasHardFlag = b.issued.some(p => duplicateNums.has(p.policy_number))

    // Policy-level buckets judge the explained differences (carrier rounding on
    // individual policies is already netted out); lump buckets judge the delta.
    if (Math.abs(b.material) < min_diff && !hasHardFlag) { cleanAgents.add(b.sfg_id); continue }

    discrepantAgents.add(b.sfg_id)
    flagged.push({ ...b, mechanical_flags })
    discrepancies.push({
      sfg_id: b.sfg_id, agent_name: label(b.sfg_id), carrier: b.carrier,
      snapshot_apv: b.snapshot_apv, db_apv: b.tracker_net, delta: b.delta,
      mechanical_flags, policy_count: b.issued.length,
    })
  }

  // ── 4. Lump buckets get the bucket-level explanation the workbook uses ───
  const lumpAgents = [...new Set(flagged.filter(b => b.mode === 'lump').map(b => b.sfg_id))]
  const pools = await fetchCandidatePools(supabase, lumpAgents, snapshot_window)

  const upsertRows = []
  for (const b of flagged) {
    let candidates
    if (b.mode === 'lump') {
      const byAgent = arr => arr.filter(p => p.sfg_id?.trim().toUpperCase() === b.sfg_id
                                          && normalizeCarrierLabel(p.carrier) === b.carrier)
      candidates = matchCandidates({
        delta:          b.delta,
        carrier:        b.carrier,
        // On a final ledger a chargeback already logged for this month is already
        // netted out of the tracker figure, so it can't also explain what's left over.
        chargebacks:    byAgent(pools.cbAll).filter(p => !netChargebacks || !chargebackLoggedIn(p, snapshot_window)),
        nonIssued:      byAgent(pools.nonIssuedAll),
        straddle:       byAgent(pools.straddleAll),
        notTaken:       byAgent(pools.notTakenAll),
        issuedPolicies: b.issued,
      })
    } else {
      candidates = [...b.items].sort((x, y) => Math.abs(y.delta_contribution) - Math.abs(x.delta_contribution))
    }

    const agentName = label(b.sfg_id)
    upsertRows.push({
      cycle_id:        cycleId,
      sfg_id:          b.sfg_id,
      carrier:         b.carrier,
      snapshot_apv:    b.snapshot_apv,
      db_apv:          b.tracker_net,
      delta:           b.delta,
      policy_count:    b.issued.length,
      mechanical_flags: b.mechanical_flags,
      issued_policies: JSON.stringify(b.issued.map(p => ({
        id:            p.id,
        policy_number: p.policy_number ?? '',
        applicant:     p.applicant     ?? '',
        carrier:       normalizeCarrierLabel(p.carrier),
        issue_date:    p.issue_date    ?? '',
        issued_apv:    p.issued_apv    ?? null,
        split_reset:   p.split_reset   ?? false,
        splits:        p.splits        ?? null,
        policy_notes:  p.policy_notes  ?? '',
        agent_name:    agentName,
      }))),
      non_issued_policies:   '[]',
      chargeback_candidates: '[]',
      prior_in_window:       '[]',
      claude_hypothesis:     JSON.stringify({
        candidates,
        unmatched: candidates.length === 0,
        source:    'policy_lines',
        tracker:   { issued: b.tracker_issued, chargebacks: b.tracker_chargebacks },
        matched_lines: b.matched,
        rounding:  Math.round(b.rounding * 100) / 100,
        lump:      b.mode === 'lump',
      }),
    })
  }

  // What the file says per in-scope agent + carrier (drives the coverage check).
  const snapshotBySfgCarrier = {}
  for (const b of buckets) {
    if (b.file_lines > 0) snapshotBySfgCarrier[`${b.sfg_id}||${b.carrier}`] = b.snapshot_apv
  }

  return {
    warnings, outOfScopeRows, snapshotBySfgCarrier, duplicate_policies,
    discrepancies, cleanAgents, discrepantAgents, upsertRows,
    totalAgents: agents.length,
    agentMatches,
    numberFixes: numberFixes.map(f => ({ ...f, agent_name: label(f.sfg_id) })),
    lineCount: snapshot_policies.length,
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!(await requireSuperAdmin(req, res))) return

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  const {
    cycle_id,
    min_diff = 1.50,
    snapshot_window,
    snapshot_agents = [],
    snapshot_policies = [],
    agent_overrides = {},
    phase = 'draft',
  } = req.body ?? {}

  if (!cycle_id || !snapshot_window?.from || !snapshot_window?.to) {
    return res.status(400).json({ error: 'cycle_id, snapshot_window.from, and snapshot_window.to are required' })
  }
  if (!Object.hasOwn(RECON_TABLES, phase)) {
    return res.status(400).json({ error: "phase must be 'draft' or 'final'" })
  }
  const reconTable      = RECON_TABLES[phase]
  const netChargebacks  = phase === 'final'

  // The payload, not a flag, decides the format: policy lines win when present.
  const isPolicyLines = Array.isArray(snapshot_policies) && snapshot_policies.length > 0
  if (isPolicyLines && !snapshot_policies.every(l => l && typeof l.agent_name === 'string' && Number.isFinite(Number(l.apv)))) {
    return res.status(400).json({ error: 'Every policy line needs an agent_name and a numeric apv' })
  }

  try {
    // ── 1. Resolve the cycle ─────────────────────────────────────────────────
    // Addressed by id, not month: a month can now hold one cycle per agency
    // owner, so month alone no longer identifies which run this belongs to.
    const { data: cycle, error: cycleErr } = await supabase
      .from('snapshot_cycles')
      .select('id, month, completed_at')
      .eq('id', cycle_id)
      .single()
    if (cycleErr || !cycle) return res.status(404).json({ error: 'Cycle not found' })
    if (cycle.completed_at) {
      return res.status(409).json({ error: 'This cycle is closed — reopen it before re-running.' })
    }
    const cycleId = cycle.id
    const month   = cycle.month

    // Final Review keeps its results in a table of their own. Check it is there
    // before doing any work, rather than after a run that then can't be saved.
    if (phase === 'final') {
      const { error: probeErr } = await supabase.from(reconTable).select('id').limit(1)
      if (probeErr) {
        const missing = probeErr.code === 'PGRST205' || probeErr.code === '42P01'
        return res.status(missing ? 409 : 500).json({
          error: missing
            ? "Final Review isn't set up in the database yet. Run scripts/migration-snapshot-final-review.sql in the Supabase SQL editor, then run the comparison again."
            : probeErr.message,
        })
      }
    }

    await supabase.from('snapshot_cycles').update({
      snapshot_date_from: snapshot_window.from,
      snapshot_date_to:   snapshot_window.to,
    }).eq('id', cycleId)

    // ── 2. Build name crosswalk from personnel ───────────────────────────────
    const { data: people } = await supabase
      .from('personnel')
      .select('sfg_id, opt_name, preferred_name, upline_sfg_id, status')

    const nameCrosswalk = {}  // opt_name.toLowerCase() → sfg_id
    const nameFromSfgId = {}  // sfg_id.toUpperCase()  → opt_name
    for (const p of people ?? []) {
      if (p.opt_name) nameCrosswalk[p.opt_name.trim().toLowerCase()] = p.sfg_id
      if (p.sfg_id)  nameFromSfgId[p.sfg_id.trim().toUpperCase()]  = p.opt_name ?? ''
    }

    // ── 2b. Restrict to the baseshops this cycle declared ────────────────────
    // Opt can only export an owner plus their whole downline, so the uploaded
    // file is routinely a superset of what this cycle is responsible for. The
    // file is authoritative for the numbers; the cycle's scope decides which
    // agents those numbers apply to, and everything else is ignored rather than
    // reported as a discrepancy. A legacy cycle has no scope rows and keeps the
    // old behavior of covering everyone in the file.
    const { data: scopeRows } = await supabase
      .from('snapshot_cycle_scopes')
      .select('owner_sfg_id')
      .eq('cycle_id', cycleId)
    const scopeOwners = (scopeRows ?? []).map(r => r.owner_sfg_id).filter(Boolean)

    let scopeIds = null                       // null = unscoped (legacy cycle)
    const baseshopOf = {}                     // owner sfg_id → Set of their agents
    if (scopeOwners.length) {
      const { data: promoRows } = await supabase
        .from('agent_promotions')
        .select('sfg_id, promotion_type, level, month_1, month_2, month_3, slingshot_month, is_slingshot')
      const ownerIds = ownerIdsFromPromotions(promoRows)
      scopeIds = new Set()
      for (const owner of scopeOwners) {
        const ids = getBaseshopIds(owner, people ?? [], ownerIds)
        baseshopOf[owner.toUpperCase()] = new Set([...ids].map(id => id.toUpperCase()))
        for (const id of ids) scopeIds.add(id.toUpperCase())
      }
    }
    const inCycleScope = id => scopeIds === null || scopeIds.has(String(id ?? '').trim().toUpperCase())

    // ── 3–8. Compare the file to the tracker ─────────────────────────────────
    const result = isPolicyLines
      ? await comparePolicyLines({
          supabase, cycleId, snapshot_policies, agent_overrides, snapshot_window, min_diff,
          people, nameFromSfgId, inCycleScope, scopeIds, netChargebacks,
        })
      : await compareAgentTotals({
          supabase, cycleId, snapshot_agents, snapshot_window, min_diff,
          nameCrosswalk, nameFromSfgId, inCycleScope, netChargebacks,
        })

    const {
      warnings, outOfScopeRows, snapshotBySfgCarrier, duplicate_policies,
      discrepancies, cleanAgents, discrepantAgents, upsertRows, totalAgents,
    } = result

    // ── 9. Replace reconciliations for the agents in THIS run ────────────────
    //
    // Scoped to the agents this run actually covered, not the whole cycle. A
    // Snapshot export only ever covers one owner's downline, so a cycle is fed
    // incrementally by however many exports it takes to cover its scope —
    // wiping the whole cycle here would delete (and discard the resolutions on)
    // every agent absent from the file currently being uploaded.
    //
    // Every sfg_id seen in this run lands in one of these two sets, so an agent
    // who was discrepant last run and is clean now still gets their stale row
    // removed. An agent absent from this run's file keeps their existing rows —
    // that is the point, and it is also why a re-run cannot tell "out of scope"
    // apart from "dropped out entirely". Once a cycle carries an explicit
    // declared scope, this can tighten to that scope instead.
    const runSfgIds = [...new Set([...cleanAgents, ...discrepantAgents])]
    if (runSfgIds.length > 0) {
      const { error } = await supabase
        .from(reconTable)
        .delete()
        .eq('cycle_id', cycleId)
        .in('sfg_id', runSfgIds)
      if (error) throw error
    }
    if (upsertRows.length > 0) {
      const { error } = await supabase.from(reconTable).insert(upsertRows)
      if (error) throw error
    }

    // Per-owner coverage. An owner the cycle claims but the file says nothing
    // about almost always means the wrong export was uploaded — selecting four
    // agencies and uploading one owner's file would otherwise silently report
    // every unmentioned agent as a discrepancy worth their entire APV.
    const agentsInFile = new Set(
      Object.keys(snapshotBySfgCarrier).map(k => k.split('||')[0].toUpperCase())
    )
    const coverage = scopeOwners.map(owner => {
      const shop = baseshopOf[owner.toUpperCase()] ?? new Set()
      let covered = 0
      for (const id of agentsInFile) if (shop.has(id)) covered++
      return {
        owner_sfg_id:   owner,
        owner_name:     nameFromSfgId[owner.toUpperCase()] || owner,
        agents_in_file: covered,
        baseshop_size:  shop.size,
      }
    })

    return res.status(200).json({
      cycle_id: cycleId,
      month,
      snapshot_window,
      phase,
      source_format: isPolicyLines ? 'policy_lines' : 'agent_totals',
      duplicate_policies,
      discrepancies,
      unmatched_agents: warnings,
      agent_matches:       result.agentMatches ?? [],
      policy_number_fixes: result.numberFixes  ?? [],
      coverage,
      summary: {
        total_snapshot_agents: totalAgents,
        discrepant_agents:     discrepantAgents.size,
        clean_agents:          cleanAgents.size,
        unmatched:             warnings.length,
        out_of_scope_rows:     outOfScopeRows,
        uncovered_owners:      coverage.filter(c => c.agents_in_file === 0).length,
        ...(isPolicyLines ? { lines: result.lineCount } : {}),
      },
    })
  } catch (err) {
    console.error('[snapshot/run]', err)
    return res.status(500).json({ error: err?.message ?? 'Failed to run snapshot comparison' })
  }
}
