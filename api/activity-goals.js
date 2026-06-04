import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

/**
 * Activity Goals API
 *
 * GET  /api/activity-goals?sfg_id=X&month=YYYY-MM
 * POST /api/activity-goals  { sfg_id, year_month, weekly_dials, weekly_appts,
 *                             monthly_apv_submitted, monthly_apv_issued }
 *
 * Required Supabase table:
 *
 * CREATE TABLE public.activity_goals (
 *   sfg_id                  text    NOT NULL,
 *   year_month              text    NOT NULL,
 *   weekly_dials            integer,
 *   weekly_appts            integer,
 *   monthly_apv_submitted   numeric,
 *   monthly_apv_issued      numeric,
 *   updated_at              timestamptz NOT NULL DEFAULT now(),
 *   PRIMARY KEY (sfg_id, year_month)
 * );
 * ALTER TABLE public.activity_goals ENABLE ROW LEVEL SECURITY;
 * CREATE POLICY "Authenticated users can manage activity_goals"
 *   ON public.activity_goals FOR ALL TO authenticated USING (true) WITH CHECK (true);
 * GRANT ALL ON public.activity_goals TO authenticated;
 */

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
  // ── GET ─────────────────────────────────────────────────────────────────────
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

  // ── POST ─────────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { sfg_id, year_month, weekly_dials, weekly_appts, monthly_apv_submitted, monthly_apv_issued } = req.body ?? {}

    if (!sfg_id || !year_month) return res.status(400).json({ error: 'sfg_id and year_month required' })

    const { data, error } = await supabase
      .from('activity_goals')
      .upsert(
        {
          sfg_id:                 sfg_id.trim().toUpperCase(),
          year_month:             year_month.trim(),
          weekly_dials:           parseOptionalInt(weekly_dials),
          weekly_appts:           parseOptionalInt(weekly_appts),
          monthly_apv_submitted:  parseOptionalNum(monthly_apv_submitted),
          monthly_apv_issued:     parseOptionalNum(monthly_apv_issued),
          updated_at:             new Date().toISOString(),
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
