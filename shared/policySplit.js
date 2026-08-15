/**
 * Split-credit policies — shared between the API and the frontend.
 *
 * A split policy is ONE row in `policies` (owned by the primary / writing agent
 * via policies.sfg_id) plus rows in `policy_splits` giving each participant a
 * credit_pct. Rows are exhaustive when present: the primary has a row too, and
 * the percentages across one policy sum to 1.0. An unsplit policy has no split
 * rows at all and credits 100% to the primary.
 *
 * Callers receive splits attached to each policy as `policy.splits`:
 *     [{ sfg_id, credit_pct }, ...]
 *
 * Business rules encoded here (confirmed with the agency owner):
 *
 *   APV            — pro-rated by credit_pct for every participant. Because the
 *                    shares sum to 1.0, a team containing both participants
 *                    rolls up to exactly 100% of the policy, never double.
 *   App counts     — go to the PRIMARY ONLY, in full. A secondary agent's split
 *                    contributes nothing to personal or team application counts.
 *   Weekly check   — the slingshot weekly-submission requirement is the sole
 *                    exception: a split app is worth a flat 0.5 to a SECONDARY
 *                    agent (regardless of the split ratio), so two split apps in
 *                    one business week satisfy that week. The primary still gets
 *                    a full 1.0.
 */

// SFG IDs are stored inconsistently cased across tables — always compare normalized.
function normId(id) {
  return String(id ?? '').trim().toUpperCase()
}

/** Whether this policy has shared credit recorded against it. */
export function isSplit(policy) {
  return (policy?.splits?.length ?? 0) > 0
}

/** Whether sfgId is the primary (writing) agent on this policy. */
export function isPrimary(policy, sfgId) {
  return !!policy?.sfg_id && normId(policy.sfg_id) === normId(sfgId)
}

/**
 * This agent's share of the policy, 0–1.
 * Unsplit → 1 for the primary, 0 for anyone else.
 * Split   → the agent's credit_pct, or 0 if they aren't a participant.
 */
export function creditPct(policy, sfgId) {
  if (!isSplit(policy)) return isPrimary(policy, sfgId) ? 1 : 0
  const want = normId(sfgId)
  const row  = policy.splits.find(s => normId(s.sfg_id) === want)
  return row ? (Number(row.credit_pct) || 0) : 0
}

/** Combined share of the policy held by a set/array of agent ids, 0–1. */
export function teamCreditPct(policy, sfgIds) {
  const want = new Set([...(sfgIds ?? [])].map(normId))
  if (!isSplit(policy)) return want.has(normId(policy?.sfg_id)) ? 1 : 0
  let pct = 0
  for (const s of policy.splits) if (want.has(normId(s.sfg_id))) pct += Number(s.credit_pct) || 0
  return pct
}

/** Every agent with any credit on this policy (primary included). */
export function participants(policy) {
  if (!isSplit(policy)) return policy?.sfg_id ? [normId(policy.sfg_id)] : []
  return policy.splits.map(s => normId(s.sfg_id))
}

function amountOf(policy, field) {
  const v = policy?.[field]
  if (v == null || v === '') return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,]/g, ''))
  return isNaN(n) ? 0 : n
}

/** One agent's pro-rated share of an APV field ('issued_apv', 'submitted_apv', …). */
export function creditedAmount(policy, sfgId, field = 'issued_apv') {
  return amountOf(policy, field) * creditPct(policy, sfgId)
}

/** A team's combined pro-rated share of an APV field, BEFORE any per-sale cap. */
export function teamCreditedAmount(policy, sfgIds, field = 'issued_apv') {
  return amountOf(policy, field) * teamCreditPct(policy, sfgIds)
}

/**
 * Application-count credit. Counts go to the primary in full; a split gives the
 * secondary nothing. Used for personal and team app counts everywhere except the
 * slingshot weekly check below.
 */
export function appCountCredit(policy, sfgId) {
  return isPrimary(policy, sfgId) ? 1 : 0
}

/**
 * Slingshot weekly-submission credit — the one place a secondary agent gets
 * count credit. Flat 0.5 for a secondary on a split app whatever the ratio, so
 * two split apps in a business week satisfy that week; 1.0 for the primary.
 */
export function submissionCredit(policy, sfgId) {
  if (isPrimary(policy, sfgId)) return 1
  return creditPct(policy, sfgId) > 0 ? 0.5 : 0
}

/** A week counts toward the slingshot requirement at a full submission or more. */
export const WEEK_SUBMISSION_THRESHOLD = 1

// ── Editing / validation ─────────────────────────────────────────────────────

/** Percentages are stored 0–1 but entered as whole percents in the UI. */
export const PCT_TOLERANCE = 0.0001

/**
 * Validates a proposed set of split rows before saving.
 * @param {Array} rows          [{ sfg_id, credit_pct }] — credit_pct as 0–1
 * @param {string} primarySfgId policies.sfg_id for the policy being split
 * @returns {string|null} error message, or null when valid
 */
export function validateSplits(rows, primarySfgId) {
  const list = rows ?? []
  if (list.length === 0) return null   // no split — valid (credits 100% to primary)
  if (list.length < 2) return 'A split needs at least two agents.'

  const seen = new Set()
  for (const r of list) {
    const id = normId(r.sfg_id)
    if (!id) return 'Every split row needs an agent.'
    if (seen.has(id)) return 'The same agent appears more than once in the split.'
    seen.add(id)
    const pct = Number(r.credit_pct)
    if (!(pct > 0)) return 'Each agent must have a share greater than 0%.'
    if (pct > 1)    return 'A single agent cannot have more than 100%.'
  }

  if (!seen.has(normId(primarySfgId))) {
    return "The policy's own agent must be included in the split."
  }

  const total = list.reduce((s, r) => s + (Number(r.credit_pct) || 0), 0)
  if (Math.abs(total - 1) > PCT_TOLERANCE) {
    return `Split shares must add up to 100% (currently ${(total * 100).toFixed(1)}%).`
  }
  return null
}

/** Attaches `splits` arrays to policies from a flat policy_splits result set. */
export function attachSplits(policies, splitRows) {
  const byPolicy = {}
  for (const s of splitRows ?? []) {
    if (!s.policy_id) continue
    ;(byPolicy[s.policy_id] ??= []).push({ sfg_id: s.sfg_id, credit_pct: Number(s.credit_pct) || 0 })
  }
  return (policies ?? []).map(p => {
    const splits = byPolicy[p.id]
    return splits ? { ...p, splits } : p
  })
}
