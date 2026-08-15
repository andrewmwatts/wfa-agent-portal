/**
 * Server-side loading of policy_splits.
 *
 * A policy filtered by `sfg_id` only matches its PRIMARY agent, so a plain
 * `.in('sfg_id', ...)` misses any policy where a requested agent holds only a
 * secondary share. These helpers close that gap and attach the split rows so
 * callers can pro-rate with shared/policySplit.js.
 *
 * policy_splits holds rows only for policies that are actually split — a rare
 * case — so the whole table is loaded in one query and filtered in memory.
 * That avoids chunking a few thousand UUIDs through PostgREST `.in()` lists
 * (which blows past URL length limits) on every policy fetch.
 */

import { attachSplits, creditedAmount, participants, isPrimary } from '../shared/policySplit.js'

const APV_FIELDS = ['submitted_apv', 'issued_apv', 'snapshot_chargeback_apv']

/**
 * Rewrites each policy's APV columns to one agent's credited share, so callers
 * that simply sum those columns need no split awareness. Only fields actually
 * present on the row are touched, and unsplit policies pass through untouched.
 *
 * Single-agent views only — a team rollup must dedupe and cap per sale instead
 * (see computeTeamIssued).
 */
export function toCreditedRows(policies, sfgId) {
  return (policies ?? []).map(p => {
    if (!p.splits?.length) return p
    const out = { ...p }
    for (const f of APV_FIELDS) {
      if (f in p) out[f] = creditedAmount(p, sfgId, f)
    }
    return out
  })
}

/**
 * One row per (policy, credited agent), with sfg_id set to that agent and the
 * APV columns rewritten to their share. `is_primary` marks the writing agent,
 * because application COUNTS belong to the primary while APV pro-rates — a
 * caller tallying rows must skip non-primary ones.
 *
 * Use for per-agent rollups over a group; totals stay whole because the shares
 * of one policy sum back to 100%.
 */
export function explodeCreditedRows(policies, sfgIds) {
  const want = new Set((sfgIds ?? []).map(id => String(id).trim().toUpperCase()).filter(Boolean))
  const out = []
  for (const p of policies ?? []) {
    for (const agentId of participants(p)) {
      if (want.size && !want.has(agentId)) continue
      const row = { ...p, sfg_id: agentId, is_primary: isPrimary(p, agentId) }
      for (const f of APV_FIELDS) if (f in p) row[f] = creditedAmount(p, agentId, f)
      out.push(row)
    }
  }
  return out
}

/**
 * Every policy on which any of `sfgIds` holds credit — as primary OR as a split
 * partner — with `splits` attached. `columns` must include id and sfg_id.
 */
export async function fetchPoliciesForAgents(supabase, sfgIds, columns, applyFilter = null) {
  const ids = (sfgIds ?? []).map(id => String(id).trim().toUpperCase()).filter(Boolean)
  let q = supabase.from('policies').select(columns)
  if (ids.length) q = q.in('sfg_id', ids)
  if (applyFilter) q = applyFilter(q)
  const { data, error } = await q
  if (error) throw error
  return expandAndAttachSplits(supabase, data ?? [], ids, columns, applyFilter)
}

/** Every policy_splits row. Small table — one query, filtered in memory. */
export async function loadAllSplits(supabase) {
  const PAGE = 10000
  const rows = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('policy_splits')
      .select('policy_id, sfg_id, credit_pct')
      .order('policy_id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return rows
}

/** Policy ids on which any of these agents holds a share (primary or secondary). */
export function splitPolicyIdsFor(allSplits, sfgIds) {
  const want = new Set((sfgIds ?? []).map(id => String(id).trim().toUpperCase()))
  const out = new Set()
  for (const s of allSplits ?? []) {
    if (want.has(String(s.sfg_id ?? '').trim().toUpperCase())) out.add(s.policy_id)
  }
  return out
}

/**
 * Fetches policies whose id is in `ids` — used to pull in rows where a requested
 * agent is only a secondary. Chunked well below PostgREST's URL length limit.
 */
export async function fetchPoliciesByIds(supabase, ids, columns, applyFilter = null) {
  const list = [...(ids ?? [])]
  if (!list.length) return []
  const CHUNK = 100
  const out = []
  for (let i = 0; i < list.length; i += CHUNK) {
    let q = supabase.from('policies').select(columns).in('id', list.slice(i, i + CHUNK))
    if (applyFilter) q = applyFilter(q)
    const { data, error } = await q
    if (error) throw error
    out.push(...(data ?? []))
  }
  return out
}

/**
 * Expands a policy result set to include policies the requested agents share as
 * a secondary, then attaches each policy's `splits` array.
 *
 * @param supabase
 * @param rows        policies already fetched by sfg_id
 * @param sfgIds      the requested scope (null/empty = unscoped, nothing to add)
 * @param columns     select list to use for the top-up fetch
 * @param applyFilter same caller-specific WHERE clause used for the main fetch
 */
export async function expandAndAttachSplits(supabase, rows, sfgIds, columns, applyFilter = null) {
  const allSplits = await loadAllSplits(supabase)
  if (!allSplits.length) return rows   // nothing split anywhere — fast path

  let result = rows
  if (sfgIds?.length) {
    const seen  = new Set(rows.map(p => p.id))
    const extra = [...splitPolicyIdsFor(allSplits, sfgIds)].filter(id => !seen.has(id))
    if (extra.length) {
      result = [...rows, ...(await fetchPoliciesByIds(supabase, extra, columns, applyFilter))]
    }
  }
  return attachSplits(result, allSplits)
}
