import { createClient } from '@supabase/supabase-js'
import { requireSuperAdmin } from './_auth.js'

const BUCKET = 'MACC schedule'
const PATH   = 'current.jpg'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const caller = await requireSuperAdmin(req, res)
  if (!caller) return

  const { data: base64, mimeType } = req.body ?? {}
  if (!base64) return res.status(400).json({ error: 'Missing file data' })

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  const buffer = Buffer.from(base64, 'base64')

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(PATH, buffer, {
      contentType: mimeType || 'image/jpeg',
      upsert: true,
    })

  if (error) return res.status(500).json({ error: error.message })

  res.json({ ok: true, url: `${process.env.VITE_SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(BUCKET)}/${PATH}` })
}
