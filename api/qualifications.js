import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

// Simple in-memory cache — qualifications change rarely so we avoid a Supabase
// round-trip on every page load after the first hit within a function instance.
let cache = null
let cacheTs = 0
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const now = Date.now()
    if (!cache || now - cacheTs > CACHE_TTL_MS) {
      const { data, error } = await supabase
        .from('qualifications')
        .select('level, regular, slingshot, writers')

      if (error) throw error

      const qualifications = {}
      for (const row of data ?? []) {
        if (!row.level) continue
        qualifications[String(row.level)] = {
          regular:   row.regular   ?? null,
          slingshot: row.slingshot ?? null,
          writers:   row.writers   ?? null,
        }
      }

      cache   = qualifications
      cacheTs = now
    }

    return res.status(200).json({ qualifications: cache })
  } catch (err) {
    console.error('[qualifications]', err)
    return res.status(500).json({ error: 'Failed to load qualifications' })
  }
}
