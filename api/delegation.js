import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

export default async function handler(req, res) {
  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // ── POST: create delegation ────────────────────────────────────────────────
  if (req.method === 'POST') {
    let agent_sfg_id, assistant_sfg_id, sections
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
      agent_sfg_id     = body.agent_sfg_id
      assistant_sfg_id = body.assistant_sfg_id
      sections         = body.sections  // string[]
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' })
    }

    if (!agent_sfg_id || !assistant_sfg_id || !sections?.length) {
      return res.status(400).json({ error: 'agent_sfg_id, assistant_sfg_id, and sections are required' })
    }

    try {
      // Deactivate any existing delegation between these two first (idempotent)
      await supabase
        .from('agent_assistants')
        .update({ is_active: false })
        .eq('agent_sfg_id', agent_sfg_id)
        .eq('assistant_sfg_id', assistant_sfg_id)

      // Create new delegation record
      const { data: assignment, error: assignErr } = await supabase
        .from('agent_assistants')
        .insert({ agent_sfg_id, assistant_sfg_id, is_active: true })
        .select('id')
        .single()

      if (assignErr) throw assignErr

      // Insert permissions for each selected section
      const permRows = sections.map(section => ({
        agent_assistant_id: assignment.id,
        section,
        can_read:  true,
        can_write: false,
      }))

      const { error: permErr } = await supabase
        .from('assistant_permissions')
        .insert(permRows)

      if (permErr) throw permErr

      return res.status(200).json({ success: true, id: assignment.id })
    } catch (err) {
      console.error('[delegation] POST error:', err)
      return res.status(500).json({ error: err.message ?? 'Failed to create delegation' })
    }
  }

  // ── DELETE: revoke delegation ──────────────────────────────────────────────
  if (req.method === 'DELETE') {
    let id
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
      id = body.id
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' })
    }

    if (!id) return res.status(400).json({ error: 'id is required' })

    try {
      const { error } = await supabase
        .from('agent_assistants')
        .update({ is_active: false })
        .eq('id', id)

      if (error) throw error
      return res.status(200).json({ success: true })
    } catch (err) {
      console.error('[delegation] DELETE error:', err)
      return res.status(500).json({ error: err.message ?? 'Failed to revoke delegation' })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
