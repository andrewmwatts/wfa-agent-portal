import { useEffect, useMemo, useState } from 'react'
import { useViewing } from '../context/ViewingContext'
import { useTheme } from '../context/ThemeContext'
import ScopeDropdown from '../components/ScopeDropdown'
import { isOwnerRecord, getBaseshopIds } from '../utils/agencyScope'
import { fmtCurrency as fmtAmt } from '../utils/format'

import { nextContractLevel, nextLeadershipLevel } from '../../shared/commissionLevel'

// ─── Conditional-formatting logic ─────────────────────────────────────────────
// Returns 'green' | 'yellow' | 'none'
// green  = this target is met AND all other defined targets for this qual are also met
// yellow = this target is met BUT at least one companion target is not met

// ─── 50 % leg rule ────────────────────────────────────────────────────────────
// No single leg may contribute more than 50 % of the required APV for a level.
// A "leg" is one direct downline agent plus all of their subordinates.
// If the largest leg exceeds the cap, we recompute the effective qualifying APV;
// if that effective APV falls below the target we flag the cell as 'orange'.
//
// orange = raw APV target is met but the leg rule prevents actual qualification
// green  = target met AND leg rule satisfied
// yellow = companion requirement (writers / slingshot) not yet met

function legRulePreventsQual(teamIssued, targetApv, maxLegApv) {
  if (!targetApv || teamIssued < targetApv) return false   // target not reached anyway
  const legCap = 0.5 * targetApv
  if (maxLegApv <= legCap) return false                    // largest leg is within limit
  const effectiveApv = teamIssued - maxLegApv + legCap     // cap the oversized leg
  return effectiveApv < targetApv                          // true → can't qualify
}

// ─── Conditional-formatting logic ─────────────────────────────────────────────
// Levels with Slingshot (85, 90, 95):
//   Regular APV  → GREEN (or ORANGE if leg rule) independently when met
//   Slingshot    → GREEN/ORANGE if met; YELLOW if regular met but slingshot not yet
//
// Levels with Writers as companion (105-130, TL, KL, AO):
//   APV + Writers are companions — YELLOW if one met, GREEN/ORANGE only if both met
//
// Single-target levels (100, TP, EP):
//   Regular APV  → GREEN/ORANGE when met; no companions

