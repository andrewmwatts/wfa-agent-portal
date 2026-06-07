// Shared server-side auth for the serverless API routes.
//
// Every route uses the service-role key (which bypasses RLS), so each route is
// responsible for verifying the caller. Use requireAuth() at the top of a
// handler to reject anonymous requests, and getCaller() when you need the
// caller's identity for finer-grained authorization.
//
// VITE_BYPASS_AUTH=true short-circuits to a super_admin identity for local dev.

import { createClient } from '@supabase/supabase-js'

let _sb
// Lazy so process.env is populated (dotenv in the importing route runs first).
function sb() {
  if (!_sb) {
    _sb = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )
  }
  return _sb
}

export function bypassAuth() {
  return process.env.VITE_BYPASS_AUTH === 'true'
}

// token → caller cache (10 min) to avoid two Supabase calls per request
const cache = new Map()
const TTL = 10 * 60 * 1000

export function getBearerToken(req) {
  return req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? null
}

// Resolve { id, sfg_id, role } from the request's bearer token, or null.
export async function getCaller(req) {
  if (bypassAuth()) return { id: null, sfg_id: 'BYPASS', role: 'super_admin' }

  const token = getBearerToken(req)
  if (!token) return null

  const hit = cache.get(token)
  if (hit && hit.exp > Date.now()) return hit.caller

  const { data: { user }, error } = await sb().auth.getUser(token)
  if (error || !user) return null

  const { data } = await sb().from('users').select('sfg_id, role').eq('id', user.id).maybeSingle()
  const caller = { id: user.id, sfg_id: data?.sfg_id ?? null, role: data?.role ?? null }
  cache.set(token, { caller, exp: Date.now() + TTL })
  return caller
}

// Reject anonymous requests. Returns the caller, or null after sending 401.
export async function requireAuth(req, res) {
  const caller = await getCaller(req)
  if (!caller) {
    res.status(401).json({ error: 'Unauthorized' })
    return null
  }
  return caller
}

// Reject non-super_admin requests. Returns the caller, or null after sending 401/403.
export async function requireSuperAdmin(req, res) {
  const caller = await getCaller(req)
  if (!caller) { res.status(401).json({ error: 'Unauthorized' }); return null }
  if (caller.role !== 'super_admin') { res.status(403).json({ error: 'Forbidden' }); return null }
  return caller
}

// ── Subject (sfg_id) authorization ──────────────────────────────────────────
// The set of sfg_ids a caller may read: themselves, everyone in their downline
// subtree, and everyone in the subtree of any agent actively delegated to them.
// Returns null to mean "all subjects" (super_admin / bypass).

const allowedCache = new Map() // sfg_id(UPPER) → { ids:Set|null, exp }
const ALLOWED_TTL = 5 * 60 * 1000

export async function getAllowedSfgIds(caller, supabase) {
  if (bypassAuth() || caller?.role === 'super_admin') return null
  const key = (caller?.sfg_id || '').toUpperCase()
  if (!key) return new Set()

  const hit = allowedCache.get(key)
  if (hit && hit.exp > Date.now()) return hit.ids

  // Roots the caller may act as: self + agents actively delegated to them.
  const roots = new Set([key])
  const { data: dele } = await supabase
    .from('agent_assistants')
    .select('agent_sfg_id')
    .eq('assistant_sfg_id', key)
    .eq('is_active', true)
  for (const d of dele ?? []) if (d.agent_sfg_id) roots.add(d.agent_sfg_id.toUpperCase())

  // Build the personnel tree once and collect each root's subtree.
  const { data: tree } = await supabase.from('personnel').select('sfg_id, upline_sfg_id')
  const childrenOf = {}
  for (const p of tree ?? []) {
    const up = p.upline_sfg_id?.trim().toLowerCase()
    if (!up) continue
    ;(childrenOf[up] ??= []).push(p.sfg_id.toLowerCase())
  }
  const ids = new Set()
  const visit = (lower) => {
    const upper = lower.toUpperCase()
    if (ids.has(upper)) return
    ids.add(upper)
    for (const child of childrenOf[lower] ?? []) visit(child)
  }
  for (const r of roots) visit(r.toLowerCase())

  allowedCache.set(key, { ids, exp: Date.now() + ALLOWED_TTL })
  return ids
}

// True if every requested id is within the caller's allowed set (null = all).
export function scopeAllowed(allowed, ids) {
  if (allowed === null) return true
  return ids.every(id => id && allowed.has(String(id).toUpperCase()))
}

// Authorize a route's requested subject ids. Returns true, or sends 403 and
// returns false. An empty list is treated as caller-scoped (route's own concern).
export async function authorizeScope(req, res, caller, supabase, ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean)
  if (!list.length) return true
  const allowed = await getAllowedSfgIds(caller, supabase)
  if (!scopeAllowed(allowed, list)) {
    res.status(403).json({ error: 'Forbidden: subject outside your scope' })
    return false
  }
  return true
}
