import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import { requireSuperAdmin } from '../_auth.js'
import { loadAllSplits, fetchPoliciesForAgents, explodeCreditedRows } from '../_policySplits.js'
import { fetchTrackerPolicies } from '../_snapshotTracker.js'
import { creditedAmount } from '../../shared/policySplit.js'
import { getBaseshopIds, ownerIdsFromPromotions } from '../../shared/agencyScope.js'
import { normalizeSnapshotCarrier, CORE_CARRIERS } from '../../shared/snapshotFile.js'
import {
  groupLinesByAgent, resolveFileAgents, adjudicateBuckets, normalizePolicyNumber, bucketCarrier,
} from '../../shared/snapshotReconcile.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../../.env.local') })

/**
 * POST /api/snapshot/run
 *
 * Takes either Snapshot export, or both together:
 *   snapshot_agents   [{ agent_name, carrier, snapshot_apv }]   the Snapshot workbook:
 *                     one figure per agent + carrier, EVERY carrier, no policy detail
 *   snapshot_policies [{ agent_name, policy_number, client, apv, carrier, ... }]
 *                     a Placed Policies export: one line per policy transaction, but
 *                     only for the core carriers
 *
 * Both together is the intended way to run it — the workbook makes the book complete,
 * the policy lines make it explainable — but either alone is accepted. Without the
 * workbook, any business with a carrier the policy export doesn't cover has no
 * Snapshot figure at all and reads as missing; the caller warns before running that way.
 *
 *   1. Resolve every agent name across both exports at once — policy numbers first,
 *      names as corroboration, manual overrides on top
 *   2. Merge the two into one bucket per agent + carrier: the workbook sets the total,
 *      the policy lines itemize it, and what they can't itemize is carried as one item
 *      (shared/snapshotReconcile.js)
 *   3. Itemized buckets are judged on their explained differences; the rest get the
 *      bucket-level candidate search the workbook has always used
 *   4. Report a bucket when |material| >= min_diff, or on a hard mechanical flag
 *
 * Results are stored in snapshot_reconciliations.
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

// ── Comparing Snapshot with the tracker ─────────────────────────────────────

/**
 * Reconciles whichever Snapshot exports were uploaded against the tracker.
 *
 * Both exports describe the same production, differently:
 *   snapshot_agents   the Snapshot workbook — one figure per agent + carrier, every
 *                     carrier. Complete, no policy detail.
 *   snapshot_policies a Placed Policies export — one line per policy transaction,
 *                     core carriers only. Detailed, not complete.
 *
 * Either alone is enough to run; together they reconcile the whole book at policy
 * level wherever the detail reaches. Agent names are resolved across both at once,
 * so a name settled by one export's policy numbers — or by hand — also settles the
 * other's rows. The merge itself lives in adjudicateBuckets(); what comes back is a
 * bucket per agent + carrier, itemized ('policy') or not ('lump'), and a lump is
 * explained the way the workbook has always been explained: by looking for a
 * candidate that accounts for the difference.
 */
