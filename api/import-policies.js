import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { rows } = req.body ?? {}
  if (!Array.isArray(rows) || !rows.length) {
    return res.status(400).json({ error: 'No rows provided' })
  }

  try {
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    let inserted = 0
    let skipped  = 0
    const errors = []

    for (const row of rows) {
      // Server-side natural key duplicate check (authoritative, even if client already checked)
      if (!row.includeAnyway) {
        const { data: existing } = await supabase
          .from('policies')
          .select('id')
          .eq('sfg_id', row.sfg_id)
          .ilike('applicant', row.applicant)
          .eq('submit_date', row.submit_date)
          .ilike('carrier', row.carrier)
          .ilike('policy_name', row.policy_name)
          .maybeSingle()

        if (existing) { skipped++; continue }
      }

      const record = {
        sfg_id:          row.sfg_id,
        applicant:       row.applicant,
        carrier:         row.carrier,
        policy_name:     row.policy_name,
        policy_number:   row.policy_number   ?? null,
        face_amount:     row.face_amount     ?? null,
        submitted_apv:   row.submitted_apv   ?? null,
        status:          row.status          ?? null,
        submit_date:     row.submit_date     ?? null,
        issue_date:      row.issue_date      ?? null,
        last_update:     row.last_update     ?? null,
        submit_week:     row.submit_week     ?? null,
        submit_week_num: row.submit_week_num ?? null,
        subtype:         row.subtype         ?? null,
      }

      const { error } = await supabase.from('policies').insert(record)
      if (error) {
        errors.push({ applicant: row.applicant, agent: row.agentName, error: error.message })
      } else {
        inserted++
      }
    }

    return res.status(200).json({ inserted, skipped, errors })
  } catch (err) {
    console.error('[import-policies]', err)
    return res.status(500).json({ error: 'Failed to import policies' })
  }
}
