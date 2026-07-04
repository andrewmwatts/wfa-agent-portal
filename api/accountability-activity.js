import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from './_auth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

/**
 * GET /api/accountability-activity?owner_sfg_id=X&sfg_ids=A,B,C&days=35
 *
 * Returns activity_tracking rows + agent_goals for a set of agents.
 * Authorization: caller must be the roster owner or an active delegate.
 * days defaults to 35 (covers 7-day rolling window + 5-week sparkline).
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const caller = await requireAuth(req, res)
  if (!caller) return

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  const { sfg_ids, owner_sfg_id, days = '35' } = req.query
  if (!sfg_ids?.trim()) return res.status(400).json({ error: 'sfg_ids required' })
  if (!owner_sfg_id?.trim()) return res.status(400).json({ error: 'owner_sfg_id required' })

  // Preserve original case from the roster — activity_tracking.sfg_id may not be uppercase
  const ids = sfg_ids.split(',').map(s => s.trim()).filter(Boolean)
  if (!ids.length) return res.status(400).json({ error: 'sfg_ids required' })

  const ownerKey = owner_sfg_id.trim().toUpperCase()
  const callerKey = caller.sfg_id?.toUpperCase() ?? ''

  // Authorize: caller must be the owner, a super_admin, or an active delegate
  if (caller.role !== 'super_admin' && callerKey !== ownerKey) {
    const { data: delegation } = await supabase
      .from('agent_assistants')
      .select('id')
      .eq('agent_sfg_id', ownerKey)
      .eq('assistant_sfg_id', callerKey)
      .eq('is_active', true)
      .maybeSingle()
    if (!delegation) {
      return res.status(403).json({ error: 'Forbidden: not the roster owner or a delegate' })
    }
  }

  const daysNum = Math.min(Math.max(parseInt(days) || 35, 1), 90)
  const start = new Date()
  start.setDate(start.getDate() - daysNum)
  const startYMD = start.toISOString().slice(0, 10)

  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayYMD = yesterday.toISOString().slice(0, 10)

  const [actRes, goalsRes] = await Promise.all([
    supabase
      .from('activity_tracking')
      .select('sfg_id, date, dials, contacts, appts_set, appts_run, apps_submitted, apv_submitted, lead_spend')
      .in('sfg_id', ids)
      .gte('date', startYMD)
      .lte('date', yesterdayYMD),
    supabase
      .from('agent_goals')
      .select('sfg_id, goal_type, goal_value, effective_date')
      .in('sfg_id', ids)
      .order('effective_date', { ascending: false }),
  ])

  if (actRes.error)   return res.status(500).json({ error: actRes.error.message })
  if (goalsRes.error) return res.status(500).json({ error: goalsRes.error.message })

  return res.status(200).json({
    activity: actRes.data  ?? [],
    goals:    goalsRes.data ?? [],
  })
}
