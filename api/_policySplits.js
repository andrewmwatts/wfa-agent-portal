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

import { attachSplits } from '../shared/policySplit.js'

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
