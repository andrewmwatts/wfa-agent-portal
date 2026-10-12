import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

/**
 * Agent query API — read-only personnel lookups for the Claude agent.
 * Auth: x-agent-secret header. Responses are plain JSON ({ results: [...] }),
 * never echoing the request URL or query string.
 *
 *   GET ?table=personnel&opt_name=<Opt! name>          → [{ preferred_name }]  (legacy default)
 *   GET ?table=personnel&sfg_id=<id>[,<id>...]         → rows by SFG ID (up to 100)
 *   GET ?table=personnel&all=1[&status=Active]         → the whole roster (optionally one status)
 *
 * `fields` (aliases: select, columns) picks the returned keys: a comma list or `*`.
 * Allowed: sfg_id, opt_name, preferred_name, upline_sfg_id, status. Contact and
 * identity columns (email, phone, birth date, NPN, address) are deliberately not
 * exposed here.
 *
 * Defaults: opt_name lookups return only preferred_name (unchanged, so existing
 * callers keep working); sfg_id and all lookups return every allowed field.
 */

const ALLOWED_ORIGIN  = 'https://agents.wattsfamilyagency.com'
const ALLOWED_FIELDS  = ['sfg_id', 'opt_name', 'preferred_name', 'upline_sfg_id', 'status']
const MAX_SFG_IDS     = 100
const PAGE            = 1000

// Vercel hands repeated query keys over as arrays; take the first value.
const first = v => (Array.isArray(v) ? v[0] : v)

function parseFields(raw, fallback) {
  const s = first(raw)
  if (s == null || String(s).trim() === '') return { fields: fallback }
  if (String(s).trim() === '*') return { fields: ALLOWED_FIELDS }
  const asked = String(s).split(',').map(f => f.trim()).filter(Boolean)
  const bad   = asked.filter(f => !ALLOWED_FIELDS.includes(f))
  if (bad.length) return { error: `Unsupported field(s): ${bad.join(', ')}. Allowed: ${ALLOWED_FIELDS.join(', ')}` }
  return { fields: [...new Set(asked)] }
}

export default async function handler(req, res) {
  // Locked to the portal's own origin: the roster is only ever fetched from a tab
  // on it, so no other origin needs to read these responses.
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
  res.setHeader('Access-Control-Allow-Headers', 'x-agent-secret')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Vary', 'Origin')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const secret = process.env.AGENT_QUERY_SECRET
  if (!secret || req.headers['x-agent-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const table   = first(req.query.table)
  const optName = first(req.query.opt_name)
  const sfgRaw  = first(req.query.sfg_id)
  const wantAll = ['1', 'true'].includes(String(first(req.query.all) ?? '').toLowerCase())
  const status  = first(req.query.status)

  if (table !== 'personnel') {
    return res.status(400).json({ error: 'Unsupported table' })
  }

  const hasOpt = !!optName?.trim()
  const hasSfg = !!sfgRaw?.trim()
  const modes  = [hasOpt, hasSfg, wantAll].filter(Boolean).length
  if (modes === 0) return res.status(400).json({ error: 'opt_name is required' })
  if (modes > 1)   return res.status(400).json({ error: 'Use only one of opt_name, sfg_id, all' })

  const parsed = parseFields(
    req.query.fields ?? req.query.select ?? req.query.columns,
    hasOpt ? ['preferred_name'] : ALLOWED_FIELDS,
  )
  if (parsed.error) return res.status(400).json({ error: parsed.error })
  const columns = parsed.fields.join(', ')

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  // ── By Opt! name (original behavior) ──────────────────────────────────────
  if (hasOpt) {
    const { data, error } = await supabase
      .from('personnel')
      .select(columns)
      .ilike('opt_name', optName.trim())
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ results: data ?? [] })
  }

  // ── By SFG ID (one or a comma list) ───────────────────────────────────────
  if (hasSfg) {
    const ids = [...new Set(sfgRaw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean))]
    if (ids.length > MAX_SFG_IDS) {
      return res.status(400).json({ error: `At most ${MAX_SFG_IDS} sfg_id values per request` })
    }
    const { data, error } = await supabase
      .from('personnel')
      .select(columns)
      .in('sfg_id', ids)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ results: data ?? [] })
  }

  // ── Whole roster, paged past the 1,000-row API cap ────────────────────────
  // Includes non-Active people unless ?status= narrows it: an upline chain can
  // run through someone who has since lapsed or terminated.
  const results = []
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from('personnel').select(columns).order('sfg_id').range(from, from + PAGE - 1)
    if (status?.trim()) q = q.ilike('status', status.trim())
    const { data, error } = await q
    if (error) return res.status(500).json({ error: error.message })
    results.push(...(data ?? []))
    if ((data?.length ?? 0) < PAGE) break
  }
  return res.status(200).json({ results })
}