async function compareFiles({
  supabase, cycleId, snapshot_agents, snapshot_policies, agent_overrides, snapshot_window,
  min_diff, people, nameFromSfgId, inCycleScope, scopeIds, netChargebacks = false,
}) {
  const hasWorkbook    = snapshot_agents.length > 0
  const hasPolicyLines = snapshot_policies.length > 0

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

  // ── 1. Who is each agent, across both exports? ───────────────────────────
  // Workbook rows join the resolver as lines with no policy number: they cast no
  // vote of their own, but they are matched by the same name logic and the same
  // manual overrides, and a person the policy export identified by policy number is
  // then already known when their workbook row comes through under another spelling.
  const policyLines = snapshot_policies.map(l => ({ ...l, source: 'policy_lines' }))
  const workbookRows = snapshot_agents
    .filter(r => Number(r.snapshot_apv) !== 0)
    .map(r => ({
      agent_name: r.agent_name, carrier: r.carrier, apv: Number(r.snapshot_apv) || 0,
      policy_number: '', client: '', product: '', source: 'agent_totals',
    }))

  const agents = groupLinesByAgent([...policyLines, ...workbookRows])
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
      sources:        [...new Set(a.lines.map(l => l.source))],
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

  // ── 2. Split the resolved rows back into the two shapes ──────────────────
  const lines = []                    // policy lines, now carrying an sfg_id
  const agentTotals = new Map()       // `sfg||carrier` → workbook APV
  let outOfScopeRows = 0
  for (const a of agents) {
    const r = resolved.get(a.key)
    if (!r) continue
    for (const l of a.lines) {
      if (!inCycleScope(r.sfg_id)) { outOfScopeRows++; continue }
      if (l.source === 'policy_lines') {
        lines.push({ ...l, sfg_id: r.sfg_id })
      } else {
        const k = `${r.sfg_id}||${bucketCarrier(l.carrier)}`
        agentTotals.set(k, (agentTotals.get(k) ?? 0) + l.apv)
      }
    }
  }

  // ── 3. Merge and compare, explained per policy wherever the detail reaches ─
  const { buckets, numberFixes } = adjudicateBuckets({
    lines,
    agentTotals: hasWorkbook ? agentTotals : null,
    tracker, window: snapshot_window, inScope: inCycleScope, nameOf: label, netChargebacks,
    gapTolerance: min_diff,
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

  // Where the two exports disagree about the same agent + carrier. They are two
  // presentations of one source, so this is a problem with a file, not with the
  // tracker — surfaced on its own rather than buried in a discrepancy card.
  const source_conflicts = buckets
    .filter(b => b.source_gap != null)
    .map(b => ({
      sfg_id: b.sfg_id, agent_name: label(b.sfg_id), carrier: b.carrier,
      workbook_apv: b.workbook_apv, line_apv: b.line_apv, gap: b.source_gap,
    }))
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))

  // ── 4. Which buckets need reporting? ─────────────────────────────────────
  const cleanAgents      = new Set()
  const discrepantAgents = new Set()
  const discrepancies    = []
  const flagged          = []

  for (const b of buckets) {
    const mechanical_flags = []
    if (b.issued.some(p => p.split_reset))                      mechanical_flags.push('Split/Reset policy')
    if (b.issued.some(p => p.splits?.length))                   mechanical_flags.push('Shared credit policy')
    if (b.issued.some(p => duplicateNums.has(p.policy_number))) mechanical_flags.push('Duplicate policy number')
    if (b.source_gap != null)                                   mechanical_flags.push('Snapshot exports disagree')
    const hasHardFlag = b.issued.some(p => duplicateNums.has(p.policy_number))

    // Itemized buckets judge the explained differences (carrier rounding on
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

  // ── 5. Lump buckets get the bucket-level explanation ─────────────────────
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
        source:    b.mode === 'lump' ? 'lump' : 'policy_lines',
        tracker:   { issued: b.tracker_issued, chargebacks: b.tracker_chargebacks },
        matched_lines: b.matched,
        rounding:  Math.round(b.rounding * 100) / 100,
        lump:      b.mode === 'lump',
        ...(b.source_gap != null
          ? { source_gap: { workbook: b.workbook_apv, lines: b.line_apv, gap: b.source_gap } }
          : {}),
      }),
    })
  }

  // What Snapshot says per in-scope agent + carrier (drives the coverage check).
  const snapshotBySfgCarrier = {}
  for (const b of buckets) {
    if (b.file_lines > 0 || b.workbook_apv != null) {
      snapshotBySfgCarrier[`${b.sfg_id}||${b.carrier}`] = b.snapshot_apv
    }
  }

  // Carriers the policy export can't speak for. Without the workbook these would
  // have no Snapshot figure at all and would read as missing from Snapshot.
  const uncoveredCarriers = [...new Set(
    buckets.filter(b => b.mode === 'lump' && !CORE_CARRIERS.has(b.carrier) && b.snapshot_apv !== 0)
      .map(b => b.carrier)
  )].sort()

  return {
    warnings, outOfScopeRows, snapshotBySfgCarrier, duplicate_policies,
    discrepancies, cleanAgents, discrepantAgents, upsertRows,
    totalAgents: agents.length,
    agentMatches,
    numberFixes: numberFixes.map(f => ({ ...f, agent_name: label(f.sfg_id) })),
    sourceConflicts: source_conflicts,
    uncoveredCarriers,
    lineCount: snapshot_policies.length,
    workbookRows: workbookRows.length,
    itemizedBuckets: buckets.filter(b => b.mode === 'policy').length,
    lumpBuckets:     buckets.filter(b => b.mode === 'lump').length,
    hasWorkbook, hasPolicyLines,
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

  // Either export runs on its own; both together is the intended way.
  const policyLines = Array.isArray(snapshot_policies) ? snapshot_policies : []
  const agentRows   = Array.isArray(snapshot_agents)   ? snapshot_agents   : []
  if (!policyLines.length && !agentRows.length) {
    return res.status(400).json({ error: 'Upload a Snapshot export or a Placed Policies export before running.' })
  }
  if (!policyLines.every(l => l && typeof l.agent_name === 'string' && Number.isFinite(Number(l.apv)))) {
    return res.status(400).json({ error: 'Every policy line needs an agent_name and a numeric apv' })
  }
  if (!agentRows.every(r => r && typeof r.agent_name === 'string' && Number.isFinite(Number(r.snapshot_apv)))) {
    return res.status(400).json({ error: 'Every Snapshot row needs an agent_name and a numeric snapshot_apv' })
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

    // ── 2. Load the roster ───────────────────────────────────────────────────
    // Names are matched inside compareFiles, which scores against both the Opt name
    // and the preferred name rather than looking one spelling up in a crosswalk.
    const { data: people } = await supabase
      .from('personnel')
      .select('sfg_id, opt_name, preferred_name, upline_sfg_id, status')

    const nameFromSfgId = {}  // sfg_id.toUpperCase() → opt_name
    for (const p of people ?? []) {
      if (p.sfg_id) nameFromSfgId[p.sfg_id.trim().toUpperCase()] = p.opt_name ?? ''
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

    // ── 3–8. Merge the uploaded exports and compare them to the tracker ──────
    const result = await compareFiles({
      supabase, cycleId,
      snapshot_agents: agentRows, snapshot_policies: policyLines,
      agent_overrides, snapshot_window, min_diff,
      people, nameFromSfgId, inCycleScope, scopeIds, netChargebacks,
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
      // Which exports this run actually merged.
      sources: {
        agent_totals: result.hasWorkbook,
        policy_lines: result.hasPolicyLines,
      },
      source_format: result.hasPolicyLines ? 'policy_lines' : 'agent_totals',
      duplicate_policies,
      discrepancies,
      unmatched_agents: warnings,
      agent_matches:       result.agentMatches ?? [],
      policy_number_fixes: result.numberFixes  ?? [],
      source_conflicts:    result.sourceConflicts ?? [],
      uncovered_carriers:  result.uncoveredCarriers ?? [],
      coverage,
      summary: {
        total_snapshot_agents: totalAgents,
        discrepant_agents:     discrepantAgents.size,
        clean_agents:          cleanAgents.size,
        unmatched:             warnings.length,
        out_of_scope_rows:     outOfScopeRows,
        uncovered_owners:      coverage.filter(c => c.agents_in_file === 0).length,
        conflicts:             result.sourceConflicts?.length ?? 0,
        itemized_buckets:      result.itemizedBuckets,
        lump_buckets:          result.lumpBuckets,
        ...(result.hasPolicyLines ? { lines: result.lineCount } : {}),
        ...(result.hasWorkbook   ? { snapshot_rows: result.workbookRows } : {}),
      },
    })
  } catch (err) {
    console.error('[snapshot/run]', err)
    return res.status(500).json({ error: err?.message ?? 'Failed to run snapshot comparison' })
  }
}
