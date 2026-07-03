import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, getAllowedSfgIds, scopeAllowed } from './_auth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

/**
 * GET /api/accountability-activity?sfg_ids=A,B,C&days=35
 *
 * Returns activity_tracking rows + agent_goals for a set of agents.
 * Caller must have scope access to all requested sfg_ids.
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

  const { sfg_ids, days = '35' } = req.query
  if (!sfg_ids?.trim()) return res.status(400).json({ error: 'sfg_ids required' })

  const ids = sfg_ids.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
  if (!ids.length) return res.status(400).json({ error: 'sfg_ids required' })

  // Verify caller has scope access to all requested agents
  const allowed = await getAllowedSfgIds(caller, supabase)
  if (!scopeAllowed(allowed, ids)) {
    return res.status(403).json({ error: 'Forbidden: one or more agents outside your scope' })
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
