import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    const { data, error } = await supabase
      .from('policy_crosswalk')
      .select('carrier, policy_name, subtype')
      .order('carrier')
      .order('policy_name')

    if (error) throw error
    return res.status(200).json(data ?? [])
  } catch (err) {
    console.error('[policy-crosswalk]', err)
    return res.status(500).json({ error: 'Failed to load crosswalk' })
  }
}
