import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import { getCaller } from './_auth.js'

// Case-insensitive SFG ID equality
const sameSfg = (a, b) => !!a && !!b && String(a).toUpperCase() === String(b).toUpperCase()

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

/**
 * Users API  (consolidated: provision-user + user-settings + validate-agent +
 *             accept-invite + delegation + invite-delegate + sync-hidden-agents)
 *
 *   POST  /api/users?action=provision      → create portal user row
 *   POST  /api/users?action=validate       → validate SFG ID + email at registration
 *   POST  /api/users?action=accept-invite  → accept delegate invite
 *   POST  /api/users?action=delegate       → create delegation
 *   DELETE /api/users?action=delegate      → revoke delegation
 *   POST  /api/users?action=invite         → send delegate invite email
 *   POST  /api/users?action=sync-hidden    → sync hidden agent IDs from Google Sheet
 *   PATCH /api/users                       → update user_settings (hide/unhide agent)
 */

const SHEET_ID       = '1fbkq51BkFOY07RY2pASi-lHCYfjEPzPUD5BvkZZxhTU'
const ONBOARDING_TAB = 'Onboarding'

// ── provision-user helpers ────────────────────────────────────────────────────

async function resolveRole(supabase, sfgId) {
  const { data: promos } = await supabase
    .from('agent_promotions')
    .select('level, month_1, month_2, month_3')
    .eq('sfg_id', sfgId.trim().toUpperCase())
    .eq('promotion_type', 'leadership')

  if (!promos?.length) return 'agent'
  const byLevel = {}
  for (const row of promos) byLevel[row.level?.toUpperCase()] = row
  const ao = byLevel['AO']
  if (ao?.month_1 && ao?.month_2 && ao?.month_3) return 'owner'
  const kl = byLevel['KL']
  if (kl?.month_1 && kl?.month_2) return 'leader'
  return 'agent'
}

async function findAgencyOwner(supabase, startSfgId, selfRole = 'agent') {
  const MAX_DEPTH = 5
  let currentId = startSfgId.trim().toUpperCase()
  if (['owner', 'director'].includes(selfRole)) return currentId
  for (let i = 0; i < MAX_DEPTH; i++) {
    const { data: personnelRow } = await supabase
      .from('personnel')
      .select('upline_sfg_id')
      .eq('sfg_id', currentId)
      .maybeSingle()
    const uplineId = personnelRow?.upline_sfg_id?.trim()?.toUpperCase()
    if (!uplineId) break
    const { data: portalUser } = await supabase
      .from('users')
      .select('role, agency_owner')
      .eq('sfg_id', uplineId)
      .maybeSingle()
    if (portalUser) {
      if (['owner', 'director'].includes(portalUser.role)) return uplineId
      if (portalUser.agency_owner) return portalUser.agency_owner
    }
    currentId = uplineId
  }
  return null
}

// ── accept-invite helper ──────────────────────────────────────────────────────

