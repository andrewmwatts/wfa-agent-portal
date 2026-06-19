import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import { requireSuperAdmin } from './_auth.js'
import { buildLevelMap } from '../shared/commissionLevel.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

/**
 * Snapshot CRUD API
 *
 *   GET  ?type=cycles                         → list snapshot_cycles DESC
 *   POST ?type=cycles   { month }             → create new cycle
 *   GET  ?type=cycle&id=uuid                  → single cycle + reconciliations + disputes + promotions
 *   PUT  ?type=cycle    { id, step?, completed_at? }
 *
 *   GET  ?type=reconciliations&cycle_id=uuid  → list reconciliations for cycle
 *   PUT  ?type=resolution { id, resolution, resolution_note }
 *
 *   GET  ?type=disputes&cycle_id=uuid         → list disputes for cycle
 *   POST ?type=disputes  { cycle_id, reconciliation_id, sfg_id, policy_id,
 *                           disputed_amount, dispute_type, notes }
 *   PUT  ?type=dispute   { id, included?, notes?, outcome?, outcome_date?, submitted_at? }
 *   DELETE ?type=dispute { id }
 *
 *   GET  ?type=promotions&cycle_id=uuid       → list promotion_actions for cycle
 *   POST ?type=promotions { cycle_id, sfg_id, action_type, month_number?,
 *                            agent_promotions_id?, is_manual?, notes? }
 *   PUT  ?type=promotion  { id, hierarchy_flag_noted?, jotform_submitted_at? }
 *
 *   GET  ?type=context&month=YYYY-MM          → personnel + qualifications + agent_promotions
 */

