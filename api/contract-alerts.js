import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

/**
 * Contract Alerts — daily cron endpoint
 *
 * Called by Vercel cron at 14:00 UTC (9am ET) every day:
 *   GET /api/contract-alerts
 *
 * Runs the overdue-contract-number query, sends a Resend email to
 * andrew@wattsfamilyagency.com if any alerts are found.  No email on clean days.
 *
 * Also accepts a manual trigger from the Admin Tools page:
 *   POST /api/contract-alerts  { preview: true }  → returns alerts JSON, no email
 *   POST /api/contract-alerts                      → sends email immediately, returns { sent, count }
 */

const sb = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

const ALERT_TO   = 'andrew@wattsfamilyagency.com'
const ALERT_FROM = 'portal@wattsfamilyagency.com'

async function runAlertQuery() {
  // 1. Fetch eligible agents (contracting sent, not complete, active enough)
  const { data: agents, error: agentsErr } = await sb
    .from('personnel')
    .select('sfg_id, preferred_name, contracting_to_producer, upline_sfg_id, upline_name, hire_date')
    .not('contracting_to_producer', 'is', null)
    .is('contracting_complete', null)

  if (agentsErr) throw agentsErr
  if (!agents?.length) return []

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Filter to agents with activity or hired within 180 days
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - 180)
  const eligibleIds = agents
    .filter(a => !a.hire_date || new Date(a.hire_date) >= cutoff)
    .map(a => a.sfg_id)

  // Also include agents with any policies (regardless of hire date)
  const { data: policyAgents } = await sb
    .from('policies')
    .select('sfg_id')
    .in('sfg_id', agents.map(a => a.sfg_id))
  const policySet = new Set((policyAgents ?? []).map(p => p.sfg_id))
  const activeIds = [...new Set([...eligibleIds, ...policySet])]

  if (!activeIds.length) return []

  const activeAgents = agents.filter(a => activeIds.includes(a.sfg_id))

  // 2. Fetch all core carriers
  const { data: carriers, error: carriersErr } = await sb
    .from('carriers')
    .select('name, alert_threshold_days')
    .order('name')
  if (carriersErr) throw carriersErr
  if (!carriers?.length) return []

  // 3. Fetch existing contract numbers for these agents
  const { data: contracts } = await sb
    .from('contract_numbers')
    .select('sfg_id, carrier')
    .in('sfg_id', activeIds)
  const contractSet = new Set((contracts ?? []).map(c => `${c.sfg_id}||${c.carrier}`))

  // 4. Build alert list
  const alerts = []
  for (const agent of activeAgents) {
    const sentDate  = new Date(agent.contracting_to_producer)
    const daysElapsed = Math.floor((today - sentDate) / 86400000)

    const overdueCarriers = carriers.filter(c =>
      daysElapsed > c.alert_threshold_days &&
      !contractSet.has(`${agent.sfg_id}||${c.name}`)
    )

    if (overdueCarriers.length > 0) {
      alerts.push({
        sfg_id:               agent.sfg_id,
        name:                 agent.preferred_name || agent.sfg_id,
        upline:               agent.upline_name || agent.upline_sfg_id || '—',
        contracting_sent:     agent.contracting_to_producer,
        days_elapsed:         daysElapsed,
        overdue_carriers:     overdueCarriers.map(c => ({
          carrier:      c.name,
          threshold:    c.alert_threshold_days,
          days_overdue: daysElapsed - c.alert_threshold_days,
        })),
      })
    }
  }

  return alerts.sort((a, b) => b.days_elapsed - a.days_elapsed)
}

function buildEmailBody(alerts) {
  const lines = [
    `The following agents have missing contract numbers past the expected window:`,
    '',
  ]

  for (const a of alerts) {
    lines.push(`${a.name} (${a.sfg_id}) — hired by ${a.upline}`)
    lines.push(`  Contracting sent: ${a.contracting_sent} (${a.days_elapsed} days ago)`)
    const carrierList = a.overdue_carriers
      .map(c => `${c.carrier} (${c.days_overdue} days overdue)`)
      .join(', ')
    lines.push(`  Missing carriers: ${carrierList}`)
    lines.push('')
  }

  return lines.join('\n')
}

export default async function handler(req, res) {
  // Cron GET — triggered by Vercel scheduler
  if (req.method === 'GET') {
    // Verify cron secret or Vercel's CRON_SECRET header to prevent public abuse
    const cronSecret = process.env.CRON_SECRET
    if (cronSecret) {
      const authHeader = req.headers.authorization
      if (authHeader !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' })
      }
    }

    try {
      const alerts = await runAlertQuery()
      if (!alerts.length) {
        return res.status(200).json({ sent: false, count: 0, message: 'No overdue contracts today' })
      }

      const resend = new Resend(process.env.RESEND_API_KEY)
      const subject = `[WFA] Contract Number Alerts — ${alerts.length} overdue`
      const text    = buildEmailBody(alerts)

      const { error: emailErr } = await resend.emails.send({
        from:    ALERT_FROM,
        to:      ALERT_TO,
        subject,
        text,
      })

      if (emailErr) {
        console.error('[contract-alerts] email error:', emailErr)
        return res.status(500).json({ error: 'Alert query succeeded but email failed', emailErr })
      }

      return res.status(200).json({ sent: true, count: alerts.length })
    } catch (err) {
      console.error('[contract-alerts]', err)
      return res.status(500).json({ error: err.message })
    }
  }

  // POST — manual trigger from Admin Tools (preview or force-send)
  if (req.method === 'POST') {
    try {
      const { preview } = req.body ?? {}
      const alerts = await runAlertQuery()

      if (preview) {
        return res.status(200).json({ alerts })
      }

      if (!alerts.length) {
        return res.status(200).json({ sent: false, count: 0 })
      }

      const resend  = new Resend(process.env.RESEND_API_KEY)
      const subject = `[WFA] Contract Number Alerts — ${alerts.length} overdue`
      const text    = buildEmailBody(alerts)

      const { error: emailErr } = await resend.emails.send({
        from:    ALERT_FROM,
        to:      ALERT_TO,
        subject,
        text,
      })

      if (emailErr) return res.status(500).json({ error: emailErr.message })
      return res.status(200).json({ sent: true, count: alerts.length })
    } catch (err) {
      console.error('[contract-alerts]', err)
      return res.status(500).json({ error: err.message })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