function generateExtId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const rand  = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  return `EXT-${rand}`
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const action = req.query.action

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  // ── PATCH — user-settings (hide/unhide agent) ─────────────────────────────
  // Scoped to non-delegate PATCH so the `?action=delegate` branch stays reachable.
  if (req.method === 'PATCH' && action !== 'delegate') {
    let user_id, settingAction, sfg_id
    try {
      const body  = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
      user_id       = body.user_id
      settingAction = body.action
      sfg_id        = body.sfg_id
    } catch {
      return res.status(400).json({ error: 'Invalid request body' })
    }

    if (!user_id || !sfg_id || !['hide', 'unhide'].includes(settingAction)) {
      return res.status(400).json({ error: 'user_id, action (hide|unhide), and sfg_id are required' })
    }

    // Only the owner of the settings row (or a super_admin) may modify it.
    const caller = await getCaller(req)
    if (!caller) return res.status(401).json({ error: 'Unauthorized' })
    if (caller.role !== 'super_admin' && caller.id !== user_id) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    try {
      const { data: current } = await supabase
        .from('user_settings')
        .select('hidden_sfg_ids')
        .eq('user_id', user_id)
        .maybeSingle()

      const list    = current?.hidden_sfg_ids ?? []
      const updated = settingAction === 'hide'
        ? (list.includes(sfg_id) ? list : [...list, sfg_id])
        : list.filter(id => id !== sfg_id)

      const { error } = await supabase
        .from('user_settings')
        .upsert({ user_id, hidden_sfg_ids: updated }, { onConflict: 'user_id' })

      if (error) throw error
      return res.status(200).json({ success: true, hidden_sfg_ids: updated })
    } catch (err) {
      console.error('[users/settings]', err)
      return res.status(500).json({ error: 'Failed to update settings' })
    }
  }

  // ── GET ?action=lookup-delegate ───────────────────────────────────────────
  if (req.method === 'GET' && action === 'lookup-delegate') {
    const caller = await getCaller(req)
    if (!caller) return res.status(401).json({ error: 'Unauthorized' })

    const sfg_id = req.query.sfg_id?.trim()
    if (!sfg_id) return res.status(400).json({ error: 'sfg_id required' })

    // Check users table first — only portal account holders can be delegated to
    const { data: user } = await supabase
      .from('users')
      .select('sfg_id, full_name')
      .ilike('sfg_id', sfg_id)
      .maybeSingle()

    if (user) {
      return res.status(200).json({ found: true, hasAccount: true, sfgId: user.sfg_id, name: user.full_name || user.sfg_id })
    }

    // Not a portal user — check personnel to distinguish "unknown SFG ID" from "not yet registered"
    const { data: person } = await supabase
      .from('personnel')
      .select('sfg_id, preferred_name, opt_name')
      .ilike('sfg_id', sfg_id)
      .maybeSingle()

    if (!person) return res.status(200).json({ found: false })

    return res.status(200).json({
      found:      true,
      hasAccount: false,
      sfgId:      person.sfg_id,
      name:       person.preferred_name || person.opt_name || person.sfg_id,
    })
  }

  // ── POST ?action=provision ─────────────────────────────────────────────────
  if (req.method === 'POST' && action === 'provision') {
    let user_id, email, sfg_id, full_name
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
      user_id   = body.user_id
      email     = body.email
      sfg_id    = body.sfg_id
      full_name = body.full_name
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' })
    }

    if (!user_id || !email || !sfg_id) {
      return res.status(400).json({ error: 'user_id, email, and sfg_id are required' })
    }

    try {
      const role         = await resolveRole(supabase, sfg_id)
      const agency_owner = await findAgencyOwner(supabase, sfg_id, role)

      const { error } = await supabase.from('users').insert({
        id:           user_id,
        email:        email.trim().toLowerCase(),
        sfg_id:       sfg_id.trim(),
        full_name:    full_name?.trim() ?? '',
        role,
        is_active:    true,
        agency_owner: agency_owner ?? null,
      })

      if (error) {
        console.error('[users/provision] insert error:', error)
        return res.status(500).json({ error: error.message ?? 'Failed to create portal account' })
      }

      const { data: superAdmins } = await supabase
        .from('users').select('id').eq('role', 'super_admin').limit(1)
      const superAdminId = superAdmins?.[0]?.id
      if (superAdminId) {
        const { data: adminSettings } = await supabase
          .from('user_settings').select('hidden_sfg_ids').eq('user_id', superAdminId).maybeSingle()
        const hiddenIds = adminSettings?.hidden_sfg_ids ?? []
        if (hiddenIds.length) {
          await supabase.from('user_settings')
            .upsert({ user_id, hidden_sfg_ids: hiddenIds }, { onConflict: 'user_id' })
        }
      }

      return res.status(200).json({ success: true, agency_owner })
    } catch (err) {
      console.error('[users/provision] unexpected error:', err)
      return res.status(500).json({ error: 'Failed to create portal account' })
    }
  }

  // ── POST ?action=validate ──────────────────────────────────────────────────
  if (req.method === 'POST' && action === 'validate') {
    let sfg_id, email
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
      sfg_id = body.sfg_id
      email  = body.email
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' })
    }

    if (!sfg_id || !email) return res.status(400).json({ error: 'sfg_id and email are required' })

    try {
      const { data: person, error: personError } = await supabase
        .from('personnel')
        .select('sfg_id, preferred_name, opt_name')
        .ilike('sfg_id', sfg_id.trim())
        .maybeSingle()
      if (personError) throw personError
      if (!person) return res.status(200).json({ valid: false, reason: 'sfg_not_found' })

      const { data: bySfg, error: sfgError } = await supabase
        .from('users').select('id').eq('sfg_id', sfg_id.trim()).maybeSingle()
      if (sfgError) throw sfgError
      if (bySfg) return res.status(200).json({ valid: false, reason: 'sfg_already_registered' })

      const { data: byEmail, error: emailError } = await supabase
        .from('users').select('id').eq('email', email.trim().toLowerCase()).maybeSingle()
      if (emailError) throw emailError
      if (byEmail) return res.status(200).json({ valid: false, reason: 'email_already_registered' })

      const displayName = person.preferred_name?.trim() || person.opt_name?.trim() || ''
      return res.status(200).json({
        valid:          true,
        full_name:      displayName,
        preferred_name: person.preferred_name?.trim() ?? '',
        opt_name:       person.opt_name?.trim() ?? '',
      })
    } catch (err) {
      console.error('[users/validate]', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  // ── POST ?action=accept-invite ─────────────────────────────────────────────
  if (req.method === 'POST' && action === 'accept-invite') {
    let invite_id, user_id, full_name
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
      invite_id = body.invite_id
      user_id   = body.user_id
      full_name = body.full_name?.trim()
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' })
    }

    if (!invite_id || !user_id || !full_name) {
      return res.status(400).json({ error: 'invite_id, user_id, and full_name are required' })
    }

    try {
      const { data: invite, error: inviteErr } = await supabase
        .from('delegate_invites')
        .select('id, agent_sfg_id, invitee_email, sections, accepted_at')
        .eq('id', invite_id)
        .maybeSingle()
      if (inviteErr) throw inviteErr
      if (!invite)            return res.status(404).json({ error: 'Invite not found.' })
      if (invite.accepted_at) return res.status(409).json({ error: 'This invite has already been used.' })

      const { data: { user: authUser }, error: authErr } = await supabase.auth.admin.getUserById(user_id)
      if (authErr) throw authErr

      let sfg_id, attempts = 0
      while (attempts < 10) {
        const candidate = generateExtId()
        const { data: clash } = await supabase.from('users').select('id').eq('sfg_id', candidate).maybeSingle()
        if (!clash) { sfg_id = candidate; break }
        attempts++
      }
      if (!sfg_id) throw new Error('Could not generate a unique delegate ID.')

      const { error: userErr } = await supabase.from('users').insert({
        id: user_id, email: authUser.email, sfg_id, full_name,
        role: 'agent', is_assistant: true, is_active: true, agency_owner: null,
      })
      if (userErr) throw userErr

      const { data: assignment, error: assignErr } = await supabase
        .from('agent_assistants')
        .insert({ agent_sfg_id: invite.agent_sfg_id, assistant_sfg_id: sfg_id, is_active: true })
        .select('id').single()
      if (assignErr) throw assignErr

      const sections = Array.isArray(invite.sections) ? invite.sections : JSON.parse(invite.sections ?? '[]')
      const permRows = sections
        .filter(s => s)
        .map(s => typeof s === 'string'
          ? { agent_assistant_id: assignment.id, section: s, can_read: true,       can_write: false }
          : { agent_assistant_id: assignment.id, section: s.section, can_read: !!s.can_read, can_write: !!s.can_write }
        )
        .filter(r => r.section)
      if (permRows.length) {
        const { error: permErr } = await supabase.from('assistant_permissions').insert(permRows)
        if (permErr) throw permErr
      }

      await supabase
        .from('delegate_invites')
        .update({ accepted_at: new Date().toISOString(), accepted_user_id: user_id })
        .eq('id', invite_id)

      return res.status(200).json({ success: true, sfg_id })
    } catch (err) {
      console.error('[users/accept-invite]', err)
      return res.status(500).json({ error: err.message ?? 'Failed to complete invite' })
    }
  }

  // ── POST ?action=delegate  (create delegation) ─────────────────────────────
  if (req.method === 'POST' && action === 'delegate') {
    let agent_sfg_id, assistant_sfg_id, sections
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
      agent_sfg_id     = body.agent_sfg_id
      assistant_sfg_id = body.assistant_sfg_id
      sections         = body.sections
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' })
    }

    if (!agent_sfg_id || !assistant_sfg_id || !sections?.length) {
      return res.status(400).json({ error: 'agent_sfg_id, assistant_sfg_id, and sections are required' })
    }

    // Only the delegating agent (or a super_admin) may create a delegation on
    // their own account.
    {
      const caller = await getCaller(req)
      if (!caller) return res.status(401).json({ error: 'Unauthorized' })
      if (caller.role !== 'super_admin' && !sameSfg(caller.sfg_id, agent_sfg_id)) {
        return res.status(403).json({ error: 'Forbidden' })
      }
    }

    try {
      await supabase
        .from('agent_assistants')
        .update({ is_active: false })
        .eq('agent_sfg_id', agent_sfg_id)
        .eq('assistant_sfg_id', assistant_sfg_id)

      const { data: assignment, error: assignErr } = await supabase
        .from('agent_assistants')
        .insert({ agent_sfg_id, assistant_sfg_id, is_active: true })
        .select('id').single()
      if (assignErr) throw assignErr

      const permRows = sections
        .filter(s => s.can_read || s.can_write)
        .map(({ section, can_read = false, can_write = false }) => ({
          agent_assistant_id: assignment.id, section, can_read, can_write,
        }))
      if (permRows.length) {
        const { error: permErr } = await supabase.from('assistant_permissions').insert(permRows)
        if (permErr) throw permErr
      }

      return res.status(200).json({ success: true, id: assignment.id })
    } catch (err) {
      console.error('[users/delegate POST]', err)
      return res.status(500).json({ error: err.message ?? 'Failed to create delegation' })
    }
  }

  // ── PATCH ?action=delegate  (update delegation permissions) ──────────────
  if (req.method === 'PATCH' && action === 'delegate') {
    let id, sections
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
      id       = body.id
      sections = body.sections
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' })
    }

    if (!id || !Array.isArray(sections)) {
      return res.status(400).json({ error: 'id and sections are required' })
    }

    // Authorize against the delegation's owning agent.
    {
      const caller = await getCaller(req)
      if (!caller) return res.status(401).json({ error: 'Unauthorized' })
      const { data: asg } = await supabase
        .from('agent_assistants').select('agent_sfg_id').eq('id', id).maybeSingle()
      if (!asg) return res.status(404).json({ error: 'Delegation not found' })
      if (caller.role !== 'super_admin' && !sameSfg(caller.sfg_id, asg.agent_sfg_id)) {
        return res.status(403).json({ error: 'Forbidden' })
      }
    }

    try {
      await supabase.from('assistant_permissions').delete().eq('agent_assistant_id', id)
      const permRows = sections
        .filter(s => s.can_read || s.can_write)
        .map(({ section, can_read = false, can_write = false }) => ({
          agent_assistant_id: id, section, can_read, can_write,
        }))
      if (permRows.length) {
        const { error: permErr } = await supabase.from('assistant_permissions').insert(permRows)
        if (permErr) throw permErr
      }
      return res.status(200).json({ success: true })
    } catch (err) {
      console.error('[users/delegate PATCH]', err)
      return res.status(500).json({ error: err.message ?? 'Failed to update delegation' })
    }
  }

  // ── DELETE ?action=delegate  (revoke delegation) ───────────────────────────
  if (req.method === 'DELETE' && action === 'delegate') {
    let id
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
      id = body.id
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' })
    }

    if (!id) return res.status(400).json({ error: 'id is required' })

    // Authorize against the delegation's owning agent.
    {
      const caller = await getCaller(req)
      if (!caller) return res.status(401).json({ error: 'Unauthorized' })
      const { data: asg } = await supabase
        .from('agent_assistants').select('agent_sfg_id').eq('id', id).maybeSingle()
      if (!asg) return res.status(404).json({ error: 'Delegation not found' })
      if (caller.role !== 'super_admin' && !sameSfg(caller.sfg_id, asg.agent_sfg_id)) {
        return res.status(403).json({ error: 'Forbidden' })
      }
    }

    try {
      const { error } = await supabase
        .from('agent_assistants').update({ is_active: false }).eq('id', id)
      if (error) throw error
      return res.status(200).json({ success: true })
    } catch (err) {
      console.error('[users/delegate DELETE]', err)
      return res.status(500).json({ error: err.message ?? 'Failed to revoke delegation' })
    }
  }

  // ── POST ?action=invite  (invite delegate by email) ────────────────────────
  if (req.method === 'POST' && action === 'invite') {
    let agent_sfg_id, email, sections
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
      agent_sfg_id = body.agent_sfg_id
      email        = body.email?.trim().toLowerCase()
      sections     = body.sections
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' })
    }

    if (!agent_sfg_id || !email || !sections?.length) {
      return res.status(400).json({ error: 'agent_sfg_id, email, and sections are required' })
    }

    try {
      const { data: existing } = await supabase
        .from('users').select('sfg_id, full_name').eq('email', email).maybeSingle()
      if (existing) {
        return res.status(409).json({
          error:   'already_registered',
          message: 'This email already has a portal account. Use SFG ID delegation instead.',
          sfg_id:  existing.sfg_id,
          name:    existing.full_name,
        })
      }

      await supabase
        .from('delegate_invites')
        .update({ accepted_at: new Date().toISOString() })
        .eq('agent_sfg_id', agent_sfg_id)
        .eq('invitee_email', email)
        .is('accepted_at', null)

      const { data: invite, error: inviteErr } = await supabase
        .from('delegate_invites')
        .insert({ agent_sfg_id, invitee_email: email, sections })
        .select('id').single()
      if (inviteErr) throw inviteErr

      const siteUrl = process.env.VITE_SITE_URL || process.env.SITE_URL || 'http://localhost:5173'
      const { error: authErr } = await supabase.auth.admin.inviteUserByEmail(email, {
        data:       { is_delegate: true, invite_id: invite.id },
        redirectTo: `${siteUrl}/accept-invite`,
      })
      if (authErr) throw authErr

      return res.status(200).json({ success: true })
    } catch (err) {
      console.error('[users/invite]', err)
      return res.status(500).json({ error: err.message ?? 'Failed to send invite' })
    }
  }

  // ── POST ?action=sync-hidden  (sync hidden agents from Google Sheet) ────────
  if (req.method === 'POST' && action === 'sync-hidden') {
    let user_id
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
      user_id = body.user_id
    } catch {
      return res.status(400).json({ error: 'Invalid request body' })
    }
    if (!user_id) return res.status(400).json({ error: 'user_id required' })

    try {
      const { data: userRow } = await supabase.from('users').select('role').eq('id', user_id).single()
      if (!userRow || userRow.role !== 'super_admin') {
        return res.status(403).json({ error: 'Forbidden' })
      }

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

      const headers   = rows[0].map(h => h?.trim() ?? '')
      const idxFilter = headers.findIndex(h => h.toLowerCase() === 'filter')
      const idxSfgId  = headers.findIndex(h => h.toLowerCase() === 'sfg id')

      if (idxFilter === -1) return res.status(500).json({ error: `"Filter" column not found in ${ONBOARDING_TAB} tab` })
      if (idxSfgId  === -1) return res.status(500).json({ error: `"SFG ID" column not found in ${ONBOARDING_TAB} tab` })

      const hiddenIds = []
      for (const row of rows.slice(1)) {
        const sfgId = row[idxSfgId]?.trim()
        if (!sfgId) continue
        if (row[idxFilter]?.trim()?.toUpperCase() === 'TRUE') hiddenIds.push(sfgId)
      }

      const STANDARD_ID = /^SFG\d+$/i
      const { data: existing } = await supabase
        .from('user_settings').select('hidden_sfg_ids').eq('user_id', user_id).maybeSingle()
      const nonStandard = (existing?.hidden_sfg_ids ?? []).filter(id => !STANDARD_ID.test(id))
      const merged      = [...new Set([...hiddenIds, ...nonStandard])]

      const { error: upsertErr } = await supabase
        .from('user_settings')
        .upsert({ user_id, hidden_sfg_ids: merged }, { onConflict: 'user_id' })
      if (upsertErr) {
        console.error('[users/sync-hidden] upsert error:', upsertErr)
        return res.status(500).json({ error: upsertErr.message })
      }

      return res.status(200).json({ hidden: merged.length })
    } catch (err) {
      console.error('[users/sync-hidden]', err)
      return res.status(500).json({ error: 'Sync failed' })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
