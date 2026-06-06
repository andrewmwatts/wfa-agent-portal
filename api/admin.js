import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

/**
 * Admin API  (super_admin only, except submit-bug-report and system-messages GET)
 *
 *   GET    /api/admin?action=users
 *   PATCH  /api/admin?action=user              → update email/role/leads_email/agency_owner/is_active
 *   POST   /api/admin?action=reset-password    → generate password reset link
 *   GET    /api/admin?action=bug-reports[&all=true]
 *   PATCH  /api/admin?action=bug-report        → update status / admin_notes
 *   DELETE /api/admin?action=bug-report        → delete report
 *   POST   /api/admin?action=submit-bug-report → any authenticated user
 *   GET    /api/admin?action=crosswalk
 *   PUT    /api/admin?action=crosswalk
 *   DELETE /api/admin?action=crosswalk
 *   GET    /api/admin?action=agencies
 *   PUT    /api/admin?action=agency
 *   GET    /api/admin?action=parse-errors[&all=true]
 *   POST   /api/admin?action=resolve-parse-error
 *   GET    /api/admin?action=system-messages   → any authenticated user (for banner)
 *   GET    /api/admin?action=system-messages-all
 *   POST   /api/admin?action=system-message
 *   PATCH  /api/admin?action=system-message
 */

const sb = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

async function getCallerProfile(req) {
  if (process.env.VITE_BYPASS_AUTH === 'true') {
    return { sfg_id: 'BYPASS', role: 'super_admin', id: null }
  }
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data: { user }, error } = await sb.auth.getUser(token)
  if (error || !user) return null
  const { data } = await sb.from('users').select('sfg_id, role').eq('id', user.id).single()
  if (!data) return null
  return { ...data, id: user.id }
}

async function audit(adminSfgId, action, target_table, target_id, details) {
  await sb.from('admin_audit_log').insert({
    admin_sfg_id: adminSfgId,
    action,
    target_table: target_table ?? null,
    target_id:    target_id   ? String(target_id) : null,
    details:      details     ?? null,
  }).catch(() => {})
}

function body(req) {
  try { return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}) }
  catch { return {} }
}

