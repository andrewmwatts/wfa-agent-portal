import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

const SHEET_ID       = '1fbkq51BkFOY07RY2pASi-lHCYfjEPzPUD5BvkZZxhTU'
const ONBOARDING_TAB = 'Onboarding'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  let user_id
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
    user_id = body.user_id
  } catch {
    return res.status(400).json({ error: 'Invalid request body' })
  }
  if (!user_id) return res.status(400).json({ error: 'user_id required' })

  try {
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    // Verify caller is super_admin
    const { data: userRow } = await supabase
      .from('users')
      .select('role')
      .eq('id', user_id)
      .single()

    if (!userRow || userRow.role !== 'super_admin') {
      return res.status(403).json({ error: 'Forbidden' })
    }

    // Read Onboarding sheet
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    })
    const sheets = google.sheets({ version: 'v4', auth })

    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'${ONBOARDING_TAB}'`,
    })

    const rows = data.values
    if (!rows?.length) return res.status(200).json({ hidden: 0 })

    const headers    = rows[0].map(h => h?.trim() ?? '')
    const idxFilter = headers.findIndex(h => h.toLowerCase() === 'filter')
    const idxSfgId  = headers.findIndex(h => h.toLowerCase() === 'sfg id')

    if (idxFilter === -1) return res.status(500).json({ error: `"Filter" column not found in ${ONBOARDING_TAB} tab` })
    if (idxSfgId  === -1) return res.status(500).json({ error: `"SFG ID" column not found in ${ONBOARDING_TAB} tab` })

    const hiddenIds = []

    for (const row of rows.slice(1)) {
      const sfgId = row[idxSfgId]?.trim()
      if (!sfgId) continue

      const f1 = row[idxFilter]?.trim()?.toUpperCase()
      if (f1 === 'TRUE') hiddenIds.push(sfgId)
    }

    // Preserve any non-standard IDs already in the DB that the Sheet can't represent
    // (e.g. SFG-DUMMY-001 style). Standard IDs match /^SFG\d+$/i — anything else
    // is kept from the current DB value so a sync never silently wipes them.
    const STANDARD_ID = /^SFG\d+$/i

    const { data: existing } = await supabase
      .from('user_settings')
      .select('hidden_sfg_ids')
      .eq('user_id', user_id)
      .maybeSingle()

    const nonStandard = (existing?.hidden_sfg_ids ?? []).filter(id => !STANDARD_ID.test(id))
    const merged      = [...new Set([...hiddenIds, ...nonStandard])]

    const { error: upsertErr } = await supabase
      .from('user_settings')
      .upsert({
        user_id,
        hidden_sfg_ids: merged,
      }, { onConflict: 'user_id' })

    if (upsertErr) {
      console.error('[sync-hidden-agents] upsert error:', upsertErr)
      return res.status(500).json({ error: upsertErr.message })
    }

    return res.status(200).json({ hidden: merged.length })
  } catch (err) {
    console.error('[sync-hidden-agents]', err)
    return res.status(500).json({ error: 'Sync failed' })
  }
}
