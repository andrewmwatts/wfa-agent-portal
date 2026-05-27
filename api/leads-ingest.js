import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

/**
 * Leads Ingest API
 *
 * POST /api/leads-ingest
 * Header: X-WFA-Secret: <WFA_INGEST_SECRET>
 *
 * Actions:
 *   lookup_agent   { action, email }            → { sfg_id }
 *   check_duplicate{ action, phone, sfg_id }    → { duplicate }
 *   insert_lead    { action, lead: {...} }       → { success }
 *   insert_error   { action, error: {...} }      → { success }
 *
 * Required table — run once in Supabase:
 *
 * CREATE TABLE public.parse_errors (
 *   id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 *   sender       text,
 *   subject      text,
 *   reason       text NOT NULL,
 *   body_snippet text,
 *   created_at   timestamptz NOT NULL DEFAULT now()
 * );
 * ALTER TABLE public.parse_errors ENABLE ROW LEVEL SECURITY;
 * CREATE POLICY "parse_errors_service" ON public.parse_errors
 *   FOR ALL TO service_role USING (true) WITH CHECK (true);
 * GRANT ALL ON public.parse_errors TO service_role;
 * GRANT USAGE, SELECT ON SEQUENCE parse_errors_id_seq TO service_role;
 */

const sb = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

export default async function handler(req, res) {
  // ── Method guard ──────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── Auth: shared secret ───────────────────────────────────────────────────
  const secret = process.env.WFA_INGEST_SECRET
  if (!secret || req.headers['x-wfa-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const body = req.body ?? {}
  const { action } = body

  // ── lookup_agent ──────────────────────────────────────────────────────────
  if (action === 'lookup_agent') {
    const { email } = body
    if (!email) return res.status(400).json({ error: 'email is required' })

    const { data, error } = await sb
      .from('users')
      .select('sfg_id')
      .or(`leads_email.ilike.${email},email.ilike.${email}`)
      .limit(1)
      .maybeSingle()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ sfg_id: data?.sfg_id ?? null })
  }

  // ── check_duplicate ───────────────────────────────────────────────────────
  if (action === 'check_duplicate') {
    const { phone, sfg_id } = body
    if (!phone || !sfg_id) {
      return res.status(400).json({ error: 'phone and sfg_id are required' })
    }

    const { data, error } = await sb
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .eq('sfg_id', sfg_id.toUpperCase())
      .limit(1)
      .maybeSingle()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ duplicate: !!data })
  }

  // ── insert_lead ───────────────────────────────────────────────────────────
  if (action === 'insert_lead') {
    const { lead } = body
    if (!lead || !lead.sfg_id || !lead.name) {
      return res.status(400).json({ error: 'lead.sfg_id and lead.name are required' })
    }

    const { error } = await sb.from('leads').insert({
      ...lead,
      sfg_id:     lead.sfg_id.toUpperCase(),
      name:       lead.name.trim(),
      added:      lead.added      || new Date().toISOString().slice(0, 10),
      created_at: lead.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    if (error) return res.status(500).json({ success: false, error: error.message })
    return res.status(201).json({ success: true })
  }

  // ── insert_error ──────────────────────────────────────────────────────────
  if (action === 'insert_error') {
    const { error: errPayload } = body
    if (!errPayload?.reason) {
      return res.status(400).json({ error: 'error.reason is required' })
    }

    const { error } = await sb.from('parse_errors').insert({
      sender:       errPayload.sender       || null,
      subject:      errPayload.subject      || null,
      reason:       errPayload.reason,
      body_snippet: errPayload.body_snippet || null,
    })

    if (error) return res.status(500).json({ success: false, error: error.message })
    return res.status(201).json({ success: true })
  }

  // ── Unknown action ────────────────────────────────────────────────────────
  return res.status(400).json({ error: `Unknown action: ${action}` })
}
