import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

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
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    // Check if this email already has a portal account
    const { data: existing } = await supabase
      .from('users')
      .select('sfg_id, full_name')
      .eq('email', email)
      .maybeSingle()

    if (existing) {
      return res.status(409).json({
        error:   'already_registered',
        message: 'This email already has a portal account. Use SFG ID delegation instead.',
        sfg_id:  existing.sfg_id,
        name:    existing.full_name,
      })
    }

    // Deactivate any existing pending invite for this email + agent combo
    await supabase
      .from('delegate_invites')
      .update({ accepted_at: new Date().toISOString() }) // soft-cancel
      .eq('agent_sfg_id', agent_sfg_id)
      .eq('invitee_email', email)
      .is('accepted_at', null)

    // Create the invite record
    const { data: invite, error: inviteErr } = await supabase
      .from('delegate_invites')
      .insert({ agent_sfg_id, invitee_email: email, sections })
      .select('id')
      .single()

    if (inviteErr) throw inviteErr

    // Send the Supabase invite email
    const siteUrl = process.env.VITE_SITE_URL || process.env.SITE_URL || 'http://localhost:5173'
    const { error: authErr } = await supabase.auth.admin.inviteUserByEmail(email, {
      data:       { is_delegate: true, invite_id: invite.id },
      redirectTo: `${siteUrl}/accept-invite`,
    })

    if (authErr) throw authErr

    return res.status(200).json({ success: true })
  } catch (err) {
    console.error('[invite-delegate]', err)
    return res.status(500).json({ error: err.message ?? 'Failed to send invite' })
  }
}
