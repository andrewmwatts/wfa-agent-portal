import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import { requireSuperAdmin } from '../_auth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../../.env.local') })

/**
 * POST /api/snapshot/analyze
 * Body: { reconciliation_id: "uuid" }
 *
 * Runs deterministic candidate matching to identify the most likely cause of a
 * discrepancy. Checks, in order: chargebacks, non-issued policies in snapshot,
 * effective-date straddles, not-taken chargebacks, missing-from-snapshot policies.
 * Stores result as JSON in claude_hypothesis.
 */

const CARRIER_ALIASES = {
  'American General': ['American General', 'Corebridge'],
  'TransAmerica':     ['TransAmerica', 'Transamerica Group'],
  'Banner':           ['Banner', 'LGA'],
}

// Carriers that round to the nearest dollar (vs. exact cents)
const DOLLAR_ROUND_CARRIERS = new Set(['Americo', 'Mutual of Omaha'])

function tolerance(carrier) {
  return DOLLAR_ROUND_CARRIERS.has(carrier) ? 1.00 : 0.02
}

function near(a, b, tol) {
  return Math.abs(a - b) <= tol
}

function safeJson(val) {
  if (!val) return null
  if (typeof val === 'object') return val
  try { return JSON.parse(val) } catch { return null }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!(await requireSuperAdmin(req, res))) return

  const { reconciliation_id } = req.body ?? {}
  if (!reconciliation_id) return res.status(400).json({ error: 'reconciliation_id is required' })

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  try {
    // Load reconciliation + parent cycle for window dates
    const { data: rec, error: recErr } = await supabase
      .from('snapshot_reconciliations')
      .select('*, snapshot_cycles(month, snapshot_date_from, snapshot_date_to)')
      .eq('id', reconciliation_id)
      .single()
    if (recErr || !rec) return res.status(404).json({ error: 'Reconciliation not found' })

    const cycle      = rec.snapshot_cycles
    const windowFrom = cycle?.snapshot_date_from
    const windowTo   = cycle?.snapshot_date_to
    const sfgId      = rec.sfg_id
    const carrier    = rec.carrier
    const delta      = rec.delta          // snapshot_apv - db_apv (negative = tracker > snapshot)
    const absDelta   = Math.abs(delta)
    const tol        = tolerance(carrier)

    const issuedPolicies  = safeJson(rec.issued_policies) ?? []
    const carrierVariants = CARRIER_ALIASES[carrier] ?? [carrier]

    // Date bounds for straddle check: issued 1–31 days after the window
    const dayAfterWindow = windowTo
      ? new Date(new Date(windowTo).getTime() + 86400000).toISOString().slice(0, 10)
      : null
    const straddleEnd = windowTo
      ? new Date(new Date(windowTo).getTime() + 31 * 86400000).toISOString().slice(0, 10)
      : null

    // Fetch all candidate pools in parallel
    const [cbRes, nonIssuedRes, straddleRes, notTakenRes] = await Promise.all([
      // Chargebacks: any issued policy for this agent/carrier with a conservation_date set.
      // No strict window filter — carriers sometimes charge 1–2 months after conservation.
      supabase
        .from('policies')
        .select('id, policy_number, applicant, carrier, issue_date, issued_apv, conservation_status, conservation_date')
        .eq('sfg_id', sfgId)
        .in('carrier', carrierVariants)
        .ilike('status', 'issued')
        .not('conservation_date', 'is', null),

      // Non-issued (Pending/Incomplete): carrier may be reporting these positively
      supabase
        .from('policies')
        .select('id, policy_number, applicant, carrier, issued_apv, status, submit_date')
        .eq('sfg_id', sfgId)
        .in('carrier', carrierVariants)
        .in('status', ['Pending', 'Incomplete', 'pending', 'incomplete']),

      // Effective-date straddle: issued just after the window — carrier credits in their date
      dayAfterWindow && straddleEnd
        ? supabase
            .from('policies')
            .select('id, policy_number, applicant, carrier, issue_date, issued_apv')
            .eq('sfg_id', sfgId)
            .in('carrier', carrierVariants)
            .ilike('status', 'issued')
            .gte('issue_date', dayAfterWindow)
            .lte('issue_date', straddleEnd)
        : Promise.resolve({ data: [] }),

      // Not taken: may be treated as a chargeback by the carrier
      supabase
        .from('policies')
        .select('id, policy_number, applicant, carrier, issued_apv, status')
        .eq('sfg_id', sfgId)
        .in('carrier', carrierVariants)
        .ilike('status', 'not taken'),
    ])

    const candidates = []

    // ── Chargebacks (snapshot < tracker, delta < 0) ──────────────────────────
    for (const p of cbRes.data ?? []) {
      const apv = Number(p.issued_apv) || 0
      if (!apv) continue

      if (near(apv, absDelta, tol)) {
        candidates.push({
          type:                'chargeback',
          flag:                'Log chargeback',
          match:               'full',
          policy_id:           p.id,
          policy_number:       p.policy_number,
          applicant:           p.applicant,
          issued_apv:          apv,
          conservation_date:   p.conservation_date,
          conservation_status: p.conservation_status,
          delta_contribution:  apv,
        })
        continue
      }

      // Prorated chargeback (n/12 of issued APV)
      for (let n = 1; n <= 11; n++) {
        const prorated = Math.round(apv * n / 12 * 100) / 100
        if (near(prorated, absDelta, tol)) {
          candidates.push({
            type:                'chargeback',
            flag:                'Log chargeback',
            match:               `${n}/12`,
            policy_id:           p.id,
            policy_number:       p.policy_number,
            applicant:           p.applicant,
            issued_apv:          apv,
            conservation_date:   p.conservation_date,
            conservation_status: p.conservation_status,
            delta_contribution:  prorated,
          })
          break
        }
      }
    }

    // ── Non-issued in snapshot (snapshot > tracker, delta > 0) ───────────────
    if (delta > 0) {
      for (const p of nonIssuedRes.data ?? []) {
        const apv = Number(p.issued_apv) || 0
        if (apv && near(apv, delta, tol)) {
          candidates.push({
            type:               'non_issued',
            flag:               'Flag for review',
            match:              'full',
            policy_id:          p.id,
            policy_number:      p.policy_number,
            applicant:          p.applicant,
            issued_apv:         apv,
            status:             p.status,
            submit_date:        p.submit_date,
            delta_contribution: apv,
          })
        }
      }
    }

    // ── Effective-date straddle (delta < 0) ───────────────────────────────────
    if (delta < 0) {
      for (const p of straddleRes.data ?? []) {
        const apv = Number(p.issued_apv) || 0
        if (apv && near(apv, absDelta, tol)) {
          candidates.push({
            type:               'straddle',
            flag:               'Confirm issue/effective date',
            match:              'full',
            policy_id:          p.id,
            policy_number:      p.policy_number,
            applicant:          p.applicant,
            issued_apv:         apv,
            issue_date:         p.issue_date,
            delta_contribution: apv,
          })
        }
      }
    }

    // ── Not taken (delta < 0) ─────────────────────────────────────────────────
    if (delta < 0) {
      for (const p of notTakenRes.data ?? []) {
        const apv = Number(p.issued_apv) || 0
        if (apv && near(apv, absDelta, tol)) {
          candidates.push({
            type:               'not_taken',
            flag:               'Remove chargeback',
            match:              'full',
            policy_id:          p.id,
            policy_number:      p.policy_number,
            applicant:          p.applicant,
            issued_apv:         apv,
            delta_contribution: apv,
          })
        }
      }
    }

    // ── Missing from snapshot (fallback, delta < 0) ───────────────────────────
    // If no other candidate accounts for the delta, check whether any individual
    // issued policy in the window matches — it may simply not appear in the snapshot.
    if (candidates.length === 0 && delta < 0 && issuedPolicies.length > 0) {
      for (const p of issuedPolicies) {
        const apv = Number(p.issued_apv) || 0
        if (apv && near(apv, absDelta, tol)) {
          candidates.push({
            type:               'missing',
            flag:               'Missing from snapshot',
            match:              'full',
            policy_id:          p.id,
            policy_number:      p.policy_number,
            applicant:          p.applicant,
            issued_apv:         apv,
            issue_date:         p.issue_date,
            delta_contribution: apv,
          })
        }
      }
    }

    const result = { candidates, unmatched: candidates.length === 0 }

    await supabase
      .from('snapshot_reconciliations')
      .update({ claude_hypothesis: JSON.stringify(result) })
      .eq('id', reconciliation_id)

    return res.status(200).json(result)
  } catch (err) {
    console.error('[snapshot/analyze]', err)
    return res.status(500).json({ error: err?.message ?? 'Failed to analyze reconciliation' })
  }
}
