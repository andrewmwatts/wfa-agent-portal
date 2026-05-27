import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local'), silent: true })
loadEnv({ path: resolve(__dirname, '../.env.local'), silent: true })

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  let rows, statusUpdates
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
    rows          = body.rows          // array of new agent rows to insert
    statusUpdates = body.statusUpdates // optional array of { sfg_id, status }
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' })
  }

  if (!Array.isArray(rows)) {
    return res.status(400).json({ error: 'rows must be an array' })
  }

  try {
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    let inserted = 0
    let skipped  = 0
    const errors = []

    // ── 1. Insert new agents ─────────────────────────────────────────────────
    if (rows.length > 0) {
      const { data, error } = await supabase
        .from('personnel')
        .upsert(rows, { onConflict: 'sfg_id', ignoreDuplicates: true })
        .select('sfg_id')

      if (error) throw error

      inserted = data?.length ?? 0
      skipped  = rows.length - inserted
    }

    // ── 2. Optional status updates for existing agents ───────────────────────
    let statusUpdated = 0
    if (Array.isArray(statusUpdates) && statusUpdates.length > 0) {
      for (const { sfg_id, status } of statusUpdates) {
        const { error } = await supabase
          .from('personnel')
          .update({ status })
          .eq('sfg_id', sfg_id)

        if (error) {
          errors.push({ sfg_id, error: error.message })
        } else {
          statusUpdated++
        }
      }
    }

    return res.status(200).json({ inserted, skipped, statusUpdated, errors })
  } catch (err) {
    console.error('[import-agents]', err)
    return res.status(500).json({ error: 'Failed to import agents' })
  }
}
