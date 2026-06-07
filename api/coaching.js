import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, authorizeScope } from './_auth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

/**
 * Coaching API — aggregates all data for the coaching page in one response.
 * Period filtering is done client-side so the page can re-filter without refetching.
 *
 * GET /api/coaching?sfg_id=X
 *
 * Returns:
 *   agent            — identity, tenure, commission level
 *   policies         — all policies (client filters by period)
 *   leads            — all leads (client filters by period)
 *   activity         — last 14 weeks of activity logs
 *   promotions       — full promotion history
 *   contracts        — best contract number per carrier
 *   carriers         — all core carriers with alert thresholds
 *   downline         — direct reports with commission level
 *   downlinePolicies — issued/submitted data for direct reports
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const caller = await requireAuth(req, res)
  if (!caller) return

  const sfgId = req.query.sfg_id?.trim().toUpperCase()
  if (!sfgId) return res.status(400).json({ error: 'sfg_id required' })

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  if (!(await authorizeScope(req, res, caller, supabase, [sfgId]))) return

  try {
    // ── Step 1: Agent row (needed to resolve upline_sfg_id) ─────────────────
    const { data: agentRow, error: agentErr } = await supabase
      .from('personnel')
      .select('sfg_id, preferred_name, opt_name, hire_date, status, upline_sfg_id, contracting_to_producer, no_eando')
      .eq('sfg_id', sfgId)
      .maybeSingle()

    if (agentErr) throw agentErr
    if (!agentRow) return res.status(404).json({ error: 'Agent not found' })

    const uplineSfgId = agentRow.upline_sfg_id?.trim().toUpperCase() || null

    // Activity cutoff: 14 weeks back (enough for 12-week chart + period filtering)
    const activityCutoff = new Date()
    activityCutoff.setDate(activityCutoff.getDate() - 98)
    const activityStart = activityCutoff.toISOString().slice(0, 10)

    // ── Step 2: All other queries in parallel ────────────────────────────────
    const [
      uplineRes,
      promotionsRes,
      policiesRes,
      crosswalkRes,
      leadsRes,
      activityRes,
      contractsRes,
      carriersRes,
      downlineRes,
    ] = await Promise.all([
      // Upline name
      uplineSfgId
        ? supabase.from('personnel').select('preferred_name, opt_name').eq('sfg_id', uplineSfgId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),

      // Full promotion history
      supabase
        .from('agent_promotions')
        .select('promotion_type, level, qualified_date, month_1, month_2, month_3, slingshot_month, is_slingshot, is_qualified')
        .eq('sfg_id', sfgId)
        .order('qualified_date', { ascending: true }),

      // All policies for this agent — no subtype column; enriched below via crosswalk
      supabase
        .from('policies')
        .select('id, applicant, carrier, policy_name, status, submit_date, issue_date, last_update, submitted_apv, issued_apv, application_notes')
        .eq('sfg_id', sfgId)
        .order('submit_date', { ascending: false }),

      // Policy crosswalk: carrier + policy_name → subtype
      supabase
        .from('policy_crosswalk')
        .select('carrier, policy_name, subtype'),

      // All leads for this agent
      supabase
        .from('leads')
        .select('id, name, added, source, status, category')
        .eq('sfg_id', sfgId)
        .order('added', { ascending: false }),

      // Activity logs — last 14 weeks
      supabase
        .from('activity_logs')
        .select('log_date, dials, contacts, appts_set, appts_kept, apps_written')
        .eq('sfg_id', sfgId)
        .gte('log_date', activityStart)
        .order('log_date', { ascending: true }),

      // Contract numbers (best per carrier)
      supabase
        .from('contract_numbers')
        .select('carrier, contract_number, effective_date')
        .eq('sfg_id', sfgId)
        .order('carrier')
        .order('contract_number', { ascending: false }),

      // All core carriers
      supabase
        .from('carriers')
        .select('name, alert_threshold_days')
        .order('name'),

      // Direct downline (one level only)
      supabase
        .from('personnel')
        .select('sfg_id, preferred_name, opt_name, hire_date, status')
        .eq('upline_sfg_id', sfgId)
        .order('hire_date', { ascending: false }),
    ])

    // Surface any DB errors
    for (const [label, result] of [
      ['promotions', promotionsRes], ['policies', policiesRes], ['crosswalk', crosswalkRes],
      ['leads', leadsRes], ['activity', activityRes], ['contracts', contractsRes],
      ['carriers', carriersRes], ['downline', downlineRes],
    ]) {
      if (result.error) throw new Error(`[${label}] ${result.error.message}`)
    }

    // Build crosswalk lookup: "carrier‖policy_name" → subtype
    const cwMap = {}
    for (const row of crosswalkRes.data ?? []) {
      const key = `${(row.carrier ?? '').trim().toLowerCase()}‖${(row.policy_name ?? '').trim().toLowerCase()}`
      cwMap[key] = row.subtype?.trim() || null
    }

    // Enrich policies with subtype
    const policies = (policiesRes.data ?? []).map(p => ({
      ...p,
      subtype: cwMap[`${(p.carrier ?? '').trim().toLowerCase()}‖${(p.policy_name ?? '').trim().toLowerCase()}`] ?? null,
    }))

    // ── Build agent object ──────────────────────────────────────────────────
    const uplineRow  = uplineRes.data
    const uplineName = uplineRow ? (uplineRow.preferred_name?.trim() || uplineRow.opt_name?.trim() || '') : ''

    // Current commission level = highest level with at least month_1 filled
    const commissionPromos = (promotionsRes.data ?? []).filter(p => p.promotion_type === 'commission')
    let commissionLevel = null
    for (const p of commissionPromos) {
      const lvl = Number(p.level)
      if (!isNaN(lvl) && p.month_1) commissionLevel = Math.max(commissionLevel ?? 0, lvl)
    }

    const agent = {
      sfg_id:                  agentRow.sfg_id,
      name:                    agentRow.preferred_name?.trim() || agentRow.opt_name?.trim() || '',
      hire_date:               agentRow.hire_date ?? '',
      status:                  agentRow.status    ?? 'Active',
      upline_sfg_id:           uplineSfgId,
      upline_name:             uplineName,
      commission_level:        commissionLevel,
      contracting_to_producer: agentRow.contracting_to_producer ?? null,
      no_eando:                agentRow.no_eando ?? false,
    }

    // ── Deduplicate contracts (highest number per carrier) ──────────────────
    const contractsByCarrier = {}
    for (const row of contractsRes.data ?? []) {
      if (!contractsByCarrier[row.carrier]) contractsByCarrier[row.carrier] = row
    }

    // ── Downline production + commission levels (if downline exists) ─────────
    const downlineAgents = downlineRes.data ?? []
    let downlinePolicies   = []
    let downlinePromotions = []

    if (downlineAgents.length) {
      const dlSfgIds = downlineAgents.map(a => a.sfg_id)
      const [dlPolRes, dlPromoRes] = await Promise.all([
        supabase
          .from('policies')
          .select('sfg_id, issued_apv, submitted_apv, submit_date, issue_date, status')
          .in('sfg_id', dlSfgIds),
        supabase
          .from('agent_promotions')
          .select('sfg_id, level, promotion_type, month_1')
          .in('sfg_id', dlSfgIds)
          .eq('promotion_type', 'commission'),
      ])
      if (dlPolRes.error)   throw dlPolRes.error
      downlinePolicies   = dlPolRes.data   ?? []
      downlinePromotions = dlPromoRes.data ?? []
    }

    // Map sfg_id → highest commission level in downline
    const dlLevelMap = {}
    for (const p of downlinePromotions) {
      if (p.month_1) {
        const lvl = Number(p.level)
        if (!isNaN(lvl)) dlLevelMap[p.sfg_id] = Math.max(dlLevelMap[p.sfg_id] ?? 0, lvl)
      }
    }

    res.setHeader('Cache-Control', 'private, no-store')
    return res.status(200).json({
      agent,
      policies,
      leads:            leadsRes.data      ?? [],
      activity:         activityRes.data   ?? [],
      promotions:       promotionsRes.data ?? [],
      contracts:        contractsByCarrier,
      carriers:         carriersRes.data   ?? [],
      downline:         downlineAgents.map(a => ({
        sfg_id:           a.sfg_id,
        name:             a.preferred_name?.trim() || a.opt_name?.trim() || '',
        hire_date:        a.hire_date ?? '',
        status:           a.status   ?? 'Active',
        commission_level: dlLevelMap[a.sfg_id] ?? null,
      })),
      downlinePolicies,
    })
  } catch (err) {
    console.error('[coaching]', err)
    return res.status(500).json({ error: err.message ?? 'Failed to load coaching data' })
  }
}
