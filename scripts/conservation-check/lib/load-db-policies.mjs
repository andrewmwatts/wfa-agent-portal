// Read-only loader: one carrier group's policies from Supabase, annotated with the
// Snapshot rule inputs (FRAMEWORK.md §3). Prints compact JSON to stdout.
//
//   node scripts/conservation-check/lib/load-db-policies.mjs Americo
//   node scripts/conservation-check/lib/load-db-policies.mjs Banner LGA
//
// Must run from the repo root (dotenv paths).
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { getBaseshopIds, ownerIdsFromPromotions } from '../../../shared/agencyScope.js'

config({ path: '.vercel/.env.development.local', quiet: true })
config({ path: '.env.local', quiet: true })
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const FIRST_CYCLE_MONTH = '2026-05' // earlier issue months count as on Snapshot

async function all(table, cols, f = q => q) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await f(sb.from(table).select(cols)).range(from, from + 999)
    if (error) throw error
    out.push(...data)
    if (data.length < 1000) return out
  }
}

export async function loadCarrierPolicies(carriers) {
  const [policies, splits, cycles, people, promos] = await Promise.all([
    all('policies', 'id, sfg_id, policy_number, carrier, status, issue_date, conservation_status, conservation_date, chargeback_exempt', q => q.in('carrier', carriers)),
    all('policy_splits', 'policy_id, sfg_id, credit_pct'),
    all('snapshot_cycles', 'month, completed_at, snapshot_cycle_scopes(owner_sfg_id)'),
    all('personnel', 'sfg_id, opt_name, preferred_name, upline_sfg_id, status'),
    all('agent_promotions', 'sfg_id, promotion_type, level, month_1, month_2, month_3, slingshot_month, is_slingshot'),
  ])
  const ownerIds = ownerIdsFromPromotions(promos)

  // month → null (unscoped, covers everyone) | Set of in-scope agent ids; absent = not closed
  const closed = new Map()
  for (const c of cycles) {
    if (!c.completed_at) continue
    const owners = (c.snapshot_cycle_scopes ?? []).map(s => s.owner_sfg_id).filter(Boolean)
    if (!owners.length) { closed.set(c.month, null); continue }
    const ids = closed.get(c.month) ?? new Set()
    for (const o of owners) for (const id of getBaseshopIds(o, people, ownerIds)) ids.add(id.toUpperCase())
    closed.set(c.month, ids)
  }

  const splitsBy = new Map()
  for (const s of splits) (splitsBy.get(s.policy_id) ?? splitsBy.set(s.policy_id, []).get(s.policy_id)).push(s)

  const onSnapshot = p => {
    const m = p.issue_date?.slice(0, 7)
    if (!m) return null
    if (m < FIRST_CYCLE_MONTH) return true
    if (!closed.has(m)) return false
    const scope = closed.get(m)
    if (scope === null) return true
    const agents = [p.sfg_id, ...(splitsBy.get(p.id) ?? []).map(s => s.sfg_id)]
    return agents.some(id => scope.has(String(id ?? '').trim().toUpperCase()))
  }

  return policies.map(p => ({
    id: p.id, n: p.policy_number, c: p.carrier, st: p.status, iss: p.issue_date,
    cs: p.conservation_status, cd: p.conservation_date, cbx: p.chargeback_exempt,
    snap: onSnapshot(p), split: (splitsBy.get(p.id) ?? []).length,
  }))
}

if (process.argv[1]?.endsWith('load-db-policies.mjs')) {
  const carriers = process.argv.slice(2)
  if (!carriers.length) { console.error('usage: load-db-policies.mjs <carrier> [...]'); process.exit(1) }
  console.log(JSON.stringify(await loadCarrierPolicies(carriers)))
}
