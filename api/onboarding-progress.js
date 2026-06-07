import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, authorizeScope } from './_auth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

export default async function handler(req, res) {
  const caller = await requireAuth(req, res)
  if (!caller) return

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // ── PUT — upsert kajabi_email_map ─────────────────────────────────────────
  if (req.method === 'PUT') {
    const { sfg_id, kajabi_email } = req.body ?? {}
    if (!sfg_id || !kajabi_email) {
      return res.status(400).json({ error: 'sfg_id and kajabi_email are required' })
    }
    const { error } = await supabase
      .from('kajabi_email_map')
      .upsert({ sfg_id: sfg_id.toUpperCase(), kajabi_email }, { onConflict: 'sfg_id' })
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { sfg_ids, sfg_id, detail, root: rootParam } = req.query

  try {
    // ── Active lessons (IDs + count) — used by both modes ────────────────
    const { data: activeLessonRows } = await supabase
      .from('lessons')
      .select('id')
      .eq('is_active', true)

    const activeLessonIds = new Set((activeLessonRows ?? []).map(l => l.id))
    const totalLessons    = activeLessonIds.size

    // ── Detail mode: full lesson list for a single agent ──────────────────
    if (sfg_id && detail === 'true') {
      if (!(await authorizeScope(req, res, caller, supabase, [sfg_id.toUpperCase()]))) return
      const { data: mapRow } = await supabase
        .from('kajabi_email_map')
        .select('kajabi_email')
        .eq('sfg_id', sfg_id?.toUpperCase())
        .maybeSingle()

      if (!mapRow) {
        return res.status(200).json({ linked: false, lessons: [], totalLessons, kajabiEmail: null })
      }

      const [{ data: allLessons }, { data: progress }] = await Promise.all([
        supabase
          .from('lessons')
          .select('id, lesson_name, display_order')
          .eq('is_active', true)
          .order('display_order'),
        supabase
          .from('onboarding_progress')
          .select('lesson_id, completed, completed_at')
          .eq('kajabi_email', mapRow.kajabi_email),
      ])

      const progressMap = Object.fromEntries(
        (progress ?? []).map(p => [p.lesson_id, p])
      )

      const lessons = (allLessons ?? []).map(l => ({
        id:           l.id,
        lesson_name:  l.lesson_name,
        display_order: l.display_order,
        completed:    progressMap[l.id]?.completed    ?? false,
        completed_at: progressMap[l.id]?.completed_at ?? null,
      }))

      return res.status(200).json({ linked: true, lessons, totalLessons, kajabiEmail: mapRow.kajabi_email ?? null })
    }

    // ── Batch summary mode: completion counts for a list of sfg_ids ───────

    // Build requestedIds from explicit sfg_ids list OR from root= tree traversal
    let requestedIds = (sfg_ids ?? '')
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean)

    // Authorize requested scope (explicit ids, or the root) before expansion.
    {
      const scopeIds = requestedIds.length ? requestedIds : (rootParam?.trim() ? [rootParam.trim()] : [])
      if (scopeIds.length && !(await authorizeScope(req, res, caller, supabase, scopeIds))) return
    }

    // root= param: do a lightweight personnel tree lookup so the caller can
    // fire this endpoint in parallel with /api/personnel instead of sequentially.
    if (!requestedIds.length && rootParam?.trim()) {
      const { data: treeRows } = await supabase
        .from('personnel')
        .select('sfg_id, upline_sfg_id')
      const childrenOf = {}
      for (const p of treeRows ?? []) {
        const up = p.upline_sfg_id?.trim().toLowerCase()
        if (!up) continue
        ;(childrenOf[up] ??= []).push(p.sfg_id.toLowerCase())
      }
      const teamIds = new Set()
      function traverse(id) {
        teamIds.add(id)
        for (const child of childrenOf[id] ?? []) traverse(child)
      }
      traverse(rootParam.trim().toLowerCase())
      requestedIds = [...teamIds].map(id => id.toUpperCase())
    }

    if (!requestedIds.length) {
      return res.status(200).json({ summaries: {}, totalLessons })
    }

    // Resolve kajabi emails for these agents
    const { data: emailMaps } = await supabase
      .from('kajabi_email_map')
      .select('sfg_id, kajabi_email')
      .in('sfg_id', requestedIds)

    if (!emailMaps?.length) {
      return res.status(200).json({ summaries: {}, totalLessons })
    }

    const sfgToEmail = {}
    const emailToSfg = {}
    for (const m of emailMaps) {
      if (!m.sfg_id || !m.kajabi_email) continue
      sfgToEmail[m.sfg_id.toLowerCase()]      = m.kajabi_email
      emailToSfg[m.kajabi_email.toLowerCase()] = m.sfg_id.toLowerCase()
    }

    const kajabiEmails = Object.values(sfgToEmail)

    // Single bulk query instead of N parallel .eq() queries — major perf win
    const { data: allCompletions } = await supabase
      .from('onboarding_progress')
      .select('kajabi_email, lesson_id, completed, completed_at')
      .in('kajabi_email', kajabiEmails)

    // Group completions by email for O(1) lookup
    const completionsByEmail = {}
    for (const c of allCompletions ?? []) {
      ;(completionsByEmail[c.kajabi_email.toLowerCase()] ??= []).push(c)
    }

    // Aggregate per sfg_id
    const summaries = {}
    for (const sfgId of Object.keys(sfgToEmail)) {
      summaries[sfgId] = { count: 0, latestDate: null }
    }

    for (const [emailLower, completions] of Object.entries(completionsByEmail)) {
      const sfgId = emailToSfg[emailLower]
      if (!sfgId || !summaries[sfgId]) continue
      for (const c of completions) {
        if (!c.completed) continue
        if (!activeLessonIds.has(c.lesson_id)) continue
        summaries[sfgId].count++
        if (!summaries[sfgId].latestDate || c.completed_at > summaries[sfgId].latestDate) {
          summaries[sfgId].latestDate = c.completed_at
        }
      }
    }

    return res.status(200).json({ summaries, totalLessons })
  } catch (err) {
    console.error('[onboarding-progress]', err)
    return res.status(500).json({ error: 'Failed to load onboarding data' })
  }
}
