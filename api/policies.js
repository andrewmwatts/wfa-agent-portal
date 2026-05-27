import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

const POLICY_COLS = [
  'id', 'sfg_id', 'applicant', 'carrier', 'policy_name', 'policy_number',
  'face_amount', 'submitted_apv', 'issued_apv', 'status',
  'submit_date', 'submit_week', 'submit_week_num', 'issue_date', 'last_update',
  'application_notes', 'policy_notes', 'not_in_opt', 'split_reset',
  'conservation_status', 'conservation_date',
  'snapshot_chargeback_month', 'snapshot_chargeback_apv',
].join(', ')

// Fetch rows for a set of sfg_ids, paginating past the 1000-row PostgREST limit.
// Filters server-side so we never transfer rows we don't need.
async function fetchPolicies(supabase, sfgIds) {
  const PAGE = 1000
  const results = []
  let from = 0
  while (true) {
    let q = supabase.from('policies').select(POLICY_COLS)
    if (sfgIds?.length) q = q.in('sfg_id', sfgIds.map(id => id.toUpperCase()))
    const { data, error } = await q.range(from, from + PAGE - 1)
    if (error) throw error
    results.push(...(data ?? []))
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return results
}

// Format a stored "YYYY-MM-01" chargeback month back to "Month YYYY" for display
function formatCbMonth(dateStr) {
  if (!dateStr) return ''
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-\d{2}/)
  if (!m) return String(dateStr)
  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December']
  const monthIdx = parseInt(m[2]) - 1
  if (monthIdx < 0 || monthIdx > 11) return String(dateStr)
  return `${MONTHS[monthIdx]} ${parseInt(m[1])}`
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const raw = req.query.sfg_ids ?? req.query.sfg_id ?? ''
  const requestedIds = raw
    ? raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    : []

  try {
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    const [rows, people] = await Promise.all([
      fetchPolicies(supabase, requestedIds.length ? requestedIds : null),
      supabase.from('personnel').select('sfg_id, preferred_name, opt_name').then(r => { if (r.error) throw r.error; return r.data ?? [] }),
    ])

    // Build sfg_id → { name, email } from live personnel data
    const personLookup = {}
    for (const p of people) {
      const id = p.sfg_id?.toLowerCase()
      if (id) personLookup[id] = {
        name: p.preferred_name?.trim() || p.opt_name?.trim() || '',
      }
    }

    const policies = rows.map(p => {
        const person = personLookup[(p.sfg_id ?? '').trim().toLowerCase()] ?? {}
        return {
        id:                  p.id,
        sfg_id:              p.sfg_id                         ?? '',
        agent:               person.name || '',
        agent_email:         '',
        applicant:           p.applicant                      ?? '',
        carrier:             p.carrier                        ?? '',
        policy_type:         p.policy_name                    ?? '',
        policy_no:           p.policy_number                  ?? '',
        face_amt:            p.face_amount != null ? String(p.face_amount) : '',
        subm_apv:            p.submitted_apv  ?? null,
        issued_apv:          p.issued_apv     ?? null,
        status:              p.status                         ?? '',
        submit_date:         p.submit_date                    ?? '',
        submit_week:         p.submit_week                    ?? '',
        submit_week_num:     p.submit_week_num                ?? '',
        issue_date:          p.issue_date                     ?? '',
        app_notes:           p.application_notes              ?? '',
        policy_notes:        p.policy_notes                   ?? '',
        not_in_opt:          p.not_in_opt   ? 'x' : '',
        split_reset:         p.split_reset  ? 'x' : '',
        cb_month:            formatCbMonth(p.snapshot_chargeback_month),
        cb_apv:              p.snapshot_chargeback_apv != null ? String(p.snapshot_chargeback_apv) : '',
        conservation_status: p.conservation_status            ?? '',
        conservation_date:   p.conservation_date              ?? '',
        last_update:         p.last_update                    ?? '',
      }
      })

    return res.status(200).json({ policies })
  } catch (err) {
    console.error('[policies]', err)
    return res.status(500).json({ error: 'Failed to read policies data' })
  }
}
