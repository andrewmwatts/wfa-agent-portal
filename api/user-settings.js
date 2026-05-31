import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

/**
 * User Settings API
 *
 *   PUT /api/user-settings   { id, field, value }
 *     → updates a whitelisted column on the users table for the given user id
 */

const ALLOWED_FIELDS = new Set(['leads_email', 'recruiting_email'])

export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' })

  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const sb = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  // Verify the caller matches the id they're updating
  const { data: { user }, error: authErr } = await sb.auth.getUser(token)
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })

  const { id, field, value } = req.body ?? {}

  if (!id)                          return res.status(400).json({ error: 'id is required' })
  if (!field || !ALLOWED_FIELDS.has(field)) return res.status(400).json({ error: 'Invalid field' })
  if (user.id !== id) {
    // Allow super_admins to update on behalf of others
    const { data: caller } = await sb.from('users').select('role').eq('id', user.id).single()
    if (caller?.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' })
  }

  const patch = { [field]: value?.trim() || null }

  const { data, error } = await sb.from('users').update(patch).eq('id', id).select(field).single()
  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ [field]: data?.[field] ?? null })
}
