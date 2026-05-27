import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

// Generate a unique external delegate ID
function generateExtId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const rand  = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  return `EXT-${rand}`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

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
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    // Load and validate the invite
    const { data: invite, error: inviteErr } = await supabase
      .from('delegate_invites')
      .select('id, agent_sfg_id, invitee_email, sections, accepted_at')
      .eq('id', invite_id)
      .maybeSingle()

    if (inviteErr) throw inviteErr
    if (!invite)              return res.status(404).json({ error: 'Invite not found.' })
    if (invite.accepted_at)   return res.status(409).json({ error: 'This invite has already been used.' })

    // Get the auth user's email for public.users
    const { data: { user: authUser }, error: authErr } = await supabase.auth.admin.getUserById(user_id)
    if (authErr) throw authErr

    // Generate a unique dummy SFG ID (retry on collision)
    let sfg_id, attempts = 0
    while (attempts < 10) {
      const candidate = generateExtId()
      const { data: clash } = await supabase
        .from('users')
        .select('id')
        .eq('sfg_id', candidate)
        .maybeSingle()
      if (!clash) { sfg_id = candidate; break }
      attempts++
    }
    if (!sfg_id) throw new Error('Could not generate a unique delegate ID.')

    // Create public.users row
    const { error: userErr } = await supabase
      .from('users')
      .insert({
        id:           user_id,
        email:        authUser.email,
        sfg_id,
        full_name,
        role:         'agent',
        is_assistant: true,
        is_active:    true,
        agency_owner: null,
      })
    if (userErr) throw userErr

    // Create agent_assistants row
    const { data: assignment, error: assignErr } = await supabase
      .from('agent_assistants')
      .insert({
        agent_sfg_id:     invite.agent_sfg_id,
        assistant_sfg_id: sfg_id,
        is_active:        true,
      })
      .select('id')
      .single()
    if (assignErr) throw assignErr

    // Create assistant_permissions rows
    const sections = Array.isArray(invite.sections) ? invite.sections : JSON.parse(invite.sections ?? '[]')
    const permRows = sections.map(section => ({
      agent_assistant_id: assignment.id,
      section,
      can_read:  true,
      can_write: false,
    }))

    if (permRows.length) {
      const { error: permErr } = await supabase.from('assistant_permissions').insert(permRows)
      if (permErr) throw permErr
    }

    // Mark invite as accepted
    await supabase
      .from('delegate_invites')
      .update({ accepted_at: new Date().toISOString(), accepted_user_id: user_id })
      .eq('id', invite_id)

    return res.status(200).json({ success: true, sfg_id })
  } catch (err) {
    console.error('[accept-invite]', err)
    return res.status(500).json({ error: err.message ?? 'Failed to complete invite' })
  }
}
