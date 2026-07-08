import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from './_auth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

export default async function handler(req, res) {
  const caller = await requireAuth(req, res)
  if (!caller) return

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  // ── GET ────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { sfg_id } = req.query
    if (!sfg_id?.trim()) return res.status(400).json({ error: 'sfg_id required' })

    const { data, error } = await supabase
      .from('project_100')
      .select('*')
      .eq('sfg_id', sfg_id.trim())
      .order('created_at', { ascending: true })

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ entries: data ?? [] })
  }

  // ── POST ───────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { sfg_id, name, phone, email, social_handle, life_fit, relationship, status, referral_given } = req.body ?? {}
    if (!sfg_id?.trim()) return res.status(400).json({ error: 'sfg_id required' })
    if (!name?.trim())   return res.status(400).json({ error: 'name required' })

    const { data, error } = await supabase
      .from('project_100')
      .insert({
        sfg_id:           sfg_id.trim(),
        name:             name.trim(),
        phone:            phone?.trim()         || null,
        email:            email?.trim()         || null,
        social_handle:    social_handle?.trim() || null,
        life_fit:         life_fit              || 'high',
        relationship:     relationship          || 'high',
        status:           status               || 'new',
        referral_given:   !!referral_given,
        status_updated_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(201).json({ entry: data })
  }

  // ── PATCH ──────────────────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const { id } = req.query
    if (!id) return res.status(400).json({ error: 'id required' })

    const allowed = ['name', 'phone', 'email', 'social_handle', 'life_fit', 'relationship', 'status', 'referral_given']
    const updates = {}
    for (const k of allowed) {
      if (k in (req.body ?? {})) updates[k] = req.body[k]
    }
    if ('status' in updates) updates.status_updated_at = new Date().toISOString()

    const { data, error } = await supabase
      .from('project_100')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ entry: data })
  }

  // ── DELETE ─────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { id } = req.query
    if (!id) return res.status(400).json({ error: 'id required' })

    const { error } = await supabase.from('project_100').delete().eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
