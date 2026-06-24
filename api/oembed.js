import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { requireAuth } from './_auth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

function extractVimeoId(url) {
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)
  return m?.[1] ?? ''
}

function extractYouTubeId(url) {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?/]+)/)
  return m?.[1] ?? ''
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return }

  const caller = await requireAuth(req, res)
  if (!caller) return

  const { url } = req.query
  if (!url) { res.status(400).json({ error: 'url param required' }); return }

  try {
    let result = null

    if (url.includes('vimeo.com')) {
      const r = await fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`)
      if (r.ok) {
        const d = await r.json()
        result = {
          title:     d.title ?? '',
          thumbnail: d.thumbnail_url ?? '',
          vimeo_id:  extractVimeoId(url) ?? null,
        }
      }
    } else if (url.includes('youtube.com') || url.includes('youtu.be')) {
      const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`)
      if (r.ok) {
        const d = await r.json()
        result = {
          title:     d.title ?? '',
          thumbnail: d.thumbnail_url ?? '',
        }
      }
    } else if (url.includes('loom.com')) {
      const r = await fetch(`https://www.loom.com/v1/oembed?url=${encodeURIComponent(url)}`)
      if (r.ok) {
        const d = await r.json()
        result = {
          title:     d.title ?? '',
          thumbnail: d.thumbnail_url ?? '',
        }
      }
    }

    if (!result) {
      return res.status(422).json({ error: 'Could not fetch oEmbed data for this URL' })
    }

    res.setHeader('Cache-Control', 'public, max-age=3600')
    return res.json(result)
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
