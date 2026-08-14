/**
 * Promotion qualification — shared logic used by both the Monthly Agent Totals
 * page and Step 3 of the Snapshot (Promotions) workflow, so the two can never
 * drift on how a promotion is qualified.
 *
 * Qualification is evaluated on TEAM issued APV (an agent plus their whole
 * downline), net of chargebacks whose snapshot_chargeback_month falls in the
 * month in question, subject to two limits:
 *   1. 50% leg rule  — no single leg (a direct downline + all of their subs)
 *      may supply more than half the required APV.
 *   2. $7,500 single-policy cap — when promoting to contract level 125 or 130,
 *      each individual policy's issued APV counts at most $7,500.
 *
 * Slingshot levels (85/90/95) additionally require the agent's PERSONAL weekly
 * submissions: at least one application submitted in 4 of 5 (or 3 of 4) Fridays
 * of the business month.
 */

export const SINGLE_APV_CAP = 7500

// Contract levels that capped each single policy at $7,500 under the ORIGINAL rule.
export const CAPPED_PROMO_LEVELS = new Set(['125', '130'])

// Date the "maximum credit per sale is $7,500" rule was extended from 125/130 to
// every promotion level. Policies issued before this keep the original behaviour,
// so historical qualifying totals are unaffected by the change.
export const ALL_LEVEL_CAP_FROM = '2026-08-01'

/**
 * Per-policy qualifying APV cap. Depends on the policy's issue date, not just
 * the level being chased:
 *   issued on/after ALL_LEVEL_CAP_FROM → $7,500 at every level
 *   issued before it                   → $7,500 only when targeting 125/130
 *
 * `nextContractLevel` may be null when no specific level is in play (e.g. a
 * display total for an in-progress streak). That suppresses the level-specific
 * rule only — the universal post-cutoff cap is level-independent and still bites.
 *
 * @param {object} policy             a policy row (reads issue_date)
 * @param {string|null} nextContractLevel
 */
export function policyApvCap(policy, nextContractLevel) {
  const issued = String(policy?.issue_date ?? '').slice(0, 10)
  if (issued && issued >= ALL_LEVEL_CAP_FROM) return SINGLE_APV_CAP
  return CAPPED_PROMO_LEVELS.has(String(nextContractLevel)) ? SINGLE_APV_CAP : Infinity
}

// Sum of issued_apv over policies, each capped per policyApvCap() above.
export function cappedIssuedSum(pols, nextContractLevel = null) {
  return (pols ?? []).reduce(
    (s, p) => s + Math.min(p.issued_apv ?? 0, policyApvCap(p, nextContractLevel)),
    0
  )
}

/**
 * Builds the downline tree from personnel rows.
 * @returns {{
 *   descendantsOf: Record<string, Set<string>>,   // idLower → Set of all descendants incl. self
 *   directChildrenOf: Record<string, string[]>,   // idLower → immediate children (for the leg rule)
 * }}
 */
export function buildDownlineTree(personnel) {
  const childrenOf = {}
  for (const p of personnel) {
    const upId = p.upline_sfg_id?.trim().toLowerCase()
    if (!upId) continue
    ;(childrenOf[upId] ??= []).push(p.sfg_id.toLowerCase())
  }
  const cache = {}
  function get(id) {
    if (cache[id]) return cache[id]
    const set = new Set([id])
    for (const child of (childrenOf[id] ?? [])) for (const d of get(child)) set.add(d)
    cache[id] = set
    return set
  }
  for (const p of personnel) get(p.sfg_id.toLowerCase())
  return { descendantsOf: cache, directChildrenOf: childrenOf }
}

/**
 * Team issued APV for one agent's whole downline (incl. self), each policy
 * capped at `cap`, net of chargebacks.
 *
 * @param descSet            Set of descendant idLowers (incl. self)
 * @param issuedPolsBySfgId  idLower → issued policies [{ issued_apv, issue_date }]
 * @param chargebackAmounts  idLower → chargeback dollar amount for the month
 * @param nextContractLevel  level being chased, or null for no level-specific cap
 */
export function computeTeamIssued(descSet, issuedPolsBySfgId, chargebackAmounts = {}, nextContractLevel = null) {
  let issued = 0
  let cb = 0
  for (const tid of descSet) {
    issued += cappedIssuedSum(issuedPolsBySfgId[tid] ?? [], nextContractLevel)
    cb += chargebackAmounts[tid] ?? 0
  }
  return issued - cb
}

/**
 * Largest single-leg issued APV (each policy capped per policyApvCap()).
 * A leg = one direct child + all of their subordinates.
 */
