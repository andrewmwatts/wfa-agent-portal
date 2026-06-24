import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

/**
 * Resources API — video library CRUD
 *
 *   GET  /api/resources?type=series              → list resource_series (auth required)
 *   GET  /api/resources[?series_id=&platform=&is_published=&q=&limit=&offset=]
 *                                                → paginated list (auth required)
 *   POST /api/resources                          → create resource (super_admin only)
 *   PATCH /api/resources?id=X                   → update resource (super_admin only)
 *   DELETE /api/resources?id=X                  → delete resource (super_admin only)
 *
 * Table: resources
 *   id, title, description, video_date, content_type, platform, url,
 *   thumbnail_url, series_id, series_slug, source_series, speakers, topics,
 *   vimeo_id, source_account, is_published, is_huddle, sort_order,
 *   created_at, updated_at
 *
 * Table: resource_series
 *   id, name, abbreviation, slug, description, category_id, is_published,
 *   sort_order, created_at
 */

const sb = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

async function getCaller(req) {
  if (process.env.VITE_BYPASS_AUTH === 'true') {
    return { role: 'super_admin' }
  }
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data: { user }, error } = await sb.auth.getUser(token)
  if (error || !user) return null
  const { data } = await sb.from('users').select('role').eq('id', user.id).maybeSingle()
  return data ? { role: data.role } : null
}

function detectPlatform(url) {
  if (!url) return 'other'
  if (url.includes('vimeo.com'))   return 'vimeo'
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube'
  if (url.includes('loom.com'))    return 'loom'
  return 'other'
}

function extractVimeoId(url) {
  const m = url?.match(/vimeo\.com\/(?:video\/)?(\d+)/)
  return m?.[1] ?? null
}