export default async function handler(req, res) {
  const { action } = req.query

  // ── Bug report submission — any authenticated user ────────────────────────
  if (action === 'submit-bug-report' && req.method === 'POST') {
    const caller = await getCallerProfile(req)
    if (!caller) return res.status(401).json({ error: 'Unauthorized' })
    const { page, description } = body(req)
    if (!description?.trim()) return res.status(400).json({ error: 'Description required' })
    const { error } = await sb.from('bug_reports').insert({
      sfg_id: caller.sfg_id, page: page || null, description: description.trim(),
    })
    if (error) return res.status(500).json({ error: error.message })
    return res.status(201).json({ ok: true })
  }

  // ── System messages banner — any authenticated user ───────────────────────
  if (action === 'system-messages' && req.method === 'GET') {
    const caller = await getCallerProfile(req)
    if (!caller) return res.status(401).json({ error: 'Unauthorized' })
    const now = new Date().toISOString()
    const { data, error } = await sb.from('system_messages')
      .select('*')
      .eq('is_active', true)
      .lte('display_from', now)
      .or(`display_until.is.null,display_until.gte.${now}`)
      .order('priority', { ascending: false })
      .order('display_from', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ messages: data ?? [] })
  }

  // ── All remaining actions require super_admin ─────────────────────────────
  const caller = await getCallerProfile(req)
  if (!caller || caller.role !== 'super_admin') {
    return res.status(403).json({ error: 'Forbidden' })
  }
  const adminSfgId = caller.sfg_id
  const b = body(req)

  // ── GET users ─────────────────────────────────────────────────────────────
  if (action === 'users' && req.method === 'GET') {
    const { data: users, error } = await sb.from('users')
      .select('id, sfg_id, email, role, agency_owner, leads_email, is_active, created_at')
      .order('created_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })

    const sfgIds = users.map(u => u.sfg_id).filter(Boolean)
    const { data: personnel } = await sb.from('personnel')
      .select('sfg_id, preferred_name').in('sfg_id', sfgIds)
    const nameMap = Object.fromEntries((personnel ?? []).map(p => [p.sfg_id, p.preferred_name]))

    const ownerIds = [...new Set(users.map(u => u.agency_owner).filter(Boolean))]
    let ownerNames = {}
    if (ownerIds.length) {
      const { data: ownerPersonnel } = await sb.from('personnel')
        .select('sfg_id, preferred_name').in('sfg_id', ownerIds)
      ownerNames = Object.fromEntries((ownerPersonnel ?? []).map(p => [p.sfg_id, p.preferred_name]))
    }

    // Fetch last_sign_in_at from auth admin
    const authMap = {}
    const { data: authPage } = await sb.auth.admin.listUsers({ perPage: 1000 })
    for (const u of authPage?.users ?? []) authMap[u.id] = u.last_sign_in_at

    const result = users.map(u => ({
      ...u,
      preferred_name:    nameMap[u.sfg_id]        ?? u.sfg_id,
      agency_owner_name: ownerNames[u.agency_owner] ?? u.agency_owner ?? null,
      last_sign_in_at:   authMap[u.id]             ?? null,
    }))
    return res.status(200).json({ users: result })
  }

  // ── PATCH user ────────────────────────────────────────────────────────────
  if (action === 'user' && req.method === 'PATCH') {
    const { id, ...fields } = b
    if (!id) return res.status(400).json({ error: 'id required' })
    const allowed = ['email', 'leads_email', 'role', 'agency_owner', 'is_active']
    const patch = Object.fromEntries(Object.entries(fields).filter(([k]) => allowed.includes(k)))
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'No valid fields' })

    const { error } = await sb.from('users').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) return res.status(500).json({ error: error.message })

    if (patch.email)           await sb.auth.admin.updateUserById(id, { email: patch.email })
    if (patch.is_active === false) await sb.auth.admin.updateUserById(id, { ban_duration: '876600h' })
    if (patch.is_active === true)  await sb.auth.admin.updateUserById(id, { ban_duration: 'none' })

    await audit(adminSfgId, 'update_user', 'users', id, patch)
    return res.status(200).json({ ok: true })
  }

  // ── POST reset-password ───────────────────────────────────────────────────
  if (action === 'reset-password' && req.method === 'POST') {
    const { email } = b
    if (!email) return res.status(400).json({ error: 'email required' })
    const { data, error } = await sb.auth.admin.generateLink({ type: 'recovery', email })
    if (error) return res.status(500).json({ error: error.message })
    await audit(adminSfgId, 'reset_password', 'users', email, null)
    return res.status(200).json({ link: data?.properties?.action_link ?? null })
  }

  // ── GET bug-reports ───────────────────────────────────────────────────────
  if (action === 'bug-reports' && req.method === 'GET') {
    const showAll = req.query.all === 'true'
    let q = sb.from('bug_reports').select('*').order('created_at', { ascending: false })
    if (!showAll) q = q.in('status', ['Open', 'In Progress'])
    const { data, error } = await q
    if (error) return res.status(500).json({ error: error.message })

    const sfgIds = [...new Set((data ?? []).map(r => r.sfg_id).filter(Boolean))]
    let names = {}
    if (sfgIds.length) {
      const { data: p } = await sb.from('personnel').select('sfg_id, preferred_name').in('sfg_id', sfgIds)
      names = Object.fromEntries((p ?? []).map(p => [p.sfg_id, p.preferred_name]))
    }
    const reports = (data ?? []).map(r => ({ ...r, preferred_name: names[r.sfg_id] ?? r.sfg_id }))
    return res.status(200).json({ reports })
  }

  // ── PATCH bug-report ──────────────────────────────────────────────────────
  if (action === 'bug-report' && req.method === 'PATCH') {
    const { id, status, admin_notes } = b
    if (!id) return res.status(400).json({ error: 'id required' })
    const patch = { updated_at: new Date().toISOString() }
    if (status !== undefined)      patch.status      = status
    if (admin_notes !== undefined)  patch.admin_notes = admin_notes
    const { error } = await sb.from('bug_reports').update(patch).eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    await audit(adminSfgId, 'update_bug_report', 'bug_reports', id, { status, admin_notes })
    return res.status(200).json({ ok: true })
  }

  // ── DELETE bug-report ─────────────────────────────────────────────────────
  if (action === 'bug-report' && req.method === 'DELETE') {
    const { id } = b
    if (!id) return res.status(400).json({ error: 'id required' })
    const { error } = await sb.from('bug_reports').delete().eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    await audit(adminSfgId, 'delete_bug_report', 'bug_reports', id, null)
    return res.status(200).json({ ok: true })
  }

  // ── GET crosswalk ─────────────────────────────────────────────────────────
  if (action === 'crosswalk' && req.method === 'GET') {
    const { data, error } = await sb.from('policy_crosswalk')
      .select('*').order('carrier').order('policy_name')
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ rows: data ?? [] })
  }

  // ── PUT crosswalk ─────────────────────────────────────────────────────────
  if (action === 'crosswalk' && req.method === 'PUT') {
    const { carrier, policy_name, subtype, old_carrier, old_policy_name } = b
    if (!carrier || !policy_name || !subtype) return res.status(400).json({ error: 'carrier, policy_name, subtype required' })
    if (old_carrier && (old_carrier !== carrier || old_policy_name !== policy_name)) {
      await sb.from('policy_crosswalk').delete().eq('carrier', old_carrier).eq('policy_name', old_policy_name)
    }
    const { error } = await sb.from('policy_crosswalk')
      .upsert({ carrier, policy_name, subtype }, { onConflict: 'carrier,policy_name' })
    if (error) return res.status(500).json({ error: error.message })
    await audit(adminSfgId, 'upsert_crosswalk', 'policy_crosswalk', `${carrier}|${policy_name}`, { carrier, policy_name, subtype })
    return res.status(200).json({ ok: true })
  }

  // ── DELETE crosswalk ──────────────────────────────────────────────────────
  if (action === 'crosswalk' && req.method === 'DELETE') {
    const { carrier, policy_name } = b
    if (!carrier || !policy_name) return res.status(400).json({ error: 'carrier, policy_name required' })
    const { count } = await sb.from('policies').select('id', { count: 'exact', head: true })
      .eq('carrier', carrier).eq('policy_name', policy_name)
    const { error } = await sb.from('policy_crosswalk').delete()
      .eq('carrier', carrier).eq('policy_name', policy_name)
    if (error) return res.status(500).json({ error: error.message })
    await audit(adminSfgId, 'delete_crosswalk', 'policy_crosswalk', `${carrier}|${policy_name}`, null)
    return res.status(200).json({ ok: true, usageCount: count ?? 0 })
  }

  // ── GET agencies ──────────────────────────────────────────────────────────
  if (action === 'agencies' && req.method === 'GET') {
    // Fetch all existing agency rows directly, then get all owners from users
    // so we can show owners that don't have a row yet too.
    const [{ data: agencyRows, error: agErr }, { data: ownerUsers, error: ouErr }] = await Promise.all([
      sb.from('agencies').select('*'),
      sb.from('users').select('sfg_id').in('role', ['owner', 'director', 'super_admin']),
    ])
    if (agErr) return res.status(500).json({ error: agErr.message })
    if (ouErr) return res.status(500).json({ error: ouErr.message })

    // Union of sfg_ids: owners in users table + owners already in agencies table
    const agencyMap  = Object.fromEntries((agencyRows  ?? []).map(a => [a.owner_sfg_id, a]))
    const ownerSfgIds = [...new Set([
      ...(ownerUsers ?? []).map(u => u.sfg_id),
      ...(agencyRows ?? []).map(a => a.owner_sfg_id),
    ].filter(Boolean))]

    const { data: personnel } = await sb.from('personnel')
      .select('sfg_id, preferred_name').in('sfg_id', ownerSfgIds)
    const nameMap = Object.fromEntries((personnel ?? []).map(p => [p.sfg_id, p.preferred_name]))

    const result = ownerSfgIds.map(sfgId => ({
      sfg_id:         sfgId,
      preferred_name: nameMap[sfgId]   ?? sfgId,
      agency:         agencyMap[sfgId] ?? null,
    }))
    return res.status(200).json({ agencies: result })
  }

  // ── PUT agency ────────────────────────────────────────────────────────────
  if (action === 'agency' && req.method === 'PUT') {
    const { owner_sfg_id, name, primary_color, secondary_color, accent_color, logo_url_light, logo_url_dark } = b
    if (!owner_sfg_id) return res.status(400).json({ error: 'owner_sfg_id required' })
    const { error } = await sb.from('agencies').upsert(
      { owner_sfg_id, name, primary_color, secondary_color, accent_color, logo_url_light, logo_url_dark },
      { onConflict: 'owner_sfg_id' }
    )
    if (error) return res.status(500).json({ error: error.message })
    await audit(adminSfgId, 'upsert_agency', 'agencies', owner_sfg_id, { name, primary_color, secondary_color, accent_color })
    return res.status(200).json({ ok: true })
  }

  // ── GET parse-errors ──────────────────────────────────────────────────────
  if (action === 'parse-errors' && req.method === 'GET') {
    const showAll = req.query.all === 'true'
    let q = sb.from('parse_errors').select('*').order('occurred_at', { ascending: false })
    if (!showAll) q = q.eq('resolved', false)
    let { data, error } = await q
    // If resolved column doesn't exist yet, fall back to all records
    if (error?.code === '42703') {
      const fb = await sb.from('parse_errors').select('*').order('occurred_at', { ascending: false })
      data = fb.data; error = fb.error
    }
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ errors: data ?? [] })
  }

  // ── POST resolve-parse-error ──────────────────────────────────────────────
  if (action === 'resolve-parse-error' && req.method === 'POST') {
    const { id } = b
    if (!id) return res.status(400).json({ error: 'id required' })
    const { error } = await sb.from('parse_errors').update({ resolved: true }).eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    await audit(adminSfgId, 'resolve_parse_error', 'parse_errors', String(id), null)
    return res.status(200).json({ ok: true })
  }

  // ── GET system-messages-all (admin) ───────────────────────────────────────
  if (action === 'system-messages-all' && req.method === 'GET') {
    const { data, error } = await sb.from('system_messages')
      .select('*').order('created_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ messages: data ?? [] })
  }

  // ── POST system-message ───────────────────────────────────────────────────
  if (action === 'system-message' && req.method === 'POST') {
    const { message, audience, priority, display_from, display_until } = b
    if (!message?.trim()) return res.status(400).json({ error: 'message required' })
    const { data, error } = await sb.from('system_messages').insert({
      message: message.trim(),
      audience:      audience     || 'all',
      priority:      priority     || 'Info',
      display_from:  display_from || new Date().toISOString(),
      display_until: display_until || null,
      created_by:    adminSfgId,
    }).select().single()
    if (error) return res.status(500).json({ error: error.message })
    await audit(adminSfgId, 'create_system_message', 'system_messages', data.id, { audience, priority })
    return res.status(201).json({ message: data })
  }

  // ── PATCH system-message ──────────────────────────────────────────────────
  if (action === 'system-message' && req.method === 'PATCH') {
    const { id, ...fields } = b
    if (!id) return res.status(400).json({ error: 'id required' })
    const allowed = ['message', 'audience', 'priority', 'display_from', 'display_until', 'is_active']
    const patch = Object.fromEntries(Object.entries(fields).filter(([k]) => allowed.includes(k)))
    const { error } = await sb.from('system_messages').update(patch).eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    await audit(adminSfgId, 'update_system_message', 'system_messages', id, patch)
    return res.status(200).json({ ok: true })
  }

  return res.status(404).json({ error: `Unknown action: ${action}` })
}
