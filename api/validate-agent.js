import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

// Load env files for local dev — Vercel injects vars automatically in production
const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let sfg_id, email
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
    sfg_id = body.sfg_id
    email  = body.email
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' })
  }

  if (!sfg_id || !email) {
    return res.status(400).json({ error: 'sfg_id and email are required' })
  }

  try {
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    // ── 1. Look up SFG ID in public.personnel ──────────────────────────────
    const { data: person, error: personError } = await supabase
      .from('personnel')
      .select('sfg_id, preferred_name, opt_name')
      .ilike('sfg_id', sfg_id.trim())
      .maybeSingle()

    if (personError) throw personError

    if (!person) {
      return res.status(200).json({ valid: false, reason: 'sfg_not_found' })
    }

    // ── 2. Check Supabase users for duplicate sfg_id ───────────────────────
    const { data: bySfg, error: sfgError } = await supabase
      .from('users')
      .select('id')
      .eq('sfg_id', sfg_id.trim())
      .maybeSingle()

    if (sfgError) throw sfgError

    if (bySfg) {
      return res.status(200).json({ valid: false, reason: 'sfg_already_registered' })
    }

    // ── 3. Check Supabase users for duplicate email ────────────────────────
    const { data: byEmail, error: emailError } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle()

    if (emailError) throw emailError

    if (byEmail) {
      return res.status(200).json({ valid: false, reason: 'email_already_registered' })
    }

    // ── 4. All checks passed ───────────────────────────────────────────────
    const displayName = person.preferred_name?.trim() || person.opt_name?.trim() || ''

    return res.status(200).json({
      valid:        true,
      full_name:    displayName,           // kept for backward compat with frontend
      preferred_name: person.preferred_name?.trim() ?? '',
      opt_name:     person.opt_name?.trim() ?? '',
    })

  } catch (err) {
    console.error('[validate-agent]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
