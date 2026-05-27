import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { sfg_ids, sfg_id, detail } = req.query

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
      const { data: mapRow } = await supabase
        .from('kajabi_email_map')
        .select('kajabi_email')
        .eq('sfg_id', sfg_id)
        .maybeSingle()

      if (!mapRow) {
        return res.status(200).json({ linked: false, lessons: [], totalLessons })
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

      return res.status(200).json({ linked: true, lessons, totalLessons })
    }

    // ── Batch summary mode: completion counts for a list of sfg_ids ───────
    const requestedIds = (sfg_ids ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)

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
      sfgToEmail[m.sfg_id.toLowerCase()] = m.kajabi_email
      emailToSfg[m.kajabi_email.toLowerCase()] = m.sfg_id.toLowerCase()
    }

    const kajabiEmails = Object.values(sfgToEmail)

    // Fetch completions per-agent using individual .eq() queries (parallel) —
    // mirrors the detail path exactly, avoiding .in() encoding issues.
    const completionResults = await Promise.all(
      emailMaps.map(m =>
        supabase
          .from('onboarding_progress')
          .select('lesson_id, completed, completed_at')
          .eq('kajabi_email', m.kajabi_email)
      )
    )

    // Aggregate per sfg_id
    const summaries = {}

    // Seed all linked agents (even those with zero completions)
    for (const sfgId of Object.keys(sfgToEmail)) {
      summaries[sfgId] = { count: 0, latestDate: null }
    }

    for (let i = 0; i < emailMaps.length; i++) {
      const email = emailMaps[i].kajabi_email
      const sfgId = emailToSfg[email.toLowerCase()]
      if (!sfgId || !summaries[sfgId]) continue

      for (const c of completionResults[i].data ?? []) {
        // Mirror the detail path: check completed as a truthy value in JS
        if (!c.completed) continue
        // Skip completions for lessons that are no longer active
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
