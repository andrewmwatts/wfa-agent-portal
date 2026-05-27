import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

export default async function handler(req, res) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  let user_id, action, sfg_id
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
    user_id = body.user_id
    action  = body.action
    sfg_id  = body.sfg_id
  } catch {
    return res.status(400).json({ error: 'Invalid request body' })
  }

  if (!user_id || !sfg_id || !['hide', 'unhide'].includes(action)) {
    return res.status(400).json({ error: 'user_id, action (hide|unhide), and sfg_id are required' })
  }

  try {
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    const { data: current } = await supabase
      .from('user_settings')
      .select('hidden_sfg_ids')
      .eq('user_id', user_id)
      .maybeSingle()

    const list = current?.hidden_sfg_ids ?? []

    const updated = action === 'hide'
      ? (list.includes(sfg_id) ? list : [...list, sfg_id])
      : list.filter(id => id !== sfg_id)

    const { error } = await supabase
      .from('user_settings')
      .upsert({ user_id, hidden_sfg_ids: updated }, { onConflict: 'user_id' })

    if (error) throw error

    return res.status(200).json({ success: true, hidden_sfg_ids: updated })
  } catch (err) {
    console.error('[user-settings]', err)
    return res.status(500).json({ error: 'Failed to update settings' })
  }
}