export function computeMaxLegApv(directChildren, descendantsOf, issuedPolsBySfgId, nextContractLevel = null) {
  return (directChildren ?? []).reduce((best, childId) => {
    const legDesc = descendantsOf[childId] ?? new Set([childId])
    let legApv = 0
    for (const tid of legDesc) legApv += cappedIssuedSum(issuedPolsBySfgId[tid] ?? [], nextContractLevel)
    return Math.max(best, legApv)
  }, 0)
}

/**
 * 50% leg rule. Returns true when the target APV is met on paper but the
 * largest leg exceeds half the target and, once that leg is capped at 50%,
 * the effective total falls short — i.e. qualification is blocked.
 */
export function legRulePreventsQual(teamIssued, targetApv, maxLegApv) {
  if (!targetApv || teamIssued < targetApv) return false   // target not reached anyway
  const legCap = 0.5 * targetApv
  if (maxLegApv <= legCap) return false                    // largest leg within limit
  const effectiveApv = teamIssued - maxLegApv + legCap     // cap the oversized leg
  return effectiveApv < targetApv                          // true → can't qualify
}

// Number of Fridays in a calendar month (drives the weekly-submission requirement).
export function fridayWeekCount(year, month) {
  const d = new Date(year, month, 1)
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1)
  let n = 0
  while (d.getMonth() === month) { n++; d.setDate(d.getDate() + 7) }
  return n
}

// Weekly-submission requirement: 4 of 5 in a 5-Friday month, otherwise 3 of 4.
export function requiredSubmissionWeeks(fridayCount) {
  return fridayCount >= 5 ? 4 : 3
}

// Whether the agent met the personal weekly-submission requirement.
export function submissionRequirementMet(submittedWeekCount, fridayCount) {
  return submittedWeekCount >= requiredSubmissionWeeks(fridayCount)
}

// ── Conditional-formatting statuses (highlighting) ──────────────────────────
// Returns 'green' | 'orange' | 'yellow' | 'none' per column.
//   green  = met, leg rule satisfied
//   orange = met on paper but the leg rule prevents qualification
//   yellow = companion requirement not yet met
//   none   = not met

export function promoStatuses(teamIssued, writers, qual, maxLegApv = 0, submissionMet = false) {
  if (!qual) return { apv: 'none', slingshot: 'none', writers: 'none' }

  const apvHit     = qual.regular   != null && teamIssued >= qual.regular
  const slingHit   = qual.slingshot != null && teamIssued >= qual.slingshot
  const writersHit = qual.writers   != null && writers    >= qual.writers

  const hitColor = (target) =>
    legRulePreventsQual(teamIssued, target, maxLegApv) ? 'orange' : 'green'

  if (qual.writers != null) {
    // APV + Writers are companions (105–130)
    const allMet = apvHit && writersHit
    return {
      apv:       qual.regular != null ? (apvHit     ? (allMet ? hitColor(qual.regular) : 'yellow') : 'none') : 'none',
      slingshot: 'none',
      writers:   qual.writers != null ? (writersHit ? (allMet ? hitColor(qual.regular) : 'yellow') : 'none') : 'none',
    }
  }

  if (qual.slingshot != null) {
    // Slingshot + weekly submissions are companions (85–95); regular APV standalone.
    return {
      apv:       qual.regular != null ? (apvHit   ? hitColor(qual.regular) : 'none') : 'none',
      slingshot: slingHit
                   ? (submissionMet ? hitColor(qual.slingshot) : 'yellow')
                   : 'none',
      writers:   'none',
    }
  }

  // Single-target level (100, TP, EP)
  return {
    apv:       qual.regular != null ? (apvHit ? hitColor(qual.regular) : 'none') : 'none',
    slingshot: 'none',
    writers:   'none',
  }
}

export function leadStatuses(teamIssued, writers, qual, maxLegApv = 0) {
  if (!qual) return { apv: 'none', writers: 'none' }

  const apvHit     = qual.regular != null && teamIssued >= qual.regular
  const writersHit = qual.writers != null && writers    >= qual.writers

  const hitColor = (target) =>
    legRulePreventsQual(teamIssued, target, maxLegApv) ? 'orange' : 'green'

  if (qual.writers != null) {
    // APV + Writers are companions (TL, KL, AO)
    const allMet = apvHit && writersHit
    return {
      apv:     qual.regular != null ? (apvHit     ? (allMet ? hitColor(qual.regular) : 'yellow') : 'none') : 'none',
      writers: qual.writers != null ? (writersHit ? (allMet ? hitColor(qual.regular) : 'yellow') : 'none') : 'none',
    }
  }

  // Single-target leadership level
  return {
    apv:     qual.regular != null ? (apvHit ? hitColor(qual.regular) : 'none') : 'none',
    writers: 'none',
  }
}