export default async function handler(req, res) {
  const { type, id, limit = '25', offset = '0', series_id, platform, is_published, q } = req.query

  // ── GET /api/resources?type=series ────────────────────────────────────────
  if (req.method === 'GET' && type === 'series') {
    const caller = await getCaller(req)
    if (!caller) { res.status(401).json({ error: 'Unauthorized' }); return }

    const { data, error } = await sb
      .from('resource_series')
      .select('id, name, abbreviation, slug, is_published, sort_order')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('name')
    if (error) { res.status(500).json({ error: error.message }); return }
    return res.json({ series: data ?? [] })
  }

  // ── GET /api/resources — list with filters ─────────────────────────────────
  if (req.method === 'GET' && !id) {
    const caller = await getCaller(req)
    if (!caller) { res.status(401).json({ error: 'Unauthorized' }); return }

    const lim = Math.min(Number(limit) || 25, 100)
    const off = Number(offset) || 0

    let query = sb
      .from('resources')
      .select('id, title, description, video_date, content_type, platform, url, thumbnail_url, series_id, series_slug, source_series, speakers, topics, vimeo_id, source_account, is_published, is_huddle, sort_order, created_at, resource_series(name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(off, off + lim - 1)

    if (series_id)    query = query.eq('series_id', series_id)
    if (platform)     query = query.eq('platform', platform)
    if (is_published !== undefined && is_published !== '') {
      query = query.eq('is_published', is_published === 'true')
    }
    if (q) query = query.or(`title.ilike.%${q}%,speakers.ilike.%${q}%`)

    const { data, error, count } = await query
    if (error) { res.status(500).json({ error: error.message }); return }

    const resources = (data ?? []).map(r => ({
      ...r,
      series_name:    r.resource_series?.name ?? null,
      resource_series: undefined,
    }))
    return res.json({ resources, total: count ?? 0 })
  }

  // ── All writes require super_admin ────────────────────────────────────────
  const caller = await getCaller(req)
  if (!caller)                        { res.status(401).json({ error: 'Unauthorized' }); return }
  if (caller.role !== 'super_admin')  { res.status(403).json({ error: 'Forbidden' });    return }

  // ── POST /api/resources — create ──────────────────────────────────────────
  if (req.method === 'POST') {
    const b = req.body ?? {}
    if (!b.title?.trim()) { res.status(400).json({ error: 'title required' }); return }

    const plt    = b.platform || detectPlatform(b.url)
    const vimId  = b.vimeo_id || (plt === 'vimeo' ? extractVimeoId(b.url) : null)

    // Auto-fill series_slug from series_id if not provided
    let seriesSlug = b.series_slug || null
    if (b.series_id && !seriesSlug) {
      const { data: s } = await sb.from('resource_series').select('slug').eq('id', b.series_id).maybeSingle()
      seriesSlug = s?.slug ?? null
    }

    const row = {
      title:          b.title.trim(),
      description:    b.description    || null,
      video_date:     b.video_date     || null,
      platform:       plt,
      url:            b.url            || null,
      thumbnail_url:  b.thumbnail_url  || null,
      series_id:      b.series_id      || null,
      series_slug:    seriesSlug,
      source_series:  b.source_series  || null,
      speakers:       b.speakers       || null,
      topics:         b.topics         ?? [],
      vimeo_id:       vimId            || null,
      source_account: b.source_account || null,
      is_published:   b.is_published   ?? true,
      is_huddle:      b.is_huddle      ?? false,
    }
    // Omit content_type and sort_order when blank so DB defaults ('video', 0) apply
    if (b.content_type) row.content_type = b.content_type
    if (b.sort_order != null && b.sort_order !== '') row.sort_order = Number(b.sort_order)

    const { data, error } = await sb.from('resources').insert(row).select().single()

    if (error) { res.status(500).json({ error: error.message }); return }
    return res.status(201).json({ resource: data })
  }

  // ── PATCH /api/resources?id=X — update ────────────────────────────────────
  if (req.method === 'PATCH' && id) {
    const b = req.body ?? {}
    const ALLOWED = [
      'title', 'description', 'video_date', 'content_type', 'platform',
      'url', 'thumbnail_url', 'series_id', 'series_slug', 'source_series',
      'speakers', 'topics', 'vimeo_id', 'source_account',
      'is_published', 'is_huddle', 'sort_order',
    ]
    const patch = {}
    for (const k of ALLOWED) {
      if (k in b) patch[k] = b[k]
    }

    // Derive platform from url if url changed but platform not explicitly set
    if ('url' in patch && !('platform' in patch)) {
      patch.platform = detectPlatform(patch.url)
    }
    // Derive vimeo_id from url if url changed and it's a vimeo URL
    if ('url' in patch && !('vimeo_id' in patch) && patch.platform === 'vimeo') {
      patch.vimeo_id = extractVimeoId(patch.url)
    }
    // Auto-fill series_slug if series_id changed
    if ('series_id' in patch && !('series_slug' in patch)) {
      if (patch.series_id) {
        const { data: s } = await sb.from('resource_series').select('slug').eq('id', patch.series_id).maybeSingle()
        patch.series_slug = s?.slug ?? null
      } else {
        patch.series_slug = null
      }
    }
    // Coerce sort_order — omit rather than null so DB default (0) applies
    if ('sort_order' in patch) {
      if (patch.sort_order != null && patch.sort_order !== '') {
        patch.sort_order = Number(patch.sort_order)
      } else {
        delete patch.sort_order
      }
    }
    // Drop content_type if empty string to avoid check constraint
    if ('content_type' in patch && !patch.content_type) {
      delete patch.content_type
    }

    patch.updated_at = new Date().toISOString()

    const { data, error } = await sb.from('resources').update(patch).eq('id', id).select().single()
    if (error) { res.status(500).json({ error: error.message }); return }
    return res.json({ resource: data })
  }

  // ── DELETE /api/resources?id=X ────────────────────────────────────────────
  if (req.method === 'DELETE' && id) {
    const { error } = await sb.from('resources').delete().eq('id', id)
    if (error) { res.status(500).json({ error: error.message }); return }
    return res.json({ ok: true })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
