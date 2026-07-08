import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, authorizeScope } from './_auth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

const TEXT_FIELDS = [
  'vision_said_yes',
  'vision_no_longer_settle',
  'vision_90_days_different',
  'vision_doing_for_whom',
  'vision_one_year_looks_like',
  'path_milestone_90_days',
  'path_org_one_year',
  'path_skill_change',
  'commitment_non_negotiables',
  'commitment_give_up',
  'commitment_keep_going',
  'support_accountability_partner',
  'support_coaching_style',
]

export default async function handler(req, res) {
  const caller = await requireAuth(req, res)
  if (!caller) return

  if (req.method === 'GET') {
    const { sfg_id } = req.query
    if (!sfg_id) return res.status(400).json({ error: 'sfg_id required' })
    if (!(await authorizeScope(req, res, caller, supabase, [sfg_id.trim().toUpperCase()]))) return

    const { data, error } = await supabase
      .from('ninety_day_plans')
      .select('*')
      .eq('sfg_id', sfg_id.trim().toUpperCase())
      .order('start_date', { ascending: false })

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ plans: data ?? [] })
  }

  if (req.method === 'POST') {
    const { sfg_id, start_date, end_date } = req.body ?? {}
    if (!sfg_id || !start_date || !end_date) {
      return res.status(400).json({ error: 'sfg_id, start_date, and end_date required' })
    }
    if (!(await authorizeScope(req, res, caller, supabase, [sfg_id.trim().toUpperCase()]))) return

    const { data, error } = await supabase
      .from('ninety_day_plans')
      .insert({ sfg_id: sfg_id.trim().toUpperCase(), start_date, end_date })
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ plan: data })
  }

  if (req.method === 'PATCH') {
    const { id, sfg_id, sign, ...rest } = req.body ?? {}
    if (!id || !sfg_id) return res.status(400).json({ error: 'id and sfg_id required' })
    if (!(await authorizeScope(req, res, caller, supabase, [sfg_id.trim().toUpperCase()]))) return

    const update = { updated_at: new Date().toISOString() }
    for (const f of TEXT_FIELDS) {
      if (f in rest) update[f] = rest[f]?.trim() || null
    }
    if (sign) update.signed_at = new Date().toISOString()

    const { data, error } = await supabase
      .from('ninety_day_plans')
      .update(update)
      .eq('id', id)
      .eq('sfg_id', sfg_id.trim().toUpperCase())
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ plan: data })
  }

  if (req.method === 'DELETE') {
    const { id, sfg_id } = req.body ?? {}
    if (!id || !sfg_id) return res.status(400).json({ error: 'id and sfg_id required' })
    if (!(await authorizeScope(req, res, caller, supabase, [sfg_id.trim().toUpperCase()]))) return

    const { error } = await supabase
      .from('ninety_day_plans')
      .delete()
      .eq('id', id)
      .eq('sfg_id', sfg_id.trim().toUpperCase())

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