export default async function handler(req, res) {
  if (!(await requireSuperAdmin(req, res))) return

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  const type   = req.query.type
  const method = req.method

  // ── GET cycles ───────────────────────────────────────────────────────────────
  if (method === 'GET' && type === 'cycles') {
    try {
      const { data, error } = await supabase
        .from('snapshot_cycles')
        .select('id, month, step, snapshot_date_from, snapshot_date_to, created_at, completed_at, created_by')
        .order('month', { ascending: false })
      if (error) throw error
      return res.status(200).json(data ?? [])
    } catch (err) {
      console.error('[snapshot/cycles GET]', err)
      return res.status(500).json({ error: 'Failed to load cycles' })
    }
  }

  // ── POST cycle ───────────────────────────────────────────────────────────────
  if (method === 'POST' && type === 'cycles') {
    const { month, created_by } = req.body ?? {}
    if (!month) return res.status(400).json({ error: 'month is required' })
    try {
      const { data, error } = await supabase
        .from('snapshot_cycles')
        .insert({ month: month.trim(), step: 1, created_by: created_by ?? null })
        .select()
        .single()
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'A cycle for this month already exists' })
        throw error
      }
      return res.status(200).json(data)
    } catch (err) {
      console.error('[snapshot/cycles POST]', err)
      return res.status(500).json({ error: 'Failed to create cycle' })
    }
  }

  // ── GET cycle (full detail) ──────────────────────────────────────────────────
  if (method === 'GET' && type === 'cycle') {
    const { id } = req.query
    if (!id) return res.status(400).json({ error: 'id is required' })
    try {
      const [cycleRes, reconRes, disputeRes, promoRes] = await Promise.all([
        supabase.from('snapshot_cycles').select('*').eq('id', id).single(),
        supabase.from('snapshot_reconciliations').select('*').eq('cycle_id', id).order('delta'),
        supabase.from('snapshot_disputes').select('*').eq('cycle_id', id),
        supabase.from('snapshot_promotion_actions').select('*').eq('cycle_id', id),
      ])
      if (cycleRes.error) throw cycleRes.error

      // Resolve agent names server-side so cards display correctly even when
      // issued_policies is empty (chargeback-only entries, $0-DB agents, etc.)
      const recs = reconRes.data ?? []
      let reconciliations = recs
      if (recs.length > 0) {
        const sfgIds = [...new Set(recs.map(r => r.sfg_id).filter(Boolean))]
        const { data: people } = await supabase
          .from('personnel')
          .select('sfg_id, opt_name, preferred_name')
          .in('sfg_id', sfgIds)
        const nameMap = {}
        for (const p of people ?? []) {
          if (p.sfg_id) {
            nameMap[p.sfg_id.trim().toUpperCase()] =
              p.preferred_name?.trim() || p.opt_name?.trim() || null
          }
        }
        reconciliations = recs.map(r => ({
          ...r,
          agent_name: nameMap[r.sfg_id?.trim().toUpperCase()] || r.sfg_id,
        }))
      }

      return res.status(200).json({
        cycle:           cycleRes.data,
        reconciliations,
        disputes:        disputeRes.data ?? [],
        promotions:      promoRes.data  ?? [],
      })
    } catch (err) {
      console.error('[snapshot/cycle GET]', err)
      return res.status(500).json({ error: 'Failed to load cycle' })
    }
  }

  // ── PUT cycle ────────────────────────────────────────────────────────────────
  if (method === 'PUT' && type === 'cycle') {
    const { id, step, completed_at } = req.body ?? {}
    if (!id) return res.status(400).json({ error: 'id is required' })
    const patch = {}
    if (step        != null) patch.step         = step
    if (completed_at != null) patch.completed_at = completed_at
    try {
      const { error } = await supabase.from('snapshot_cycles').update(patch).eq('id', id)
      if (error) throw error
      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('[snapshot/cycle PUT]', err)
      return res.status(500).json({ error: 'Failed to update cycle' })
    }
  }

  // ── GET reconciliations ──────────────────────────────────────────────────────
  if (method === 'GET' && type === 'reconciliations') {
    const { cycle_id } = req.query
    if (!cycle_id) return res.status(400).json({ error: 'cycle_id is required' })
    try {
      const { data, error } = await supabase
        .from('snapshot_reconciliations')
        .select('*')
        .eq('cycle_id', cycle_id)
        .order('delta')
      if (error) throw error
      return res.status(200).json(data ?? [])
    } catch (err) {
      console.error('[snapshot/reconciliations GET]', err)
      return res.status(500).json({ error: 'Failed to load reconciliations' })
    }
  }

  // ── PUT resolution ───────────────────────────────────────────────────────────
  if (method === 'PUT' && type === 'resolution') {
    const { id, resolution, resolution_note } = req.body ?? {}
    if (!id || !resolution) return res.status(400).json({ error: 'id and resolution are required' })
    const VALID = new Set(['legitimate', 'disputed', 'no_action'])
    if (!VALID.has(resolution)) return res.status(400).json({ error: 'Invalid resolution value' })
    try {
      const { error } = await supabase
        .from('snapshot_reconciliations')
        .update({ resolution, resolution_note: resolution_note ?? null, resolved_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('[snapshot/resolution PUT]', err)
      return res.status(500).json({ error: 'Failed to set resolution' })
    }
  }

  // ── PUT claude_hypothesis ────────────────────────────────────────────────────
  if (method === 'PUT' && type === 'hypothesis') {
    const { id, claude_hypothesis } = req.body ?? {}
    if (!id) return res.status(400).json({ error: 'id is required' })
    try {
      const { error } = await supabase
        .from('snapshot_reconciliations')
        .update({ claude_hypothesis })
        .eq('id', id)
      if (error) throw error
      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('[snapshot/hypothesis PUT]', err)
      return res.status(500).json({ error: 'Failed to save hypothesis' })
    }
  }

  // ── GET disputes ─────────────────────────────────────────────────────────────
  if (method === 'GET' && type === 'disputes') {
    const { cycle_id } = req.query
    if (!cycle_id) return res.status(400).json({ error: 'cycle_id is required' })
    try {
      const { data, error } = await supabase
        .from('snapshot_disputes')
        .select('*')
        .eq('cycle_id', cycle_id)
      if (error) throw error
      return res.status(200).json(data ?? [])
    } catch (err) {
      console.error('[snapshot/disputes GET]', err)
      return res.status(500).json({ error: 'Failed to load disputes' })
    }
  }

  // ── POST dispute ─────────────────────────────────────────────────────────────
  if (method === 'POST' && type === 'disputes') {
    const { cycle_id, reconciliation_id, sfg_id, policy_id,
            disputed_amount, dispute_type, notes } = req.body ?? {}
    if (!cycle_id || !sfg_id) return res.status(400).json({ error: 'cycle_id and sfg_id are required' })
    try {
      const { data, error } = await supabase
        .from('snapshot_disputes')
        .insert({
          cycle_id,
          reconciliation_id: reconciliation_id ?? null,
          sfg_id,
          policy_id:        policy_id        ?? null,
          disputed_amount:  disputed_amount  ?? null,
          dispute_type:     dispute_type     ?? null,
          notes:            notes            ?? null,
          included:         true,
        })
        .select()
        .single()
      if (error) throw error
      return res.status(200).json(data)
    } catch (err) {
      console.error('[snapshot/disputes POST]', err)
      return res.status(500).json({ error: 'Failed to create dispute' })
    }
  }

  // ── PUT dispute ──────────────────────────────────────────────────────────────
  if (method === 'PUT' && type === 'dispute') {
    const { id, included, notes, outcome, outcome_date, submitted_at } = req.body ?? {}
    if (!id) return res.status(400).json({ error: 'id is required' })
    const patch = {}
    if (included     != null) patch.included     = included
    if (notes        != null) patch.notes        = notes
    if (outcome      != null) patch.outcome      = outcome
    if (outcome_date != null) patch.outcome_date = outcome_date
    if (submitted_at != null) patch.submitted_at = submitted_at
    try {
      const { error } = await supabase.from('snapshot_disputes').update(patch).eq('id', id)
      if (error) throw error
      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('[snapshot/dispute PUT]', err)
      return res.status(500).json({ error: 'Failed to update dispute' })
    }
  }

  // ── DELETE dispute ───────────────────────────────────────────────────────────
  if (method === 'DELETE' && type === 'dispute') {
    const { id } = req.body ?? {}
    if (!id) return res.status(400).json({ error: 'id is required' })
    try {
      const { error } = await supabase.from('snapshot_disputes').delete().eq('id', id)
      if (error) throw error
      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('[snapshot/dispute DELETE]', err)
      return res.status(500).json({ error: 'Failed to delete dispute' })
    }
  }

  // ── GET promotions ───────────────────────────────────────────────────────────
  if (method === 'GET' && type === 'promotions') {
    const { cycle_id } = req.query
    if (!cycle_id) return res.status(400).json({ error: 'cycle_id is required' })
    try {
      const { data, error } = await supabase
        .from('snapshot_promotion_actions')
        .select('*')
        .eq('cycle_id', cycle_id)
      if (error) throw error
      return res.status(200).json(data ?? [])
    } catch (err) {
      console.error('[snapshot/promotions GET]', err)
      return res.status(500).json({ error: 'Failed to load promotions' })
    }
  }

  // ── POST promotion_action ────────────────────────────────────────────────────
  if (method === 'POST' && type === 'promotions') {
    const { cycle_id, sfg_id, action_type, month_number,
            agent_promotions_id, is_manual, notes } = req.body ?? {}
    if (!cycle_id || !sfg_id || !action_type) {
      return res.status(400).json({ error: 'cycle_id, sfg_id, and action_type are required' })
    }
    try {
      const { data, error } = await supabase
        .from('snapshot_promotion_actions')
        .insert({
          cycle_id,
          sfg_id,
          action_type,
          month_number:        month_number        ?? null,
          agent_promotions_id: agent_promotions_id ?? null,
          is_manual:           is_manual           ?? false,
          notes:               notes               ?? null,
        })
        .select()
        .single()
      if (error) throw error
      return res.status(200).json(data)
    } catch (err) {
      console.error('[snapshot/promotions POST]', err)
      return res.status(500).json({ error: 'Failed to log promotion action' })
    }
  }

  // ── PUT promotion_action ─────────────────────────────────────────────────────
  if (method === 'PUT' && type === 'promotion') {
    const { id, hierarchy_flag_noted, jotform_submitted_at, notes } = req.body ?? {}
    if (!id) return res.status(400).json({ error: 'id is required' })
    const patch = {}
    if (hierarchy_flag_noted  != null) patch.hierarchy_flag_noted  = hierarchy_flag_noted
    if (jotform_submitted_at  != null) patch.jotform_submitted_at  = jotform_submitted_at
    if (notes                 != null) patch.notes                 = notes
    try {
      const { error } = await supabase.from('snapshot_promotion_actions').update(patch).eq('id', id)
      if (error) throw error
      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('[snapshot/promotion PUT]', err)
      return res.status(500).json({ error: 'Failed to update promotion action' })
    }
  }

  // ── GET policies — policy search scoped to agent + carrier ──────────────────
  if (method === 'GET' && type === 'policies') {
    const { sfg_id, carrier, q } = req.query
    if (!sfg_id || !carrier) return res.status(400).json({ error: 'sfg_id and carrier are required' })
    const CARRIER_ALIASES = {
      'American General': ['American General', 'Corebridge'],
      'TransAmerica':     ['TransAmerica', 'Transamerica Group'],
      'Banner':           ['Banner', 'LGA'],
    }
    const carrierVariants = CARRIER_ALIASES[carrier] ?? [carrier]
    try {
      let query = supabase
        .from('policies')
        .select('id, policy_number, applicant, carrier, issue_date, issued_apv, status, conservation_status, conservation_date, submit_date')
        .eq('sfg_id', sfg_id)
        .in('carrier', carrierVariants)
      if (q?.trim()) {
        const term = q.trim()
        query = query.or(`policy_number.ilike.%${term}%,applicant.ilike.%${term}%`)
      }
      const { data, error } = await query.order('issue_date', { ascending: false }).limit(20)
      if (error) throw error
      return res.status(200).json(data ?? [])
    } catch (err) {
      console.error('[snapshot/policies GET]', err)
      return res.status(500).json({ error: 'Failed to search policies' })
    }
  }

  // ── GET context (step 3 bootstrap) ──────────────────────────────────────────
  // Returns personnel tree + qualifications + agent_promotions in one round-trip.
  if (method === 'GET' && type === 'context') {
    const { month } = req.query
    try {
      const [personRes, qualRes, promoRes] = await Promise.all([
        supabase.from('personnel').select(
          'sfg_id, opt_name, preferred_name, upline_sfg_id, role, commission_level, ' +
          'hire_date, owner_since'
        ).order('opt_name'),
        supabase.from('qualifications').select('level, regular, slingshot, writers'),
        supabase.from('agent_promotions').select(
          'id, sfg_id, promotion_type, level, month_1, month_2, month_3, ' +
          'slingshot_month, is_slingshot, is_qualified, qualified_date'
        ),
      ])
      if (personRes.error) throw personRes.error

      // Build policies for the month if month is provided (for APV computation)
      let monthPolicies = []
      if (month) {
        const [yr, mo] = month.split('-').map(Number)
        const monthStart = `${month}-01`
        const nextMonth  = mo === 12
          ? `${yr + 1}-01-01`
          : `${yr}-${String(mo + 1).padStart(2, '0')}-01`
        const { data: polData } = await supabase
          .from('policies')
          .select('sfg_id, issued_apv, status, issue_date, submit_date, submit_week')
          .gte('issue_date', monthStart)
          .lt('issue_date', nextMonth)
          .eq('status', 'issued')
        monthPolicies = polData ?? []
      }

      const levelMap = buildLevelMap(promoRes.data ?? [])
      const personnel = (personRes.data ?? []).map(p => {
        const levels = levelMap[p.sfg_id?.toUpperCase()] ?? { contract: null, leadership: null, prestige: [] }
        return { ...p, commission_contract: levels.contract, commission_leadership: levels.leadership, commission_prestige: levels.prestige }
      })

      return res.status(200).json({
        personnel,
        qualifications: qualRes.data ?? [],
        promotions:     promoRes.data ?? [],
        monthPolicies,
      })
    } catch (err) {
      console.error('[snapshot/context GET]', err)
      return res.status(500).json({ error: 'Failed to load context' })
    }
  }

  // ── Agent promotions write (for Step 3 qualifying) ───────────────────────────
  if (method === 'POST' && type === 'agent_promotion') {
    const { sfg_id, promotion_type, level, month_1, month_2, month_3,
            slingshot_month, is_slingshot } = req.body ?? {}
    if (!sfg_id || !promotion_type || !level) {
      return res.status(400).json({ error: 'sfg_id, promotion_type, level are required' })
    }
    try {
      const record = {
        sfg_id: sfg_id.toUpperCase(),
        promotion_type,
        level,
        month_1:        month_1        ?? null,
        month_2:        month_2        ?? null,
        month_3:        month_3        ?? null,
        slingshot_month: slingshot_month ?? null,
        is_slingshot:   is_slingshot   ?? false,
        is_qualified:   false,
        qualified_date: null,
      }
      const { data, error } = await supabase
        .from('agent_promotions')
        .upsert(record, { onConflict: 'sfg_id,promotion_type,level' })
        .select()
        .single()
      if (error) throw error
      return res.status(200).json(data)
    } catch (err) {
      console.error('[snapshot/agent_promotion POST]', err)
      return res.status(500).json({ error: 'Failed to save agent promotion' })
    }
  }

  // ── Delete agent_promotions row (streak reset) ───────────────────────────────
  if (method === 'DELETE' && type === 'agent_promotion') {
    const { id } = req.body ?? {}
    if (!id) return res.status(400).json({ error: 'id is required' })
    try {
      const { error } = await supabase.from('agent_promotions').delete().eq('id', id)
      if (error) throw error
      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('[snapshot/agent_promotion DELETE]', err)
      return res.status(500).json({ error: 'Failed to delete agent promotion' })
    }
  }

  return res.status(405).json({ error: 'Method or type not allowed' })
}
