import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

/**
 * Activity Logs API
 *
 * GET  /api/activity?sfg_id=X&start=YYYY-MM-DD&end=YYYY-MM-DD
 * POST /api/activity  { sfg_id, log_date, dials, contacts, appts_set, appts_kept, apps_written, issued, notes }
 *
 * Required Supabase table:
 *
 * CREATE TABLE public.activity_logs (
 *   id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 *   sfg_id        text NOT NULL,
 *   log_date      date NOT NULL,
 *   dials         integer NOT NULL DEFAULT 0,
 *   contacts      integer NOT NULL DEFAULT 0,
 *   appts_set     integer NOT NULL DEFAULT 0,
 *   appts_kept    integer NOT NULL DEFAULT 0,
 *   apps_written  integer NOT NULL DEFAULT 0,
 *   resets        integer NOT NULL DEFAULT 0,
 *   notes         text,
 *   created_at    timestamptz NOT NULL DEFAULT now(),
 *   updated_at    timestamptz NOT NULL DEFAULT now(),
 *   UNIQUE(sfg_id, log_date)
 * );
 * ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
 * CREATE POLICY "Authenticated users can manage activity_logs"
 *   ON public.activity_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);
 * GRANT ALL ON public.activity_logs TO authenticated;
 * GRANT USAGE, SELECT ON SEQUENCE activity_logs_id_seq TO authenticated;
 */

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

export default async function handler(req, res) {
  // ── GET ─────────────────────────────────────────────────────────────────────
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

  // ── POST ─────────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const {
      sfg_id, log_date,
      dials, contacts, appts_set, appts_kept, apps_written, resets,
      hours_dialed,
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
          dials:        Math.max(0, parseInt(dials)        || 0),
          contacts:     Math.max(0, parseInt(contacts)     || 0),
          appts_set:    Math.max(0, parseInt(appts_set)    || 0),
          appts_kept:   Math.max(0, parseInt(appts_kept)   || 0),
          apps_written: Math.max(0, parseInt(apps_written) || 0),
          resets:       Math.max(0, parseInt(resets)       || 0),
          hours_dialed: Math.max(0, parseFloat(hours_dialed) || 0),
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
