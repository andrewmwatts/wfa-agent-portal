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
 * Calls Claude to generate a hypothesis for the discrepancy, stores it, returns it.
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
    // Load the reconciliation row
    const { data: rec, error: recErr } = await supabase
      .from('snapshot_reconciliations')
      .select('*')
      .eq('id', reconciliation_id)
      .single()
    if (recErr || !rec) return res.status(404).json({ error: 'Reconciliation not found' })

    // Load agent name
    const { data: person } = await supabase
      .from('personnel')
      .select('opt_name')
      .eq('sfg_id', rec.sfg_id)
      .maybeSingle()
    const agentName = person?.opt_name ?? rec.sfg_id

    const issuedPolicies      = safeJson(rec.issued_policies)      ?? []
    const nonIssuedPolicies   = safeJson(rec.non_issued_policies)  ?? []
    const cbCandidates        = safeJson(rec.chargeback_candidates) ?? []
    const priorInWindow       = safeJson(rec.prior_in_window)      ?? []
    const mechanicalFlags     = rec.mechanical_flags               ?? []

    const prompt = buildPrompt({
      agentName,
      carrier:        rec.carrier,
      snapshotApv:    rec.snapshot_apv,
      dbApv:          rec.db_apv,
      delta:          rec.delta,
      mechanicalFlags,
      issuedPolicies,
      nonIssuedPolicies,
      cbCandidates,
      priorInWindow,
    })

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const message = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 1000,
      messages:   [{ role: 'user', content: prompt }],
    })

    const hypothesis = message.content?.[0]?.text ?? ''

    // Store in DB
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
  return typeof n === 'number' ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
}

function buildPrompt({ agentName, carrier, snapshotApv, dbApv, delta, mechanicalFlags,
                       issuedPolicies, nonIssuedPolicies, cbCandidates, priorInWindow }) {
  const lines = [
    `You are reviewing a monthly Snapshot reconciliation for a life insurance agency.`,
    ``,
    `Agent: ${agentName}`,
    `Carrier: ${carrier}`,
    `Snapshot APV (HQ report): ${fmtApv(snapshotApv)}`,
    `Tracker APV (internal DB): ${fmtApv(dbApv)}`,
    `Delta: ${fmtApv(delta)} (${delta > 0 ? 'Snapshot higher' : 'Tracker higher'})`,
    ``,
  ]

  if (mechanicalFlags.length) {
    lines.push(`Mechanical flags: ${mechanicalFlags.join(', ')}`, '')
  }

  if (issuedPolicies.length) {
    lines.push(`Issued policies in window (${issuedPolicies.length}):`)
    for (const p of issuedPolicies) {
      lines.push(`  - ${p.applicant} | Policy# ${p.policy_no || p.policy_number} | Issue: ${p.issue_date} | APV: ${fmtApv(p.issued_apv)}${p.conservation_status ? ` | Conservation: ${p.conservation_status}` : ''}${p.split_reset ? ' | SPLIT/RESET' : ''}`)
    }
    lines.push('')
  }

  if (cbCandidates.length) {
    lines.push(`Chargeback candidates (${cbCandidates.length}):`)
    for (const p of cbCandidates) {
      lines.push(`  - ${p.applicant} | Policy# ${p.policy_no || p.policy_number} | APV: ${fmtApv(p.issued_apv)} | Status: ${p.conservation_status}`)
    }
    lines.push('')
  }

  if (priorInWindow.length) {
    lines.push(`Prior-month policies that may appear in this snapshot window (${priorInWindow.length}):`)
    for (const p of priorInWindow) {
      lines.push(`  - ${p.applicant} | Issue: ${p.issue_date} | APV: ${fmtApv(p.issued_apv)}`)
    }
    lines.push('')
  }

  if (nonIssuedPolicies.length) {
    lines.push(`Non-issued policies (pending/incomplete) for this agent+carrier: ${nonIssuedPolicies.length}`, '')
  }

  lines.push(
    `Based on this information, provide a concise hypothesis (2–4 sentences) explaining the most likely reason for the discrepancy between the Snapshot and our tracker. Focus on actionable insights: what might account for the delta, what to look for when resolving, and whether this appears legitimate or worth disputing.`
  )

  return lines.join('\n')
}
