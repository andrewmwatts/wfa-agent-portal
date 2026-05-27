import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

/**
 * Lead Scripts API
 *
 * GET    /api/lead-scripts?sfg_id=X  → { scripts: [...] }
 * POST   /api/lead-scripts            → { script }
 * DELETE /api/lead-scripts?id=X       → 204
 */

const sb = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

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
  if (req.method === 'GET') {
    const sfgId = await resolveCallerSfgId(req, req.query.sfg_id)
    if (!sfgId) return res.status(401).json({ error: 'Unauthorized' })
    const { data, error } = await sb
      .from('lead_scripts')
      .select('*')
      .eq('sfg_id', sfgId)
      .order('category')
      .order('created_at')
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ scripts: data ?? [] })
  }

  if (req.method === 'POST') {
    const body = req.body ?? {}
    const sfgId = await resolveCallerSfgId(req, body.sfg_id)
    if (!sfgId) return res.status(401).json({ error: 'Unauthorized' })
    const { category, title, body: scriptBody, tag } = body
    if (!title?.trim() || !scriptBody?.trim()) {
      return res.status(400).json({ error: 'title and body are required' })
    }
    const { data, error } = await sb
      .from('lead_scripts')
      .insert({
        sfg_id:   sfgId,
        category: category?.trim() || 'General',
        title:    title.trim(),
        body:     scriptBody.trim(),
        tag:      tag?.trim() || null,
      })
      .select()
      .single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(201).json({ script: data })
  }

  if (req.method === 'DELETE') {
    const { id } = req.query
    if (!id) return res.status(400).json({ error: 'id required' })
    // Verify caller owns the script
    const bypass = process.env.VITE_BYPASS_AUTH === 'true'
    if (!bypass) {
      const sfgId = await resolveCallerSfgId(req, null)
      if (!sfgId) return res.status(401).json({ error: 'Unauthorized' })
      const { data: script } = await sb.from('lead_scripts').select('sfg_id').eq('id', id).single()
      if (!script || script.sfg_id !== sfgId) return res.status(403).json({ error: 'Forbidden' })
    }
    const { error } = await sb.from('lead_scripts').delete().eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(204).end()
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
