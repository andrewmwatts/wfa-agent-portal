import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

const sb = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

export default async function handler(req, res) {
  // ── POST — save subscription ──────────────────────────────────────────────
  if (req.method === 'POST') {
    const { subscription, sfg_id, user_id } = req.body ?? {}

    if (!subscription || !sfg_id || !user_id) {
      return res.status(400).json({ error: 'subscription, sfg_id, and user_id are required' })
    }

    const { error } = await sb
      .from('push_subscriptions')
      .upsert(
        { user_id, sfg_id: sfg_id.toUpperCase(), subscription },
        { onConflict: 'user_id,sfg_id', ignoreDuplicates: false }
      )

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  // ── DELETE — remove subscription ──────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { user_id, sfg_id } = req.body ?? {}

    if (!user_id || !sfg_id) {
      return res.status(400).json({ error: 'user_id and sfg_id are required' })
    }

    const { error } = await sb
      .from('push_subscriptions')
      .delete()
      .eq('user_id', user_id)
      .eq('sfg_id', sfg_id.toUpperCase())

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
