import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

/**
 * Leads API
 *
 * GET   /api/leads?sfg_id=X              → { leads: [...] }
 * POST  /api/leads                        → { lead }     (create)
 * PATCH /api/leads?id=X                  → { lead }     (update any fields)
 *
 * Required Supabase tables — run once:
 *
 * CREATE TABLE public.leads (
 *   id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 *   sfg_id             text NOT NULL,
 *   name               text NOT NULL,
 *   phone              text,
 *   email              text,
 *   state              text,
 *   zip                text,
 *   gender             text,
 *   age                smallint,
 *   type               text NOT NULL DEFAULT 'Life Insurance - Standard',
 *   coverage           text,
 *   motivation         text,
 *   beneficiary        text,
 *   employment         text,
 *   income             text,
 *   smoker             boolean NOT NULL DEFAULT false,
 *   medical            boolean NOT NULL DEFAULT false,
 *   hobby              text,
 *   source             text,
 *   status             text NOT NULL DEFAULT 'new',
 *   callback_at        timestamptz,
 *   last_contact       date,
 *   last_activity_text text,
 *   last_activity_at   timestamptz,
 *   notes              text,
 *   added              date NOT NULL DEFAULT CURRENT_DATE,
 *   created_at         timestamptz NOT NULL DEFAULT now(),
 *   updated_at         timestamptz NOT NULL DEFAULT now()
 * );
 * ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
 * CREATE POLICY "leads_auth" ON public.leads FOR ALL TO authenticated USING (true) WITH CHECK (true);
 * GRANT ALL ON public.leads TO authenticated;
 * GRANT USAGE, SELECT ON SEQUENCE leads_id_seq TO authenticated;
 *
 * CREATE TABLE public.lead_activity (
 *   id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 *   lead_id    bigint NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
 *   sfg_id     text NOT NULL,
 *   type       text NOT NULL,
 *   body       text NOT NULL,
 *   note       text,
 *   created_at timestamptz NOT NULL DEFAULT now()
 * );
 * ALTER TABLE public.lead_activity ENABLE ROW LEVEL SECURITY;
 * CREATE POLICY "lead_activity_auth" ON public.lead_activity FOR ALL TO authenticated USING (true) WITH CHECK (true);
 * GRANT ALL ON public.lead_activity TO authenticated;
 * GRANT USAGE, SELECT ON SEQUENCE lead_activity_id_seq TO authenticated;
 *
 * CREATE TABLE public.lead_scripts (
 *   id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 *   sfg_id     text NOT NULL,
 *   category   text NOT NULL DEFAULT 'General',
 *   title      text NOT NULL,
 *   body       text NOT NULL,
 *   tag        text,
 *   created_at timestamptz NOT NULL DEFAULT now()
 * );
 * ALTER TABLE public.lead_scripts ENABLE ROW LEVEL SECURITY;
 * CREATE POLICY "lead_scripts_auth" ON public.lead_scripts FOR ALL TO authenticated USING (true) WITH CHECK (true);
 * GRANT ALL ON public.lead_scripts TO authenticated;
 * GRANT USAGE, SELECT ON SEQUENCE lead_scripts_id_seq TO authenticated;
 */

const sb = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

/**
 * Resolve the caller's SFG ID from their Bearer token.
 * In dev bypass mode, falls back to the client-supplied value.
 * Returns the SFG ID string, or null if auth fails.
 */
async function resolveCallerSfgId(req, fallback) {
  if (process.env.VITE_BYPASS_AUTH === 'true') {
    return fallback ? String(fallback).trim().toUpperCase() : null
  }
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data: { user }, error } = await sb.auth.getUser(token)
  if (error || !user) return null
  const { data } = await sb.from('users').select('sfg_id').eq('id', user.id).single()
  return data?.sfg_id?.toUpperCase() ?? null
}

export default async function handler(req, res) {
  // ── GET — list leads ───────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const sfgId = await resolveCallerSfgId(req, req.query.sfg_id)
    if (!sfgId) return res.status(401).json({ error: 'Unauthorized' })

    const { data, error } = await sb
      .from('leads')
      .select('*')
      .eq('sfg_id', sfgId)
      .order('added', { ascending: false })
      .order('id',    { ascending: false })

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ leads: data ?? [] })
  }

  // ── POST — create lead ─────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body ?? {}
    const sfgId = await resolveCallerSfgId(req, body.sfg_id)
    if (!sfgId) return res.status(401).json({ error: 'Unauthorized' })

    const { name, ...fields } = body
    if (!name?.trim()) {
      return res.status(400).json({ error: 'name is required' })
    }

    const { data, error } = await sb
      .from('leads')
      .insert({
        sfg_id: sfgId,
        name:   name.trim(),
        ...fields,
        added:      fields.added || new Date().toISOString().slice(0, 10),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(201).json({ lead: data })
  }

  // ── PATCH — update lead fields ─────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const { id } = req.query
    if (!id) return res.status(400).json({ error: 'id required' })

    // In prod, verify ownership by scoping the update to the caller's sfg_id
    const bypass = process.env.VITE_BYPASS_AUTH === 'true'
    if (!bypass) {
      const sfgId = await resolveCallerSfgId(req, null)
      if (!sfgId) return res.status(401).json({ error: 'Unauthorized' })

      const patch = { ...req.body }
      delete patch.id
      delete patch.sfg_id
      delete patch.created_at
      patch.updated_at = new Date().toISOString()

      const { data, error } = await sb
        .from('leads')
        .update(patch)
        .eq('id', id)
        .eq('sfg_id', sfgId)   // ← ownership guard
        .select()
        .single()

      if (error) return res.status(500).json({ error: error.message })
      if (!data)  return res.status(404).json({ error: 'Lead not found' })
      return res.status(200).json({ lead: data })
    }

    // Dev bypass — no ownership check
    const patch = { ...req.body }
    delete patch.id
    delete patch.sfg_id
    delete patch.created_at
    patch.updated_at = new Date().toISOString()

    const { data, error } = await sb
      .from('leads')
      .update(patch)
      .eq('id', id)
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ lead: data })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
