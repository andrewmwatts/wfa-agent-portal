import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from './_auth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

/**
 * GET /api/accountability-policies?owner_sfg_id=X&sfg_id=Y
 *
 * Returns policies for a single agent:
 *   - status is Pending, Incomplete, or null (needs attention)
 *   - OR submit_date within the last 28 days
 * Authorization: caller must be the roster owner, super_admin, or active delegate.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const caller = await requireAuth(req, res)
  if (!caller) return

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  const { sfg_id, owner_sfg_id } = req.query
  if (!sfg_id?.trim())       return res.status(400).json({ error: 'sfg_id required' })
  if (!owner_sfg_id?.trim()) return res.status(400).json({ error: 'owner_sfg_id required' })

  const ownerKey  = owner_sfg_id.trim()
  const callerKey = caller.sfg_id ?? ''

  if (caller.role !== 'super_admin' && callerKey !== ownerKey) {
    const { data: delegation } = await supabase
      .from('agent_assistants')
      .select('id')
      .eq('agent_sfg_id', ownerKey)
      .eq('assistant_sfg_id', callerKey)
      .eq('is_active', true)
      .maybeSingle()
    if (!delegation) {
      return res.status(403).json({ error: 'Forbidden' })
    }
  }

  const since28 = new Date()
  since28.setDate(since28.getDate() - 28)
  const since28YMD = since28.toISOString().slice(0, 10)

  // Fetch all policies for this agent that are either open or recently submitted
  const { data, error } = await supabase
    .from('policies')
    .select(`
      id, status, status_actual, submit_date, issue_date,
      applicant, carrier, policy_name, policy_number,
      face_amount, submitted_apv, issued_apv,
      application_notes, policy_notes, last_update
    `)
    .eq('sfg_id', sfg_id.trim())
    .or(`status.in.(Pending,Incomplete),status.is.null,submit_date.gte.${since28YMD}`)
    .order('submit_date', { ascending: false, nullsFirst: false })

  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ policies: data ?? [] })
}
