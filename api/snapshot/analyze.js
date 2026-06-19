import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { requireSuperAdmin } from '../_auth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../../.env.local') })

/**
 * POST /api/snapshot/analyze
 * Body: { reconciliation_id: "uuid" }
 *
 * Fetches broader context for the discrepant agent+carrier (non-issued policies,
 * prior-month policies, chargebacks) then asks Claude to hypothesize the cause.
 */

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

    const cycle       = rec.snapshot_cycles
    const windowFrom  = cycle?.snapshot_date_from
    const windowTo    = cycle?.snapshot_date_to
    const sfgId       = rec.sfg_id
    const carrier     = rec.carrier

    // Agent name
    const { data: person } = await supabase
      .from('personnel')
      .select('opt_name')
      .ilike('sfg_id', sfgId)
      .maybeSingle()
    const agentName = person?.opt_name ?? sfgId

    // Normalize carrier for DB queries (the stored carrier is already normalized)
    const CARRIER_ALIASES = {
      'American General': ['American General', 'Corebridge'],
      'TransAmerica':     ['TransAmerica', 'Transamerica Group'],
      'Banner':           ['Banner', 'LGA'],
    }
    const carrierVariants = CARRIER_ALIASES[carrier] ?? [carrier]

    // Fetch broader context for this agent+carrier (90-day window around the snapshot)
    const broadFrom = windowFrom
      ? new Date(new Date(windowFrom).getTime() - 90 * 86400000).toISOString().slice(0, 10)
      : null

    const [nonIssuedRes, priorIssuedRes] = await Promise.all([
      // Non-issued (pending/incomplete) policies — any date
      supabase
        .from('policies')
        .select('policy_number, applicant, carrier, issue_date, issued_apv, status, submit_date')
        .eq('sfg_id', sfgId)
        .in('status', ['Pending', 'Incomplete', 'pending', 'incomplete'])
        .in('carrier', carrierVariants),

      // Issued policies in the 90 days BEFORE the window (possible timing issues)
      broadFrom && windowFrom
        ? supabase
          .from('policies')
          .select('policy_number, applicant, carrier, issue_date, issued_apv, conservation_status, snapshot_chargeback_month, snapshot_chargeback_apv')
          .eq('sfg_id', sfgId)
          .ilike('status', 'issued')
          .in('carrier', carrierVariants)
          .gte('issue_date', broadFrom)
          .lt('issue_date', windowFrom)
        : Promise.resolve({ data: [] }),
    ])

    // Chargebacks: issued policies with conservation_status set, in broader window
    const chargebackRes = await supabase
      .from('policies')
      .select('policy_number, applicant, carrier, issue_date, issued_apv, conservation_status, conservation_date, snapshot_chargeback_month, snapshot_chargeback_apv')
      .eq('sfg_id', sfgId)
      .in('carrier', carrierVariants)
      .ilike('status', 'issued')
      .not('conservation_status', 'is', null)

    const issuedPolicies    = safeJson(rec.issued_policies) ?? []
    const nonIssuedPolicies = nonIssuedRes.data            ?? []
    const priorInWindow     = priorIssuedRes.data          ?? []
    const cbCandidates      = (chargebackRes.data ?? []).filter(p => p.conservation_status?.trim())

    const prompt = buildPrompt({
      agentName,
      carrier,
      month:          cycle?.month,
      windowFrom,
      windowTo,
      snapshotApv:    rec.snapshot_apv,
      dbApv:          rec.db_apv,
      delta:          rec.delta,
      mechanicalFlags: rec.mechanical_flags ?? [],
      issuedPolicies,
      nonIssuedPolicies,
      priorInWindow,
      cbCandidates,
    })

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const message = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 1000,
      messages:   [{ role: 'user', content: prompt }],
    })

    const hypothesis = message.content?.[0]?.text ?? ''

    await supabase
      .from('snapshot_reconciliations')
      .update({ claude_hypothesis: hypothesis })
      .eq('id', reconciliation_id)

    return res.status(200).json({ hypothesis })
  } catch (err) {
    console.error('[snapshot/analyze]', err)
    return res.status(500).json({ error: err?.message ?? 'Failed to analyze reconciliation' })
  }
}

function safeJson(val) {
  if (!val) return null
  if (typeof val === 'object') return val
  try { return JSON.parse(val) } catch { return null }
}

function fmtApv(n) {
  if (typeof n !== 'number') return '—'
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function buildPrompt({ agentName, carrier, month, windowFrom, windowTo,
                       snapshotApv, dbApv, delta, mechanicalFlags,
                       issuedPolicies, nonIssuedPolicies, priorInWindow, cbCandidates }) {
  const dir = delta > 0 ? 'Snapshot higher than tracker' : 'Tracker higher than snapshot'
  const lines = [
    `You are reviewing a monthly Snapshot reconciliation for a life insurance agency.`,
    ``,
    `Agent: ${agentName}`,
    `Carrier: ${carrier}`,
    `Month: ${month ?? 'unknown'} (window ${windowFrom} – ${windowTo})`,
    `Snapshot APV (carrier HQ report): ${fmtApv(snapshotApv)}`,
    `Tracker APV (internal DB, issued in window): ${fmtApv(dbApv)}`,
    `Delta: ${fmtApv(delta)} (${dir})`,
    ``,
  ]

  if (mechanicalFlags.length) {
    lines.push(`Mechanical flags: ${mechanicalFlags.join(', ')}`, '')
  }

  if (issuedPolicies.length) {
    lines.push(`Issued policies recorded in window (${issuedPolicies.length}):`)
    for (const p of issuedPolicies) {
      lines.push(`  - ${p.applicant} | #${p.policy_number} | ${p.issue_date} | ${fmtApv(p.issued_apv)}${p.split_reset ? ' | SPLIT/RESET' : ''}`)
    }
    lines.push('')
  } else {
    lines.push(`No issued policies recorded in our tracker for this agent+carrier in the window.`, '')
  }

  if (priorInWindow.length) {
    lines.push(`Issued policies in the 90 days BEFORE the window (may be flowing into snapshot):`)
    for (const p of priorInWindow) {
      lines.push(`  - ${p.applicant} | #${p.policy_number} | issued ${p.issue_date} | ${fmtApv(p.issued_apv)}${p.conservation_status ? ` | Conservation: ${p.conservation_status}` : ''}`)
    }
    lines.push('')
  }

  if (cbCandidates.length) {
    lines.push(`Chargeback candidates (issued policies with conservation status):`)
    for (const p of cbCandidates) {
      lines.push(`  - ${p.applicant} | #${p.policy_number} | ${fmtApv(p.issued_apv)} | ${p.conservation_status}${p.snapshot_chargeback_apv ? ` | CB APV: ${fmtApv(p.snapshot_chargeback_apv)}` : ''}`)
    }
    lines.push('')
  }

  if (nonIssuedPolicies.length) {
    lines.push(`Pending/incomplete policies for this agent+carrier (not yet issued):`)
    for (const p of nonIssuedPolicies) {
      lines.push(`  - ${p.applicant} | #${p.policy_number} | submitted ${p.submit_date ?? 'unknown'} | status: ${p.status}`)
    }
    lines.push('')
  }

  lines.push(
    `Based on this information, provide a concise hypothesis (2–4 sentences) explaining the most likely reason for the discrepancy. Focus on: what might account for the delta, what to verify when resolving, and whether this appears legitimate or worth disputing.`
  )

  return lines.join('\n')
}
