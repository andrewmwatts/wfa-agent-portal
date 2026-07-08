import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'x-agent-secret')

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const secret = process.env.AGENT_QUERY_SECRET
  if (!secret || req.headers['x-agent-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { table, opt_name } = req.query

  if (table !== 'personnel') {
    return res.status(400).json({ error: 'Unsupported table' })
  }

  if (!opt_name?.trim()) {
    return res.status(400).json({ error: 'opt_name is required' })
  }

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  const { data, error } = await supabase
    .from('personnel')
    .select('preferred_name')
    .ilike('opt_name', opt_name.trim())

  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ results: data ?? [] })
}
