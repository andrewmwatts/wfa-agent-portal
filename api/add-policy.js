import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

function parseNum(val) {
  if (val === '' || val == null) return null
  const n = parseFloat(String(val).replace(/[$,]/g, ''))
  return isNaN(n) ? null : n
}

function parseDate(val) {
  if (!val || String(val).trim() === '') return null
  return String(val).trim()
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const f = req.body ?? {}

  if (!f.sfg_id || !f.applicant) {
    return res.status(400).json({ error: 'sfg_id and applicant are required' })
  }

  try {
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    const record = {
      sfg_id:                    f.sfg_id        ? String(f.sfg_id).trim()        : null,
      agent:                     f.agent         ? String(f.agent).trim()         : null,
      agent_email:               f.agent_email   ? String(f.agent_email).trim()   : null,
      applicant:                 f.applicant     ? String(f.applicant).trim()     : null,
      carrier:                   f.carrier       ? String(f.carrier).trim()       : null,
      policy_name:               f.policy_type   ? String(f.policy_type).trim()   : null,
      policy_number:             f.policy_no     ? String(f.policy_no).trim()     : null,
      face_amount:               parseNum(f.face_amt),
      submitted_apv:             parseNum(f.subm_apv),
      issued_apv:                parseNum(f.issued_apv),
      status:                    f.status        ? String(f.status).trim()        : null,
      submit_date:               parseDate(f.submit_date),
      submit_week:               parseDate(f.submit_week),
      submit_week_num:           f.submit_week_num ? String(f.submit_week_num).trim() : null,
      issue_date:                parseDate(f.issue_date),
      first_time:                ['x','true','1','yes'].includes(String(f.first_time ?? '').trim().toLowerCase()),
      application_notes:         f.app_notes     ? String(f.app_notes).trim()     : null,
      policy_notes:              f.policy_notes  ? String(f.policy_notes).trim()  : null,
      not_in_opt:                ['x','true','1','yes'].includes(String(f.not_in_opt ?? '').trim().toLowerCase()),
      split_reset:               ['x','true','1','yes'].includes(String(f.split_reset ?? '').trim().toLowerCase()),
      last_update:               parseDate(f.last_update),
    }

    const { error } = await supabase.from('policies').insert(record)
    if (error) throw error

    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[add-policy]', err)
    return res.status(500).json({ error: 'Failed to add policy' })
  }
}
