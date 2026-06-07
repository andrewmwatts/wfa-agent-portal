import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from './_auth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

/**
 * Activity API  (logs + goals + qualifications combined)
 *
 * Activity logs (default, no type param):
 *   GET  /api/activity?sfg_id=X&start=YYYY-MM-DD&end=YYYY-MM-DD
 *   POST /api/activity  { sfg_id, log_date, dials, ... }
 *
 * Activity goals (type=goals):
 *   GET  /api/activity?type=goals&sfg_id=X&month=YYYY-MM
 *   POST /api/activity?type=goals  { sfg_id, year_month, weekly_dials, weekly_appts,
 *                                    monthly_apv_submitted, monthly_apv_issued }
 *
 * Qualifications (type=qualifications):
 *   GET  /api/activity?type=qualifications  → { qualifications }
 */

// ── Qualifications cache (1 hour) ─────────────────────────────────────────────
let qualCache = null
let qualCacheTs = 0
const QUAL_TTL = 60 * 60 * 1000

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

function parseOptionalInt(val) {
  if (val === null || val === undefined || val === '') return null
  const n = parseInt(val)
  return isNaN(n) ? null : Math.max(0, n)
}

function parseOptionalNum(val) {
  if (val === null || val === undefined || val === '') return null
  const n = parseFloat(val)
  return isNaN(n) ? null : Math.max(0, n)
}

export default async function handler(req, res) {
  const caller = await requireAuth(req, res)
  if (!caller) return

  const { type } = req.query

  // ── Qualifications branch ─────────────────────────────────────────────────────
  if (type === 'qualifications') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
    try {
      const now = Date.now()
      if (!qualCache || now - qualCacheTs > QUAL_TTL) {
        const { data, error } = await supabase
          .from('qualifications')
          .select('level, regular, slingshot, writers')
        if (error) throw error
        const qualifications = {}
        for (const row of data ?? []) {
          if (!row.level) continue
          qualifications[String(row.level)] = {
            regular:   row.regular   ?? null,
            slingshot: row.slingshot ?? null,
            writers:   row.writers   ?? null,
          }
        }
        qualCache   = qualifications
        qualCacheTs = now
      }
      return res.status(200).json({ qualifications: qualCache })
    } catch (err) {
      console.error('[qualifications]', err)
      return res.status(500).json({ error: 'Failed to load qualifications' })
    }
  }

  const isGoals = type === 'goals'

  // ── Goals branch ─────────────────────────────────────────────────────────────
  if (isGoals) {
    if (req.method === 'GET') {
      const { sfg_id, month } = req.query
      if (!sfg_id || !month) return res.status(400).json({ error: 'sfg_id and month required' })

      const { data, error } = await supabase
        .from('activity_goals')
        .select('*')
        .eq('sfg_id', sfg_id.trim().toUpperCase())
        .eq('year_month', month.trim())
        .maybeSingle()

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ goals: data ?? {} })
    }

    if (req.method === 'POST') {
      const { sfg_id, year_month, weekly_dials, weekly_appts, monthly_apv_submitted, monthly_apv_issued } = req.body ?? {}

      if (!sfg_id || !year_month) return res.status(400).json({ error: 'sfg_id and year_month required' })

      const { data, error } = await supabase
        .from('activity_goals')
        .upsert(
          {
            sfg_id:                sfg_id.trim().toUpperCase(),
            year_month:            year_month.trim(),
            weekly_dials:          parseOptionalInt(weekly_dials),
            weekly_appts:          parseOptionalInt(weekly_appts),
            monthly_apv_submitted: parseOptionalNum(monthly_apv_submitted),
            monthly_apv_issued:    parseOptionalNum(monthly_apv_issued),
            updated_at:            new Date().toISOString(),
          },
          { onConflict: 'sfg_id,year_month' },
        )
        .select()
        .single()

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ goals: data })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── Activity logs branch ──────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { sfg_id, start, end } = req.query
    if (!sfg_id) return res.status(400).json({ error: 'sfg_id required' })

    let query = supabase
      .from('activity_logs')
      .select('*')
      .eq('sfg_id', sfg_id.trim().toUpperCase())

    if (start) query = query.gte('log_date', start)
    if (end)   query = query.lte('log_date', end)

    const { data, error } = await query.order('log_date', { ascending: true })
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ logs: data ?? [] })
  }

  if (req.method === 'POST') {
    const {
      sfg_id, log_date,
      dials, hours_dialed, reachouts, posts,
      contacts, appts_set, appts_kept, apps_written, resets,
      notes,
    } = req.body ?? {}

    if (!sfg_id || !log_date) {
      return res.status(400).json({ error: 'sfg_id and log_date are required' })
    }

    const { data, error } = await supabase
      .from('activity_logs')
      .upsert(
        {
          sfg_id:       sfg_id.trim().toUpperCase(),
          log_date,
          dials:        Math.max(0, parseInt(dials)           || 0),
          hours_dialed: Math.max(0, parseFloat(hours_dialed) || 0),
          reachouts:    Math.max(0, parseInt(reachouts)      || 0),
          posts:        Math.max(0, parseInt(posts)          || 0),
          contacts:     Math.max(0, parseInt(contacts)       || 0),
          appts_set:    Math.max(0, parseInt(appts_set)      || 0),
          appts_kept:   Math.max(0, parseInt(appts_kept)     || 0),
          apps_written: Math.max(0, parseInt(apps_written)   || 0),
          resets:       Math.max(0, parseInt(resets)         || 0),
          notes:        notes?.trim() || null,
          updated_at:   new Date().toISOString(),
        },
        { onConflict: 'sfg_id,log_date' },
      )
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ log: data })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
