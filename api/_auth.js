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
