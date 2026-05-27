import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

/**
 * Update Personnel API
 *
 * PUT /api/update-personnel
 *   body: { sfg_id: string, updates: { [field]: value } }
 *
 * Allowed fields:
 *   hire_date, upline_sfg_id, profile_issues, no_eando,
 *   contracting_to_producer, contracting_complete, surelc_profile_date
 */

const ALLOWED_FIELDS = new Set([
  'hire_date',
  'upline_sfg_id',
  'profile_issues',
  'no_eando',
  'contracting_to_producer',
  'contracting_complete',
  'surelc_profile_date',
])

export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' })

  const { sfg_id, updates } = req.body ?? {}

  if (!sfg_id?.trim()) {
    return res.status(400).json({ error: 'sfg_id is required' })
  }
  if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'updates object is required' })
  }

  // Filter to only allowed fields
  const patch = {}
  for (const [key, val] of Object.entries(updates)) {
    if (!ALLOWED_FIELDS.has(key)) continue

    if (key === 'no_eando') {
      // Coerce to boolean — accept bool, 'TRUE'/'FALSE', 'true'/'false', '', null
      if (typeof val === 'boolean') {
        patch[key] = val
      } else {
        const s = String(val ?? '').toLowerCase()
        patch[key] = ['true', 'yes', 'y', '1', 'x'].includes(s)
      }
    } else if (['hire_date', 'contracting_to_producer', 'contracting_complete', 'surelc_profile_date'].includes(key)) {
      // Store null if empty, otherwise keep as-is (ISO date string from date input)
      patch[key] = val?.trim() || null
    } else {
      patch[key] = val?.trim() || null
    }
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' })
  }

  try {
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )

    const { data, error } = await supabase
      .from('personnel')
      .update(patch)
      .eq('sfg_id', sfg_id.trim().toUpperCase())
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ personnel: data })
  } catch (err) {
    console.error('[update-personnel]', err)
    return res.status(500).json({ error: 'Failed to update personnel data' })
  }
}