function promoStatuses(teamIssued, writers, qual, maxLegApv = 0, submissionMet = false) {
  if (!qual) return { apv: 'none', slingshot: 'none', writers: 'none' }

  const apvHit     = qual.regular   != null && teamIssued >= qual.regular
  const slingHit   = qual.slingshot != null && teamIssued >= qual.slingshot
  const writersHit = qual.writers   != null && writers    >= qual.writers

  // Returns 'green' or 'orange' depending on whether the leg rule blocks qualification
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
    // Slingshot + weekly submissions are companions (85–95).
    // Regular APV is a standalone indicator (no companion).
    // slingHit && submissionMet → green / orange (leg rule)
    // slingHit && !submissionMet → yellow (APV reached but weeks not done)
    // !slingHit && apvHit → yellow (regular met, progress toward slingshot)
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

function leadStatuses(teamIssued, writers, qual, maxLegApv = 0) {
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

// ─── Formatting helpers ───────────────────────────────────────────────────────

function toYearMonth(str) {
  if (!str) return null
  // Parse ISO dates (YYYY-MM-DD) directly to avoid UTC→local timezone shift
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return { year: parseInt(iso[1]), month: parseInt(iso[2]) - 1 }
  const d = new Date(str)
  if (isNaN(d)) return null
  return { year: d.getFullYear(), month: d.getMonth() }
}

function shortWeekDate(str) {
  if (!str) return null
  // Parse ISO dates directly to avoid UTC→local timezone shift
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${parseInt(iso[2])}/${parseInt(iso[3])}`
  const d = new Date(str)
  if (isNaN(d)) return null
  return `${d.getMonth() + 1}/${d.getDate()}`
}

// Parses "Snapshot Chargeback Month" values — handles "Jan 2026", "January 2026",
// "1/2026", "2026-01", or any string new Date() can handle.
function parseCbMonth(str) {
  if (!str?.trim()) return null
  const s = str.trim()
  // ISO date (YYYY-MM-DD) — parse directly to avoid UTC→local timezone shift
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return { year: parseInt(iso[1]), month: parseInt(iso[2]) - 1 }
  // Direct Date parse (non-ISO formats)
  const d = new Date(s)
  if (!isNaN(d)) return { year: d.getFullYear(), month: d.getMonth() }
  // "Month YYYY" — "January 2026" or "Jan 2026"
  const mY = s.match(/^([A-Za-z]+)\s+(\d{4})$/)
  if (mY) {
    const d2 = new Date(`${mY[1]} 1, ${mY[2]}`)
    if (!isNaN(d2)) return { year: d2.getFullYear(), month: d2.getMonth() }
  }
  // "M/YYYY" or "MM/YYYY"
  const mSlash = s.match(/^(\d{1,2})\/(\d{4})$/)
  if (mSlash) return { year: parseInt(mSlash[2]), month: parseInt(mSlash[1]) - 1 }
  return null
}

function parseCbApv(str) {
  if (str == null || str === '') return 0
  if (typeof str === 'number') return str
  const n = parseFloat(str.replace(/[$,]/g, ''))
  return isNaN(n) ? 0 : n
}

function hlCls(status) {
  if (status === 'green')  return 'bg-green-500/15 text-green-700 dark:text-green-400 font-semibold rounded'
  if (status === 'yellow') return 'bg-amber-400/15 text-amber-700 dark:text-amber-300 font-semibold rounded'
  if (status === 'orange') return 'bg-orange-500/15 text-orange-700 dark:text-orange-400 font-semibold rounded'
  return 'text-gray-400 dark:text-white/35'
}

// ─── APV roll-up helpers ──────────────────────────────────────────────────────

function sumIssued(pols) {
  return pols
    .filter(p => p.status?.toLowerCase() === 'issued')
    .reduce((s, p) => s + (p.issued_apv ?? 0), 0)
}

function sumPending(pols) {
  return pols
    .filter(p => { const st = p.status?.toLowerCase() ?? ''; return st === 'pending' || st === '' })
    .reduce((s, p) => s + (p.subm_apv ?? 0), 0)
}

function sumIncomplete(pols) {
  return pols
    .filter(p => p.status?.toLowerCase() === 'incomplete')
    .reduce((s, p) => s + (p.subm_apv ?? 0), 0)
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// ─── Friday-based week columns ────────────────────────────────────────────────
// Always generate one column per Friday in the month so a 5-week month shows
// all 5 columns even when no data has been written for the last week yet.

function getFridayColumns(year, month) {
  const cols = []
  const d = new Date(year, month, 1)
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1)
  let n = 1
  while (d.getMonth() === month) {
    cols.push({ numStr: String(n), fridayLabel: `${d.getMonth() + 1}/${d.getDate()}` })
    n++
    d.setDate(d.getDate() + 7)
  }
  return cols
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MonthlyAgentTotalsPage() {
  const { activeSubject, permissions } = useViewing()
  const { theme }         = useTheme()

  const now = new Date()
  const [selectedYear,  setSelectedYear]  = useState(now.getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth())

  // Pending/incomplete only shown when the selected month is the exact current month
  const isCurrentMonth = selectedYear === now.getFullYear() && selectedMonth === now.getMonth()
  // Past month = strictly before the current month/year (not current, not future)
  const isPastMonth = selectedYear < now.getFullYear() ||
    (selectedYear === now.getFullYear() && selectedMonth < now.getMonth())

  const [masterPersonnel,  setMasterPersonnel]  = useState([])
  const [displayPersonnel, setDisplayPersonnel] = useState([])
  const [policies,         setPolicies]         = useState([])
  const isDirector = ['director', 'super_admin'].includes(activeSubject?.role)
  const [qualMap,          setQualMap]          = useState({}) // levelKey → { regular, slingshot, writers }
  const [loading,          setLoading]          = useState(true)
  const [selectedScope,    setSelectedScope]    = useState('master')
  const [modal,            setModal]            = useState(null)
  const [includeLikelyCb,  setIncludeLikelyCb]  = useState(false)

  const optionStyle = theme === 'dark' ? { background: '#003539', color: '#fff' } : {}

  // ── Load ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeSubject?.sfg_id) return
    setLoading(true)
    load(activeSubject.sfg_id)
  }, [activeSubject?.sfg_id])

  async function load(sfgId) {
    try {
      // Fire personnel+policies and qualifications in parallel — personnel no longer
      // blocks qualifications, and policies are bundled with personnel (one cold start).
      const [teamRes, qualRes] = await Promise.all([
        fetch(`/api/personnel?root=${encodeURIComponent(sfgId)}&mode=master&include=policies`),
        fetch('/api/activity?type=qualifications'),
      ])

      const { personnel: master, policies: pols } = teamRes.ok
        ? await teamRes.json()
        : { personnel: [], policies: [] }

      setMasterPersonnel(master)
      setDisplayPersonnel(master)
      setPolicies(pols ?? [])

      setSelectedScope('master')

      if (qualRes.ok) {
        const { qualifications } = await qualRes.json()
        setQualMap(qualifications ?? {})
      }
    } catch (e) {
      console.error('[monthly-agent-totals]', e)
    } finally {
      setLoading(false)
    }
  }

  function handleScopeChange(scope) {
    setSelectedScope(scope)
    const display = scope === 'master'
      ? masterPersonnel
      : masterPersonnel.filter(p => getBaseshopIds(scope, masterPersonnel).has(p.sfg_id.toLowerCase()))
    setDisplayPersonnel(display)
  }

  // ── Downline tree ──────────────────────────────────────────────────────────
  // descendantsOf  : sfg_id_lower → Set of all descendant sfg_id_lowers (incl. self)
  // directChildrenOf: sfg_id_lower → string[] of immediate children (needed for leg rule)
  const { descendantsOf, directChildrenOf } = useMemo(() => {
    const childrenOf = {}
    for (const p of masterPersonnel) {
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
    for (const p of masterPersonnel) get(p.sfg_id.toLowerCase())
    return { descendantsOf: cache, directChildrenOf: childrenOf }
  }, [masterPersonnel])

  // ── Filter policies to selected month ──────────────────────────────────────
  const monthPolicies = useMemo(() => {
    return policies.filter(p => {
      const ym = toYearMonth(p.submit_week) ?? toYearMonth(p.submit_date)
      return ym && ym.year === selectedYear && ym.month === selectedMonth
    })
  }, [policies, selectedYear, selectedMonth])

  // ── Policy lookup by SFG ID — submit_week-based (pending / incomplete / weekly) ──
  const polsBySfgId = useMemo(() => {
    const map = {}
    for (const p of monthPolicies) {
      const id = p.sfg_id?.toLowerCase()
      if (!id) continue
      ;(map[id] ??= []).push(p)
    }
    return map
  }, [monthPolicies])

  // ── Issued-policy lookup by SFG ID — issue_date-based ─────────────────────
  // Issued APV is recognised in the calendar month it was issued, not submitted.
  const issuedPolsBySfgId = useMemo(() => {
    const map = {}
    for (const p of policies) {
      if (p.status?.toLowerCase() !== 'issued') continue
      const ym = toYearMonth(p.issue_date)
      if (!ym || ym.year !== selectedYear || ym.month !== selectedMonth) continue
      const id = p.sfg_id?.toLowerCase()
      if (!id) continue
      ;(map[id] ??= []).push(p)
    }
    return map
  }, [policies, selectedYear, selectedMonth])

  // ── All policies by SFG ID — no date filter (for pending / incomplete) ────
  // Pending and Incomplete are current-state buckets: show ALL such policies
  // (regardless of submit date) when the selected month is the current month.
  const allPoliciesBySfgId = useMemo(() => {
    const map = {}
    for (const p of policies) {
      const id = p.sfg_id?.toLowerCase()
      if (!id) continue
      ;(map[id] ??= []).push(p)
    }
    return map
  }, [policies])

  // ── Chargebacks for the selected month ────────────────────────────────────
  // Scan ALL policies (not just month-filtered) for cb_month matching selected month.
  // Returns both a per-agent sum (amounts) and the individual CB policies (pols)
  // so the drill-down modal can display them as negative line items.
  const chargebackMemo = useMemo(() => {
    const amounts = {}
    const pols    = {}
    for (const p of policies) {
      const cbYm = parseCbMonth(p.snapshot_chargeback_month)
      if (!cbYm || cbYm.year !== selectedYear || cbYm.month !== selectedMonth) continue
      const amt = parseCbApv(p.snapshot_chargeback_apv)
      if (!amt) continue
      const id = p.sfg_id?.toLowerCase()
      if (!id) continue
      amounts[id] = (amounts[id] ?? 0) + amt
      ;(pols[id] ??= []).push(p)
    }
    return { amounts, pols }
  }, [policies, selectedYear, selectedMonth])

  // ── Likely-chargeback memo ────────────────────────────────────────────────
  // Policies where chargeback_exempt = false AND conservation_date falls in the
  // selected month. Represents expected carrier chargebacks not yet posted.
  const likelyCbMemo = useMemo(() => {
    const amounts = {}
    const pols    = {}
    for (const p of policies) {
      if (p.chargeback_exempt !== false) continue   // null = unknown, true = exempt
      const cbYm = toYearMonth(p.conservation_date)
      if (!cbYm || cbYm.year !== selectedYear || cbYm.month !== selectedMonth) continue
      const amt = p.issued_apv ?? 0
      if (!amt) continue
      const id = p.sfg_id?.toLowerCase()
      if (!id) continue
      amounts[id] = (amounts[id] ?? 0) + amt
      ;(pols[id] ??= []).push(p)
    }
    return { amounts, pols }
  }, [policies, selectedYear, selectedMonth])

  // ── Week columns — one per Friday in the selected month ───────────────────
  // Uses computed Friday dates so a 5-Friday month always shows 5 columns.
  // Date labels are pulled from policy data when available (prefer data over computed).
  const weekColumns = useMemo(() => {
    const fridayCols = getFridayColumns(selectedYear, selectedMonth)
    // Map week number string → short date label from actual policy data
    const numToLabel = {}
    for (const p of monthPolicies) {
      const n = p.submit_week_num?.trim()
      if (n && p.submit_week && !numToLabel[n]) {
        numToLabel[n] = shortWeekDate(p.submit_week)
      }
    }
    return fridayCols.map(col => ({
      numStr: col.numStr,
      label:  numToLabel[col.numStr] ?? col.fridayLabel,
    }))
  }, [monthPolicies, selectedYear, selectedMonth])

  // ── Per-agent stats ────────────────────────────────────────────────────────
  const agentRows = useMemo(() => {
    return displayPersonnel.map(agent => {
      const id      = agent.sfg_id.toLowerCase()
      const descSet = descendantsOf[id] ?? new Set([id])

      // submit_week-based — weekly submissions and writers count only
      const ownPols  = polsBySfgId[id] ?? []
      const teamPols = []
      for (const tid of descSet) for (const p of (polsBySfgId[tid] ?? [])) teamPols.push(p)

      // issue_date-based — issued APV only
      const ownIssuedPols  = issuedPolsBySfgId[id] ?? []
      const teamIssuedPols = []
      for (const tid of descSet) for (const p of (issuedPolsBySfgId[tid] ?? [])) teamIssuedPols.push(p)

      // No-date-filter — pending and incomplete (only surfaced when isCurrentMonth)
      const ownAllPols  = allPoliciesBySfgId[id] ?? []
      const teamAllPols = []
      for (const tid of descSet) for (const p of (allPoliciesBySfgId[tid] ?? [])) teamAllPols.push(p)

      const hasDownlines = descSet.size > 1

      // Snapshot chargebacks (posted, via cb_month / cb_apv)
      const ownCb      = chargebackMemo.amounts[id] ?? 0
      const teamCb     = [...descSet].reduce((s, tid) => s + (chargebackMemo.amounts[tid] ?? 0), 0)
      const ownCbPols  = chargebackMemo.pols[id] ?? []
      const teamCbPols = [...descSet].flatMap(tid => chargebackMemo.pols[tid] ?? [])

      // Likely chargebacks (chargeback_exempt=false, conservation_date in selected month)
      // Only relevant for the current month — past months use actual chargebacks only.
      const ownLikelyCbAmt   = likelyCbMemo.amounts[id] ?? 0
      const teamLikelyCbAmt  = [...descSet].reduce((s, tid) => s + (likelyCbMemo.amounts[tid] ?? 0), 0)
      const ownLikelyCbPols  = isCurrentMonth && includeLikelyCb ? (likelyCbMemo.pols[id] ?? []) : []
      const teamLikelyCbPols = isCurrentMonth && includeLikelyCb ? [...descSet].flatMap(tid => likelyCbMemo.pols[tid] ?? []) : []

      // Status predicates
      const isIssued  = p => p.status?.toLowerCase() === 'issued'
      const isPending = p => p.status?.toLowerCase() === 'pending'
      const isIncomp  = p => p.status?.toLowerCase() === 'incomplete'

      // Drill-down policy lists (pending/incomplete only populated for current month)
      const agentIssuedPols     = ownIssuedPols
      const agentPendingPols    = isCurrentMonth ? ownAllPols.filter(isPending) : []
      const agentIncompletePols = isCurrentMonth ? ownAllPols.filter(isIncomp)  : []
      const teamIssuedPolsList  = teamIssuedPols
      const teamPendingPols     = isCurrentMonth ? teamAllPols.filter(isPending) : []
      const teamIncompletePols  = isCurrentMonth ? teamAllPols.filter(isIncomp)  : []

      // APV sums — actual chargebacks always deducted; likelyCb only for current month + toggle
      const sumApv = arr => arr.reduce((s, p) => s + (p.issued_apv ?? 0), 0)
      const agentIssued     = sumApv(agentIssuedPols) - ownCb - (isCurrentMonth && includeLikelyCb ? ownLikelyCbAmt  : 0)
      const agentPending    = sumApv(agentPendingPols)
      const agentIncomplete = sumApv(agentIncompletePols)
      const teamIssued      = sumApv(teamIssuedPolsList) - teamCb - (isCurrentMonth && includeLikelyCb ? teamLikelyCbAmt : 0)
      const teamPending     = sumApv(teamPendingPols)
      const teamIncomplete  = sumApv(teamIncompletePols)

      // Writers = distinct SFG IDs in team with any submitted policy this month
      const writers = new Set(teamPols.map(p => p.sfg_id?.toLowerCase()).filter(Boolean)).size

      // Current levels & next targets
      const curContract  = agent.commission_contract?.level ?? null
      const curLeader    = agent.commission_leadership?.level ?? null
      const nextConLvl   = nextContractLevel(curContract)
      const nextLeadLvl  = nextLeadershipLevel(curLeader)
      const promoQual    = nextConLvl  ? (qualMap[String(nextConLvl)] ?? null) : null
      const leadQual     = nextLeadLvl ? (qualMap[nextLeadLvl]        ?? null) : null

      // 50 % leg rule — find the largest single-leg issued APV
      // A "leg" = one direct downline + all of their subordinates
      const directChildren = directChildrenOf[id] ?? []
      const maxLegApv = directChildren.reduce((best, childId) => {
        const legDesc = descendantsOf[childId] ?? new Set([childId])
        const legApv  = [...legDesc].reduce(
          (s, tid) => s + (issuedPolsBySfgId[tid] ?? []).reduce((ss, p) => ss + (p.issued_apv ?? 0), 0),
          0
        )
        return Math.max(best, legApv)
      }, 0)

      // Agent personal submitted APV (submit-week-based, for the selected month)
      const agentSubmitted = ownPols.reduce((s, p) => s + (p.submitted_apv ?? 0), 0)

      // Weekly submission lookup — must come before promoStatuses so submissionMet can be passed in
      const agentWeekNums      = new Set(ownPols.map(p => p.submit_week_num?.trim()).filter(Boolean))
      const hasSlingshotTarget = (promoQual?.slingshot ?? null) !== null
      const slingHit           = hasSlingshotTarget && teamIssued >= promoQual.slingshot
      const requiredWeeks      = weekColumns.length >= 5 ? 4 : 3
      const submittedCount     = weekColumns.filter(wk => agentWeekNums.has(wk.numStr)).length
      const submissionMet      = hasSlingshotTarget && submittedCount >= requiredWeeks

      // Highlighting statuses (team issued APV; leg rule applied; submission companion for slingshot)
      const promoStat = promoStatuses(teamIssued, writers, promoQual, maxLegApv, submissionMet)
      const leadStat  = leadStatuses(teamIssued, writers, leadQual, maxLegApv)

      // Weekly submission cell color (companion to slingshot APV):
      //   suppress = level has no slingshot target
      //   green    = slingshot APV met + weeks met, leg rule OK
      //   orange   = slingshot APV met + weeks met, but leg rule prevents qualification
      //   yellow   = weeks requirement met, slingshot APV not yet reached
      //   none     = weeks requirement not met (grey labels still shown for submitted weeks)
      let submissionStatus = 'suppress'
      if (hasSlingshotTarget) {
        if (submissionMet && slingHit) {
          submissionStatus = legRulePreventsQual(teamIssued, promoQual.slingshot, maxLegApv) ? 'orange' : 'green'
        } else if (submissionMet) {
          submissionStatus = 'yellow'   // weeks done, APV not there yet
        } else {
          submissionStatus = 'none'     // weeks not done; grey labels shown
        }
      }

      return {
        sfg_id: agent.sfg_id,
        name:   agent.name,
        agentSubmitted, agentIssued, agentPending, agentIncomplete,
        ownPols,
        teamIssued, teamPending, teamIncomplete,
        writers,
        hasDownlines,
        promoQual, leadQual,
        promoStat, leadStat,
        agentWeekNums,
        submissionStatus,
        // Drill-down policy lists
        agentIssuedPols, agentPendingPols, agentIncompletePols,
        teamIssuedPols: teamIssuedPolsList, teamPendingPols, teamIncompletePols,
        // CB line items shown in modal only for past months (where they affect the total)
        ownCbPols:   isPastMonth ? ownCbPols  : [],
        teamCbPols:  isPastMonth ? teamCbPols : [],
        ownLikelyCbPols, teamLikelyCbPols,
      }
    })
    // Only show agents with at least one non-zero APV field (includes negatives from chargebacks)
    .filter(r =>
      r.agentIssued !== 0 || r.agentPending !== 0 || r.agentIncomplete !== 0 ||
      r.teamIssued  !== 0 || r.teamPending  !== 0 || r.teamIncomplete  !== 0
    )
    // Alphabetical by name
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
  }, [displayPersonnel, polsBySfgId, issuedPolsBySfgId, allPoliciesBySfgId, descendantsOf, directChildrenOf, qualMap, chargebackMemo, likelyCbMemo, includeLikelyCb, isCurrentMonth, isPastMonth, weekColumns])

  // ── Year options ───────────────────────────────────────────────────────────
  const yearOptions = []
  for (let y = now.getFullYear(); y >= 2022; y--) yearOptions.push(y)

  if (!permissions.metrics.read) return (
    <main className="max-w-4xl mx-auto px-6 py-8">
      <p className="text-sm text-red-500">You don't have access to this section.</p>
    </main>
  )
  if (!activeSubject) return (
    <div className="flex items-center justify-center py-24">
      <p className="text-gray-400 dark:text-white/30 text-sm">Please sign in to view agent totals.</p>
    </div>
  )

  return (
    <main className="max-w-[1800px] mx-auto px-6 py-8">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Monthly Agent Totals</h1>

        <select
          value={selectedMonth}
          onChange={e => setSelectedMonth(Number(e.target.value))}
          className="text-sm bg-gray-100 border border-gray-300 text-gray-900 dark:bg-white/10 dark:border-white/20 dark:text-white rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-accent cursor-pointer"
        >
          {MONTH_NAMES.map((m, i) => (
            <option key={i} value={i} style={optionStyle}>{m}</option>
          ))}
        </select>

        <select
          value={selectedYear}
          onChange={e => setSelectedYear(Number(e.target.value))}
          className="text-sm bg-gray-100 border border-gray-300 text-gray-900 dark:bg-white/10 dark:border-white/20 dark:text-white rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-accent cursor-pointer"
        >
          {yearOptions.map(y => (
            <option key={y} value={y} style={optionStyle}>{y}</option>
          ))}
        </select>

        {isDirector && (
          <ScopeDropdown
            masterPersonnel={masterPersonnel}
            selfId={activeSubject?.sfg_id}
            value={selectedScope}
            onChange={handleScopeChange}
          />
        )}

        {/* Likely-chargeback toggle */}
        <button
          onClick={() => setIncludeLikelyCb(v => !v)}
          className={`ml-auto flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
            includeLikelyCb
              ? 'bg-orange-500/10 border-orange-400/40 text-orange-600 dark:text-orange-400'
              : 'bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/15 text-gray-500 dark:text-white/50 hover:border-gray-300 dark:hover:border-white/25'
          }`}
        >
          <span className={`w-2 h-2 rounded-full flex-shrink-0 transition-colors ${includeLikelyCb ? 'bg-orange-500' : 'bg-gray-300 dark:bg-white/25'}`} />
          Possible chargebacks
        </button>
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="space-y-2 animate-pulse">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-9 bg-gray-100 dark:bg-white/10 rounded-xl" />
          ))}
        </div>
      ) : (
        <AgentTotalsTable agentRows={agentRows} weekColumns={weekColumns} onCellClick={setModal} />
      )}

      <PolicyBreakdownModal modal={modal} onClose={() => setModal(null)} />
    </main>
  )
}

// ─── Table ─────────────────────────────────────────────────────────────────────

function AgentTotalsTable({ agentRows, weekColumns, onCellClick }) {
  const BL = 'border-l border-gray-200 dark:border-white/10'

  const thGroup = (color, extra = '') =>
    `text-xs font-bold uppercase tracking-widest px-2.5 py-1.5 text-center border-b border-gray-200 dark:border-white/10 ${color} ${extra}`

  const thCol = (extra = '') =>
    `text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 px-2.5 py-2 text-right whitespace-nowrap ${extra}`

  const THEAD_BG  = 'bg-gray-50 dark:bg-white/[0.04]'
  const STICKY_BG = 'bg-gray-50 dark:bg-[#003539]'

  return (
    <div className="border border-gray-200 dark:border-white/10 rounded-2xl [overflow:clip]">
      <div className="overflow-x-auto bg-white dark:bg-primary/30">
        <table className="w-full text-sm border-collapse">
          <thead>
            {/* ── Row 1: Group labels ─────────────────────────────────────── */}
            <tr className={`border-b border-gray-200 dark:border-white/10 ${THEAD_BG}`}>
              <th
                rowSpan={2}
                className={`text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 px-3 py-2 text-left sticky left-0 z-20 ${STICKY_BG} border-r border-gray-200 dark:border-white/10 whitespace-nowrap`}
              >
                Agent
              </th>
              <th className={thGroup('text-blue-600 dark:text-blue-300', BL)} colSpan={4}>Agent</th>
              <th className={thGroup('text-accent dark:text-accent/80', BL)} colSpan={4}>Team</th>
              <th className={thGroup('text-emerald-600 dark:text-emerald-400', BL)} colSpan={3}>Promotion Targets</th>
              <th className={thGroup('text-purple-600 dark:text-purple-400', BL)} colSpan={2}>Leadership Targets</th>
              {weekColumns.length > 0 && (
                <th className={thGroup('text-gray-500 dark:text-white/50', BL)} colSpan={weekColumns.length}>
                  Weekly Submissions
                </th>
              )}
            </tr>

            {/* ── Row 2: Column labels ────────────────────────────────────── */}
            <tr className={`border-b border-gray-200 dark:border-white/10 ${THEAD_BG}`}>
              {/* Agent */}
              <th className={thCol(BL)}>Submitted</th>
              <th className={thCol()}>Issued</th>
              <th className={thCol()}>Pending</th>
              <th className={thCol()}>Incomplete</th>
              {/* Team */}
              <th className={thCol(BL)}>Issued</th>
              <th className={thCol()}>Pending</th>
              <th className={thCol()}>Incomplete</th>
              <th className={thCol()}>Writers</th>
              {/* Promotion */}
              <th className={thCol(BL)}>APV</th>
              <th className={thCol()}>Slingshot</th>
              <th className={thCol()}>Writers</th>
              {/* Leadership */}
              <th className={thCol(BL)}>APV</th>
              <th className={thCol()}>Writers</th>
              {/* Weekly */}
              {weekColumns.map((wk, i) => (
                <th key={wk.numStr} className={thCol(i === 0 ? BL : '')}>{wk.numStr}</th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-100 dark:divide-white/5">
            {agentRows.length === 0 ? (
              <tr>
                <td colSpan={14 + weekColumns.length} className="text-center py-14 text-gray-400 dark:text-white/30 text-sm">
                  No submissions found for this month.
                </td>
              </tr>
            ) : agentRows.map((row, i) => (
              <AgentRow key={row.sfg_id} row={row} weekColumns={weekColumns} isEven={i % 2 === 0} onCellClick={onCellClick} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Policy Breakdown Modal ────────────────────────────────────────────────────

function PolicyBreakdownModal({ modal, onClose }) {
  if (!modal) return null

  const { title, pols = [], cbPols = [], likelyCbPols = [], showAgent, apvField, showNotes } = modal

  // Sort main policies by APV descending
  const sorted = [...pols].sort((a, b) => (b[apvField] ?? 0) - (a[apvField] ?? 0))

  // Running total (positive policies minus chargebacks and likely chargebacks)
  const total = pols.reduce((s, p) => s + (p[apvField] ?? 0), 0)
              - cbPols.reduce((s, p) => s + parseCbApv(p.snapshot_chargeback_apv), 0)
              - likelyCbPols.reduce((s, p) => s + (p.issued_apv ?? 0), 0)

  const thCls = 'text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 whitespace-nowrap'
  const tdCls = 'px-4 py-2 text-xs text-gray-700 dark:text-white/80'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-primary border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-white/10 flex-shrink-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:text-white/40 dark:hover:text-white dark:hover:bg-white/10 transition-colors text-base leading-none"
          >
            ✕
          </button>
        </div>

        {/* Table */}
        <div className="overflow-y-auto flex-1">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-gray-50 dark:bg-white/[0.04] border-b border-gray-200 dark:border-white/10">
              <tr>
                <th className={thCls}>Client</th>
                <th className={thCls}>Carrier</th>
                {showAgent  && <th className={thCls}>Agent</th>}
                <th className={`${thCls} text-right`}>APV</th>
                {showNotes  && <th className={thCls}>Application Notes</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/5">
              {sorted.length === 0 && cbPols.length === 0 && likelyCbPols.length === 0 ? (
                <tr>
                  <td colSpan={2 + (showAgent ? 1 : 0) + 1 + (showNotes ? 1 : 0)}
                      className="px-4 py-8 text-center text-xs text-gray-400 dark:text-white/30">
                    No policies found.
                  </td>
                </tr>
              ) : (
                <>
                  {sorted.map((p, i) => (
                    <tr key={i} className="hover:bg-gray-50 dark:hover:bg-white/[0.03]">
                      <td className={tdCls}>{p.applicant || '—'}</td>
                      <td className={`${tdCls} text-gray-500 dark:text-white/55`}>{p.carrier || '—'}</td>
                      {showAgent && <td className={`${tdCls} text-gray-500 dark:text-white/55`}>{p.agent || '—'}</td>}
                      <td className={`${tdCls} text-right tabular-nums`}>{fmtAmt(p[apvField])}</td>
                      {showNotes && (
                        <td className={`${tdCls} text-gray-500 dark:text-white/55 max-w-xs`}>
                          {p.application_notes || <span className="text-gray-300 dark:text-white/20">—</span>}
                        </td>
                      )}
                    </tr>
                  ))}
                  {cbPols.map((p, i) => (
                    <tr key={`cb-${i}`} className="hover:bg-gray-50 dark:hover:bg-white/[0.03]">
                      <td className={`${tdCls} text-gray-500 dark:text-white/50`}>
                        {p.applicant || '—'}
                        <span className="ml-1.5 text-[10px] font-semibold text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-500/10 px-1 py-0.5 rounded">CB</span>
                      </td>
                      <td className={`${tdCls} text-gray-500 dark:text-white/55`}>{p.carrier || '—'}</td>
                      {showAgent && <td className={`${tdCls} text-gray-500 dark:text-white/55`}>{p.agent || '—'}</td>}
                      <td className={`${tdCls} text-right tabular-nums text-red-500 dark:text-red-400 font-medium`}>
                        {fmtAmt(-parseCbApv(p.snapshot_chargeback_apv))}
                      </td>
                      {showNotes && <td />}
                    </tr>
                  ))}
                  {likelyCbPols.map((p, i) => (
                    <tr key={`lcb-${i}`} className="hover:bg-gray-50 dark:hover:bg-white/[0.03]">
                      <td className={`${tdCls} text-gray-500 dark:text-white/50`}>
                        {p.applicant || '—'}
                        <span className="ml-1.5 text-[10px] font-semibold text-orange-500 dark:text-orange-400 bg-orange-50 dark:bg-orange-500/10 px-1 py-0.5 rounded">LC</span>
                      </td>
                      <td className={`${tdCls} text-gray-500 dark:text-white/55`}>{p.carrier || '—'}</td>
                      {showAgent && <td className={`${tdCls} text-gray-500 dark:text-white/55`}>{p.agent || '—'}</td>}
                      <td className={`${tdCls} text-right tabular-nums text-orange-500 dark:text-orange-400 font-medium`}>
                        {fmtAmt(-(p.issued_apv ?? 0))}
                      </td>
                      {showNotes && <td />}
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200 dark:border-white/10 flex-shrink-0">
          <span className="text-xs text-gray-400 dark:text-white/35">
            {sorted.length + cbPols.length + likelyCbPols.length}{' '}
            {sorted.length + cbPols.length + likelyCbPols.length === 1 ? 'policy' : 'policies'}
            {cbPols.length > 0 && ` (${cbPols.length} CB)`}
            {likelyCbPols.length > 0 && ` (${likelyCbPols.length} LC)`}
          </span>
          <span className="text-sm font-semibold text-gray-900 dark:text-white">
            Total: {fmtAmt(total)}
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Agent Row ─────────────────────────────────────────────────────────────────

function AgentRow({ row: r, weekColumns, isEven, onCellClick }) {
  const BL       = 'border-l border-gray-100 dark:border-white/5 '
  const rowBg    = isEven ? 'bg-white dark:bg-transparent' : 'bg-gray-50/50 dark:bg-white/[0.018]'
  const stickyBg = isEven ? 'bg-white dark:bg-[#003539]'  : 'bg-gray-50 dark:bg-[#003539]'

  // Production cells — value, dash, or negative (red); clickable when non-zero
  function apvCell(v, borderL = false, modalConfig = null) {
    const cls = v > 0 ? 'text-gray-700 dark:text-white/80'
              : v < 0 ? 'text-red-500 dark:text-red-400 font-medium'
              :         'text-gray-300 dark:text-white/20'
    const hasChargebacks = (modalConfig?.cbPols?.length ?? 0) > 0 || (modalConfig?.likelyCbPols?.length ?? 0) > 0
    const clickable = modalConfig && (v !== 0 || hasChargebacks)
    return (
      <td
        className={`${borderL ? BL : ''}px-2.5 py-2 text-xs text-right tabular-nums whitespace-nowrap ${cls} ${clickable ? 'cursor-pointer hover:underline' : ''}`}
        onClick={clickable ? () => onCellClick(modalConfig) : undefined}
      >
        {(v !== 0 || clickable) ? fmtAmt(v) : '—'}
      </td>
    )
  }

  function numCell(v, borderL = false) {
    return (
      <td className={`${borderL ? BL : ''}px-2.5 py-2 text-xs text-right tabular-nums ${v > 0 ? 'text-gray-700 dark:text-white/80' : 'text-gray-300 dark:text-white/20'}`}>
        {v > 0 ? v : '—'}
      </td>
    )
  }

  // Target cells — with conditional highlighting
  function targetApvCell(value, status, borderL = false) {
    if (value == null) {
      return <td className={`${borderL ? BL : ''}px-2.5 py-2 text-xs text-right text-gray-300 dark:text-white/15`}>—</td>
    }
    return (
      <td className={`${borderL ? BL : ''}px-2.5 py-2 text-xs text-right tabular-nums whitespace-nowrap`}>
        <span className={`px-1.5 py-0.5 ${hlCls(status)}`}>{fmtAmt(value)}</span>
      </td>
    )
  }

  function targetNumCell(value, status, borderL = false) {
    if (value == null) {
      return <td className={`${borderL ? BL : ''}px-2.5 py-2 text-xs text-right text-gray-300 dark:text-white/15`}>—</td>
    }
    return (
      <td className={`${borderL ? BL : ''}px-2.5 py-2 text-xs text-right tabular-nums`}>
        <span className={`px-1.5 py-0.5 ${hlCls(status)}`}>{value}</span>
      </td>
    )
  }

  // Leadership target cells — blank if no downlines
  function leadApvCell(value, status, hasDownlines, borderL = false) {
    if (!hasDownlines || value == null) {
      return <td className={`${borderL ? BL : ''}px-2.5 py-2 text-xs text-right text-gray-300 dark:text-white/15`}>—</td>
    }
    return (
      <td className={`${borderL ? BL : ''}px-2.5 py-2 text-xs text-right tabular-nums whitespace-nowrap`}>
        <span className={`px-1.5 py-0.5 ${hlCls(status)}`}>{fmtAmt(value)}</span>
      </td>
    )
  }

  function leadNumCell(value, status, hasDownlines, borderL = false) {
    if (!hasDownlines || value == null) {
      return <td className={`${borderL ? BL : ''}px-2.5 py-2 text-xs text-right text-gray-300 dark:text-white/15`}>—</td>
    }
    return (
      <td className={`${borderL ? BL : ''}px-2.5 py-2 text-xs text-right tabular-nums`}>
        <span className={`px-1.5 py-0.5 ${hlCls(status)}`}>{value}</span>
      </td>
    )
  }

  return (
    <tr className={`${rowBg} hover:bg-accent/5 dark:hover:bg-accent/[0.06] transition-colors`}>

      {/* Name — sticky with opaque background to block scrolled content */}
      <td className={`px-3 py-2 text-xs font-medium text-gray-900 dark:text-white sticky left-0 z-10 border-r border-gray-100 dark:border-white/5 whitespace-nowrap ${stickyBg}`}>
        {r.name || r.sfg_id}
      </td>

      {/* Agent APVs */}
      {apvCell(r.agentSubmitted, true,
        { title: `${r.name} — Agent Submitted`, pols: r.ownPols, cbPols: [],
          showAgent: false, apvField: 'submitted_apv', showNotes: true })}
      {apvCell(r.agentIssued, false,
        { title: `${r.name} — Agent Issued`, pols: r.agentIssuedPols, cbPols: r.ownCbPols,
          likelyCbPols: r.ownLikelyCbPols,
          showAgent: false, apvField: 'issued_apv', showNotes: false })}
      {apvCell(r.agentPending, false,
        { title: `${r.name} — Agent Pending`, pols: r.agentPendingPols, cbPols: [],
          showAgent: false, apvField: 'issued_apv', showNotes: true })}
      {apvCell(r.agentIncomplete, false,
        { title: `${r.name} — Agent Incomplete`, pols: r.agentIncompletePols, cbPols: [],
          showAgent: false, apvField: 'issued_apv', showNotes: true })}

      {/* Team APVs */}
      {apvCell(r.teamIssued, true,
        { title: `${r.name} — Team Issued`, pols: r.teamIssuedPols, cbPols: r.teamCbPols,
          likelyCbPols: r.teamLikelyCbPols,
          showAgent: true, apvField: 'issued_apv', showNotes: false })}
      {apvCell(r.teamPending, false,
        { title: `${r.name} — Team Pending`, pols: r.teamPendingPols, cbPols: [],
          showAgent: true, apvField: 'issued_apv', showNotes: true })}
      {apvCell(r.teamIncomplete, false,
        { title: `${r.name} — Team Incomplete`, pols: r.teamIncompletePols, cbPols: [],
          showAgent: true, apvField: 'issued_apv', showNotes: true })}
      {numCell(r.hasDownlines ? r.writers : 0)}

      {/* Promotion Targets */}
      {targetApvCell(r.promoQual?.regular,   r.promoStat.apv,      /* borderL */ true)}
      {targetApvCell(r.promoQual?.slingshot, r.promoStat.slingshot)}
      {targetNumCell(r.promoQual?.writers,   r.promoStat.writers)}

      {/* Leadership Targets */}
      {leadApvCell(r.leadQual?.regular, r.leadStat.apv,     r.hasDownlines, /* borderL */ true)}
      {leadNumCell(r.leadQual?.writers, r.leadStat.writers, r.hasDownlines)}

      {/* Weekly Submissions — suppressed for levels with no slingshot target */}
      {weekColumns.map((wk, i) => {
        const hasIt = r.agentWeekNums.has(wk.numStr)
        const show  = r.submissionStatus !== 'suppress' && hasIt
        return (
          <td key={wk.numStr} className={`${i === 0 ? BL : ''}px-2.5 py-2 text-xs text-right tabular-nums whitespace-nowrap`}>
            {show
              ? <span className={`px-1.5 py-0.5 ${hlCls(r.submissionStatus)}`}>{wk.label}</span>
              : <span className="text-gray-300 dark:text-white/15">—</span>
            }
          </td>
        )
      })}
    </tr>
  )
}
