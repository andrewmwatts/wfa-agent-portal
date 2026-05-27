import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

// Numeric columns in the policies table
const NUMERIC_COLS = new Set([
  'submitted_apv', 'issued_apv', 'face_amount', 'snapshot_chargeback_apv',
])

// Boolean columns in the policies table
const BOOLEAN_COLS = new Set([
  'not_in_opt', 'split_reset', 'chargeback_exempt', 'first_time',
])

// Date columns — empty string → null
const DATE_COLS = new Set([
  'submit_date', 'submit_week', 'issue_date', 'last_update',
  'conservation_date', 'snapshot_chargeback_month',
])

const CB_MONTH_NAMES = {
  january:1, february:2, march:3, april:4, may:5, june:6,
  july:7, august:8, september:9, october:10, november:11, december:12,
}

function coerce(col, val) {
  if (BOOLEAN_COLS.has(col)) {
    const v = String(val ?? '').trim().toLowerCase()
    return ['true', '1', 'yes', 'x'].includes(v)
  }

  if (col === 'snapshot_chargeback_month') {
    if (!val || String(val).trim() === '') return null
    const s = String(val).trim()
    // Already ISO date
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
    // "Month YYYY" or "Month, YYYY"
    const lower = s.toLowerCase()
    for (const [name, num] of Object.entries(CB_MONTH_NAMES)) {
      if (lower.includes(name)) {
        const yearMatch = s.match(/(\d{4})/)
        if (yearMatch) return `${yearMatch[1]}-${String(num).padStart(2, '0')}-01`
      }
    }
    return null
  }

  if (DATE_COLS.has(col)) {
    return (val === '' || val == null) ? null : val
  }

  if (NUMERIC_COLS.has(col)) {
    if (val === '' || val == null) return null
    const n = parseFloat(String(val).replace(/[$,]/g, ''))
    return isNaN(n) ? null : n
  }

  // Text — empty string → null
  return (val === '' || val == null) ? null : String(val)
}

export default async function handler(req, res) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { id, updates } = req.body ?? {}

  if (!id || !updates || typeof updates !== 'object') {
    return res.status(400).json({ error: 'Missing or invalid id or updates' })
  }

  try {
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    // Coerce each value to the correct Postgres type
    const coerced = {}
    for (const [col, val] of Object.entries(updates)) {
      coerced[col] = coerce(col, val)
    }

    const { error } = await supabase
      .from('policies')
      .update(coerced)
      .eq('id', id)

    if (error) throw error

    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[update-policy]', err)
    return res.status(500).json({ error: 'Failed to update policy' })
  }
}
