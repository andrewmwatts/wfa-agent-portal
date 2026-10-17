import { useEffect, useMemo, useState } from 'react'
import { useViewing } from '../context/ViewingContext'
import { useTheme } from '../context/ThemeContext'
import ScopeDropdown from '../components/ScopeDropdown'
import { useMinXl } from '../hooks/useMediaQuery'
import useBodyScrollLock from '../hooks/useBodyScrollLock'
import { isOwnerRecord, getBaseshopIds } from '../../shared/agencyScope'
import { fmtCurrency as fmtAmt } from '../utils/format'

import { nextContractLevel, nextLeadershipLevel, levelAsOfMonth } from '../../shared/commissionLevel'
import {
  policyApvCap, cappedCreditedSum, computeTeamIssued, computeMaxLegApv, computeMaxLegWriters, SINGLE_APV_CAP,
  legRulePreventsQual, promoStatuses, leadStatuses, requiredSubmissionWeeks,
} from '../../shared/promotionQualification'
import {
  participants, creditedAmount, teamCreditedAmount, creditPct, isPrimary,
  submissionCredit, WEEK_SUBMISSION_THRESHOLD,
} from '../../shared/policySplit'

// Qualification math (50% leg rule, $7,500 cap, promo/lead statuses) lives in
// shared/promotionQualification.js so this page and Snapshot's Promotions step stay in lockstep.

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

// Amount a "possible chargeback" projects: the entered Snapshot Chargeback APV
// when one has actually been typed in, else the full issued APV. Checked as a
// blank/null field rather than parseCbApv's return value, so a deliberately
// entered $0 is respected instead of silently falling back.
function likelyCbAmount(p) {
  const raw = p.snapshot_chargeback_apv
  const entered = raw != null && String(raw).trim() !== ''
  return entered ? parseCbApv(raw) : (p.issued_apv ?? 0)
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
  const [showWeeks,        setShowWeeks]        = useState(false) // tablet only: weekly columns are opt-in below xl
  const isXl = useMinXl()

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

  // Indexes a policy under every agent credited on it, not just the primary, so
  // a split policy reaches both agents' rollups. Team sums dedupe by policy id.
  function indexByCreditedAgent(pols) {
    const map = {}
    for (const p of pols) {
      for (const id of participants(p)) {
        ;(map[id.toLowerCase()] ??= []).push(p)
      }
    }
    return map
  }

  // Team total for a non-qualifying figure (pending / incomplete): dedupe the
  // policy list, then take the combined share held by the team. No per-sale cap —
  // that only applies to qualifying issued APV.
  function sumTeamCredited(pols, idSet, field = 'issued_apv') {
    const seen = new Map()
    for (const p of pols) if (!seen.has(p.id)) seen.set(p.id, p)
    let total = 0
    for (const p of seen.values()) total += teamCreditedAmount(p, idSet, field)
    return total
  }

  // ── Policy lookup by SFG ID — submit_week-based (pending / incomplete / weekly) ──
  const polsBySfgId = useMemo(() => indexByCreditedAgent(monthPolicies), [monthPolicies])

  // ── Issued-policy lookup by SFG ID — issue_date-based ─────────────────────
  // Issued APV is recognised in the calendar month it was issued, not submitted.
  const issuedPolsBySfgId = useMemo(() => {
    const inMonth = policies.filter(p => {
      if (p.status?.toLowerCase() !== 'issued') return false
      const ym = toYearMonth(p.issue_date)
      return ym && ym.year === selectedYear && ym.month === selectedMonth
    })
    return indexByCreditedAgent(inMonth)
  }, [policies, selectedYear, selectedMonth])

  // ── All policies by SFG ID — no date filter (for pending / incomplete) ────
  // Pending and Incomplete are current-state buckets: show ALL such policies
  // (regardless of submit date) when the selected month is the current month.
  const allPoliciesBySfgId = useMemo(() => indexByCreditedAgent(policies), [policies])

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
      // A chargeback on a shared policy is debited in the same proportion the
      // credit was given, otherwise the primary absorbs the whole reversal.
      for (const agentId of participants(p)) {
        const portion = creditedAmount(p, agentId, 'snapshot_chargeback_apv')
        if (!portion) continue
        const id = agentId.toLowerCase()
        amounts[id] = (amounts[id] ?? 0) + portion
        ;(pols[id] ??= []).push(p)
      }
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
      const baseAmt = likelyCbAmount(p)
      if (!baseAmt) continue
      for (const agentId of participants(p)) {
        const portion = baseAmt * creditPct(p, agentId)
        if (!portion) continue
        const id = agentId.toLowerCase()
        amounts[id] = (amounts[id] ?? 0) + portion
        ;(pols[id] ??= []).push(p)
      }
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
    // Selected business month ('YYYY-MM') — used to reconstruct point-in-time
    // promotion targets for past months.
    const selMonthStr = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}`
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

      // Snapshot chargebacks (posted, via cb_month / cb_apv). The team total is
      // netted inside computeTeamIssued, so only the per-agent figure and the
      // drill-down lists are needed here. dedupe() keeps a split policy from
      // being listed twice when both participants are in the team.
      const dedupe     = arr => [...new Map(arr.map(p => [p.id, p])).values()]
      const ownCb      = chargebackMemo.amounts[id] ?? 0
      const ownCbPols  = chargebackMemo.pols[id] ?? []
      const teamCbPols = dedupe([...descSet].flatMap(tid => chargebackMemo.pols[tid] ?? []))

      // Likely chargebacks (chargeback_exempt=false, conservation_date in selected month)
      // Only relevant for the current month — past months use actual chargebacks only.
      const ownLikelyCbAmt   = likelyCbMemo.amounts[id] ?? 0
      const teamLikelyCbAmt  = [...descSet].reduce((s, tid) => s + (likelyCbMemo.amounts[tid] ?? 0), 0)
      const ownLikelyCbPols  = isCurrentMonth && includeLikelyCb ? (likelyCbMemo.pols[id] ?? []) : []
      const teamLikelyCbPols = isCurrentMonth && includeLikelyCb ? dedupe([...descSet].flatMap(tid => likelyCbMemo.pols[tid] ?? [])) : []

      // Status predicates
      const isIssued  = p => p.status?.toLowerCase() === 'issued'
      const isPending = p => p.status?.toLowerCase() === 'pending'
      const isIncomp  = p => p.status?.toLowerCase() === 'incomplete'

      // Drill-down policy lists (pending/incomplete only populated for current month)
      const agentIssuedPols     = ownIssuedPols
      const agentPendingPols    = isCurrentMonth ? ownAllPols.filter(isPending) : []
      const agentIncompletePols = isCurrentMonth ? ownAllPols.filter(isIncomp)  : []
      const teamIssuedPolsList  = dedupe(teamIssuedPols)
      const teamPendingPols     = isCurrentMonth ? dedupe(teamAllPols.filter(isPending)) : []
      const teamIncompletePols  = isCurrentMonth ? dedupe(teamAllPols.filter(isIncomp))  : []

      // Levels & next targets (computed before the sums so the 125/130
      // single-policy cap can be applied to the issued team total).
      // Past months use the level the agent HELD that month (reconstructed from
      // agent_promotions) so targets reflect what they were then chasing, not
      // their current level. Current/future months use their current level.
      // Baseline '80' when no point-in-time contract level is known: a new agent
      // with no promotions yet is still at 80% and targeting 85%, mirroring the
      // API's current-month default (commission_contract ?? { level: '80' }).
      const asOfLevels   = isPastMonth ? levelAsOfMonth(agent.promotions, selMonthStr) : null
      const curContract  = isPastMonth ? (asOfLevels.contract?.level   ?? '80') : (agent.commission_contract?.level   ?? '80')
      const curLeader    = isPastMonth ? (asOfLevels.leadership?.level ?? null) : (agent.commission_leadership?.level ?? null)
      const nextConLvl   = nextContractLevel(curContract)
      const nextLeadLvl  = nextLeadershipLevel(curLeader)
      const promoQual    = nextConLvl  ? (qualMap[String(nextConLvl)] ?? null) : null
      const leadQual     = nextLeadLvl ? (qualMap[nextLeadLvl]        ?? null) : null

      // $7,500-per-policy cap. Applies at every level for policies issued on or
      // after the rule change; before that, only when targeting 125/130. Evaluated
      // per policy (see policyApvCap), so the level is what gets passed around.
      const capLevel = nextConLvl

      // APV sums — every figure is the agent's CREDITED share, so a split policy
      // contributes only that agent's portion. Actual chargebacks always
      // deducted; likelyCb only for current month + toggle.
      const sumApv = (arr, field = 'issued_apv') =>
        arr.reduce((s, p) => s + creditedAmount(p, agent.sfg_id, field), 0)
      const agentIssued     = sumApv(agentIssuedPols) - ownCb - (isCurrentMonth && includeLikelyCb ? ownLikelyCbAmt  : 0)
      const agentPending    = sumApv(agentPendingPols)
      const agentIncomplete = sumApv(agentIncompletePols)
      // Team sums dedupe by policy and cap the team's combined share per sale.
      const teamIssued      = computeTeamIssued(descSet, issuedPolsBySfgId, chargebackMemo.amounts, capLevel)
                              - (isCurrentMonth && includeLikelyCb ? teamLikelyCbAmt : 0)
      const teamPending     = sumTeamCredited(teamPendingPols, descSet)
      const teamIncomplete  = sumTeamCredited(teamIncompletePols, descSet)

      // Writers = distinct SFG IDs in team who SUBMITTED an application this
      // month. Applications belong to the primary, so a secondary share doesn't
      // make someone a writer. The same counter is used for the team and for each
      // leg, so the 50% rule always compares like with like.
      const countWriters = (idSet) => {
        const ids = new Set()
        for (const tid of idSet) {
          for (const p of (polsBySfgId[tid] ?? [])) {
            if (isPrimary(p, p.sfg_id) && p.sfg_id) ids.add(p.sfg_id.toLowerCase())
          }
        }
        return ids.size
      }
      const writers = countWriters(descSet)

      // 50 % leg rule — largest single leg, by APV and by writers
      const maxLegApv     = computeMaxLegApv(directChildrenOf[id] ?? [], descendantsOf, issuedPolsBySfgId, capLevel)
      const maxLegWriters = computeMaxLegWriters(directChildrenOf[id] ?? [], descendantsOf, countWriters)

      // Agent personal submitted APV (submit-week-based, for the selected month)
      const agentSubmitted = sumApv(ownPols, 'submitted_apv')

      // Weekly submission lookup — must come before promoStatuses so submissionMet
      // can be passed in. A split app is worth a flat 0.5 to a secondary agent, so
      // two of them satisfy a week; the primary still gets a full 1.0.
      const weekCredit = {}
      for (const p of ownPols) {
        const wk = p.submit_week_num?.trim()
        if (!wk) continue
        weekCredit[wk] = (weekCredit[wk] ?? 0) + submissionCredit(p, agent.sfg_id)
      }
      const agentWeekNums      = new Set(
        Object.entries(weekCredit).filter(([, c]) => c >= WEEK_SUBMISSION_THRESHOLD).map(([wk]) => wk)
      )
      const hasSlingshotTarget = (promoQual?.slingshot ?? null) !== null
      const slingHit           = hasSlingshotTarget && teamIssued >= promoQual.slingshot
      const requiredWeeks      = requiredSubmissionWeeks(weekColumns.length)
      const submittedCount     = weekColumns.filter(wk => agentWeekNums.has(wk.numStr)).length
      const submissionMet      = hasSlingshotTarget && submittedCount >= requiredWeeks

      // Highlighting statuses (team issued APV; leg rule applied; submission companion for slingshot)
      const promoStat = promoStatuses(teamIssued, writers, promoQual, maxLegApv, submissionMet, maxLegWriters)
      const leadStat  = leadStatuses(teamIssued, writers, leadQual, maxLegApv, maxLegWriters)

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
        capLevel,
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
        // Whose share the drill-down should show for each scope
        ownIds:  [agent.sfg_id],
        teamIds: descSet,
      }
    })
    // Only show agents with at least one non-zero APV field (includes negatives from chargebacks)
    .filter(r =>
      r.agentIssued !== 0 || r.agentPending !== 0 || r.agentIncomplete !== 0 ||
      r.teamIssued  !== 0 || r.teamPending  !== 0 || r.teamIncomplete  !== 0
    )
    // Alphabetical by name
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
  }, [displayPersonnel, polsBySfgId, issuedPolsBySfgId, allPoliciesBySfgId, descendantsOf, directChildrenOf, qualMap, chargebackMemo, likelyCbMemo, includeLikelyCb, isCurrentMonth, isPastMonth, weekColumns, selectedYear, selectedMonth])

  // ── Year options ───────────────────────────────────────────────────────────
  const yearOptions = []
  for (let y = now.getFullYear(); y >= 2022; y--) yearOptions.push(y)

  if (!permissions.metrics.read) return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
      <p className="text-sm text-red-500">You don't have access to this section.</p>
    </main>
  )
  if (!activeSubject) return (
    <div className="flex items-center justify-center py-24">
      <p className="text-gray-400 dark:text-white/30 text-sm">Please sign in to view agent totals.</p>
    </div>
  )

  const selectCls = 'text-sm bg-gray-100 border border-gray-300 text-gray-900 dark:bg-white/10 dark:border-white/20 dark:text-white rounded-lg px-2.5 py-1.5 max-md:h-11 max-md:rounded-xl max-md:px-3 touch:md:min-h-[44px] min-w-0 focus:outline-none focus:border-accent cursor-pointer'
  const weeksVisible = isXl || showWeeks

  return (
    <main className="max-w-[1800px] mx-auto px-4 sm:px-6 py-4 sm:py-8">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      {/* Phone: title, then Month|Year, then Scope|toggle on their own rows; wraps naturally from md up */}
      <div className="flex flex-wrap items-center gap-2 md:gap-3 mb-4 md:mb-6">
        <h1 className="w-full md:w-auto text-[22px] md:text-xl font-bold text-gray-900 dark:text-white mb-1 md:mb-0">Monthly Agent Totals</h1>

        <select
          value={selectedMonth}
          onChange={e => setSelectedMonth(Number(e.target.value))}
          aria-label="Month"
          className={`${selectCls} max-md:flex-[1.4]`}
        >
          {MONTH_NAMES.map((m, i) => (
            <option key={i} value={i} style={optionStyle}>{m}</option>
          ))}
        </select>

        <select
          value={selectedYear}
          onChange={e => setSelectedYear(Number(e.target.value))}
          aria-label="Year"
          className={`${selectCls} max-md:flex-1`}
        >
          {yearOptions.map(y => (
            <option key={y} value={y} style={optionStyle}>{y}</option>
          ))}
        </select>

        <div className="basis-full h-0 md:hidden" />

        {isDirector && (
          <ScopeDropdown
            masterPersonnel={masterPersonnel}
            selfId={activeSubject?.sfg_id}
            value={selectedScope}
            onChange={handleScopeChange}
          />
        )}

        <div className="max-md:flex-1 md:ml-auto flex items-center justify-end gap-2">
          {/* Tablet: weekly columns are opt-in so the table fits beside the pinned Agent column */}
          <button
            type="button"
            onClick={() => setShowWeeks(v => !v)}
            aria-pressed={showWeeks}
            className={`hidden md:flex xl:hidden items-center gap-2 text-xs px-3 py-1.5 touch:min-h-[44px] rounded-lg border transition-colors ${
              showWeeks
                ? 'bg-accent/15 border-accent text-gray-900 dark:text-white'
                : 'bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/15 text-gray-600 dark:text-white/60 hover:border-gray-300 dark:hover:border-white/25'
            }`}
          >
            Weekly columns
          </button>

          {/* Likely-chargeback toggle */}
          <button
            onClick={() => setIncludeLikelyCb(v => !v)}
            aria-pressed={includeLikelyCb}
            className={`flex items-center gap-2 text-sm md:text-xs max-md:flex-1 max-md:justify-center px-3 py-1.5 max-md:h-11 touch:md:min-h-[44px] rounded-xl md:rounded-lg border transition-colors ${
              includeLikelyCb
                ? 'bg-orange-500/10 border-orange-400/40 text-orange-700 dark:text-orange-400'
                : 'bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/15 text-gray-600 dark:text-white/60 hover:border-gray-300 dark:hover:border-white/25'
            }`}
          >
            <span className={`w-2 h-2 rounded-full flex-shrink-0 transition-colors ${includeLikelyCb ? 'bg-orange-500' : 'bg-gray-300 dark:bg-white/25'}`} />
            Possible chargebacks
          </button>
        </div>
      </div>

      {/* ── Results ───────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="space-y-2 animate-pulse">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-9 bg-gray-100 dark:bg-white/10 rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          {/* Phone: compact table; each row expands in place */}
          <div className="md:hidden">
            <p className="text-sm text-gray-600 dark:text-white/60 mb-3">
              {agentRows.length} {agentRows.length === 1 ? 'agent' : 'agents'} with production · A–Z
            </p>
            <AgentPhoneTable agentRows={agentRows} weekColumns={weekColumns} onCellClick={setModal} />
          </div>

          {/* Tablet / desktop: table (weekly columns hidden below xl unless switched on) */}
          <div className="hidden md:block">
            <AgentTotalsTable agentRows={agentRows} weekColumns={weeksVisible ? weekColumns : []} onCellClick={setModal} />
          </div>
        </>
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
    `text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-white/50 px-2.5 py-2 text-right whitespace-nowrap ${extra}`

  const THEAD_BG  = 'bg-gray-50 dark:bg-white/[0.04]'
  const STICKY_BG = 'bg-gray-50 dark:bg-secondary'

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
  useBodyScrollLock(!!modal)
  if (!modal) return null

  const { title, pols = [], cbPols = [], likelyCbPols = [], showAgent, apvField, showNotes,
          capLevel = null, creditIds = null } = modal

  // Credited share for whoever this breakdown is about — the agent alone, or the
  // whole team — so a split policy shows the amount that actually landed in the
  // column rather than the full sale.
  const rawVal = p => (creditIds ? teamCreditedAmount(p, creditIds, apvField) : (p[apvField] ?? 0))
  // Per-policy cap — depends on each policy's issue date as well as the level
  // being chased, so it's evaluated per row rather than as one scalar.
  const capOf   = p => (apvField === 'issued_apv' ? policyApvCap(p, capLevel) : Infinity)
  const capVal  = p => Math.min(rawVal(p), capOf(p))
  const anyCapped = pols.some(p => rawVal(p) > capOf(p))
  const anySplit  = pols.some(p => p.splits?.length > 0)

  // Sort main policies by capped APV descending
  const sorted = [...pols].sort((a, b) => capVal(b) - capVal(a))

  // Running total (capped positive policies minus chargebacks and likely chargebacks)
  const total = pols.reduce((s, p) => s + capVal(p), 0)
              - cbPols.reduce((s, p) => s + parseCbApv(p.snapshot_chargeback_apv), 0)
              - likelyCbPols.reduce((s, p) => s + likelyCbAmount(p), 0)

  const thCls = 'text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 whitespace-nowrap'
  const tdCls = 'px-4 py-2 text-xs text-gray-700 dark:text-white/80'

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center sm:p-4 bg-black/40 sm:backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Full-screen sheet on phones, dialog from sm up */}
      <div
        className="bg-white dark:bg-primary sm:border border-gray-200 dark:border-white/10 sm:rounded-2xl shadow-2xl w-full sm:max-w-2xl max-sm:h-dvh sm:max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 max-sm:pt-[max(0.75rem,env(safe-area-inset-top))] border-b border-gray-200 dark:border-white/10 flex-shrink-0">
          <div>
            <h2 className="text-base sm:text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
            {anyCapped && (
              <p className="text-xs text-gray-500 dark:text-white/50 mt-0.5">
                Each policy counts up to {fmtAmt(SINGLE_APV_CAP)} toward qualification
              </p>
            )}
            {anySplit && (
              <p className="text-xs text-gray-500 dark:text-white/50 mt-0.5">
                Split policies show the credited share, not the full sale
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-11 h-11 sm:w-7 sm:h-7 touch:sm:w-11 touch:sm:h-11 shrink-0 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-white/50 dark:hover:text-white dark:hover:bg-white/10 transition-colors text-base leading-none"
          >
            ✕
          </button>
        </div>

        {/* Phone: stacked list (the five-column table cannot fit) */}
        <div className="sm:hidden overflow-y-auto flex-1 overscroll-contain">
          {sorted.length === 0 && cbPols.length === 0 && likelyCbPols.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-gray-500 dark:text-white/50">No policies found.</p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-white/10">
              {sorted.map((p, i) => (
                <li key={i} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-base font-medium text-gray-900 dark:text-white min-w-0 break-words">{p.applicant || '—'}</span>
                    <span className="text-base font-semibold text-gray-900 dark:text-white tabular-nums shrink-0">
                      {fmtAmt(capVal(p))}
                      {rawVal(p) > capOf(p) && <span className="ml-1 text-xs font-normal text-gray-500 dark:text-white/50">({fmtAmt(rawVal(p))})</span>}
                      {p.splits?.length > 0 && <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-xs font-semibold leading-none border border-accent/70 bg-accent/15 text-gray-800 dark:text-white align-middle">Split</span>}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-white/65 mt-0.5">
                    {p.carrier || '—'}{showAgent && p.agent ? ` · ${p.agent}` : ''}
                  </p>
                  {showNotes && p.application_notes && (
                    <p className="text-[13px] text-gray-700 dark:text-white/70 mt-1">{p.application_notes}</p>
                  )}
                </li>
              ))}
              {cbPols.map((p, i) => (
                <li key={`cb-${i}`} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-base text-gray-700 dark:text-white/70 min-w-0 break-words">
                      {p.applicant || '—'}
                      <span className="ml-1.5 text-xs font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 px-1.5 py-0.5 rounded">CB</span>
                    </span>
                    <span className="text-base font-semibold text-red-600 dark:text-red-400 tabular-nums shrink-0">{fmtAmt(-parseCbApv(p.snapshot_chargeback_apv))}</span>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-white/65 mt-0.5">{p.carrier || '—'}{showAgent && p.agent ? ` · ${p.agent}` : ''}</p>
                </li>
              ))}
              {likelyCbPols.map((p, i) => (
                <li key={`lcb-${i}`} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-base text-gray-700 dark:text-white/70 min-w-0 break-words">
                      {p.applicant || '—'}
                      <span className="ml-1.5 text-xs font-semibold text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-500/10 px-1.5 py-0.5 rounded">LC</span>
                    </span>
                    <span className="text-base font-semibold text-orange-600 dark:text-orange-400 tabular-nums shrink-0">{fmtAmt(-likelyCbAmount(p))}</span>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-white/65 mt-0.5">{p.carrier || '—'}{showAgent && p.agent ? ` · ${p.agent}` : ''}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Table */}
        <div className="hidden sm:block overflow-y-auto flex-1">
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
                      <td className={`${tdCls} text-right tabular-nums`}>
                        {fmtAmt(capVal(p))}
                        {rawVal(p) > capOf(p) && (
                          <span className="ml-1 text-[10px] text-gray-400 dark:text-white/35">({fmtAmt(rawVal(p))})</span>
                        )}
                        {p.splits?.length > 0 && (
                          <span
                            title={p.splits.map(s => `${s.agent || s.sfg_id}: ${Math.round(s.credit_pct * 1000) / 10}%`).join(' · ')}
                            className="ml-1.5 px-1 py-0.5 rounded text-[9px] font-semibold bg-accent/15 text-accent align-middle"
                          >
                            Split
                          </span>
                        )}
                      </td>
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
                        {fmtAmt(-likelyCbAmount(p))}
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
        <div className="flex items-center justify-between px-5 py-3 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-gray-200 dark:border-white/10 flex-shrink-0">
          <span className="text-xs text-gray-500 dark:text-white/50">
            {sorted.length + cbPols.length + likelyCbPols.length}{' '}
            {sorted.length + cbPols.length + likelyCbPols.length === 1 ? 'policy' : 'policies'}
            {cbPols.length > 0 && ` (${cbPols.length} CB)`}
            {likelyCbPols.length > 0 && ` (${likelyCbPols.length} LC)`}
          </span>
          <span className="text-base sm:text-sm font-semibold text-gray-900 dark:text-white">
            Total: {fmtAmt(total)}
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Drill-down configs ────────────────────────────────────────────────────────
// What each APV figure opens in the breakdown modal — shared by the table row and
// the phone card so a figure always drills into the same policies on both.

function modalConfigsFor(r) {
  return {
    agentSubmitted: { title: `${r.name} — Agent Submitted`, pols: r.ownPols, cbPols: [], creditIds: r.ownIds,
      showAgent: false, apvField: 'submitted_apv', showNotes: true },
    agentIssued: { title: `${r.name} — Agent Issued`, pols: r.agentIssuedPols, cbPols: r.ownCbPols, creditIds: r.ownIds,
      likelyCbPols: r.ownLikelyCbPols,
      showAgent: false, apvField: 'issued_apv', showNotes: false },
    agentPending: { title: `${r.name} — Agent Pending`, pols: r.agentPendingPols, cbPols: [], creditIds: r.ownIds,
      showAgent: false, apvField: 'issued_apv', showNotes: true },
    agentIncomplete: { title: `${r.name} — Agent Incomplete`, pols: r.agentIncompletePols, cbPols: [], creditIds: r.ownIds,
      showAgent: false, apvField: 'issued_apv', showNotes: true },
    teamIssued: { title: `${r.name} — Team Issued`, pols: r.teamIssuedPols, cbPols: r.teamCbPols, creditIds: r.teamIds,
      likelyCbPols: r.teamLikelyCbPols, capLevel: r.capLevel,
      showAgent: true, apvField: 'issued_apv', showNotes: false },
    teamPending: { title: `${r.name} — Team Pending`, pols: r.teamPendingPols, cbPols: [], creditIds: r.teamIds,
      showAgent: true, apvField: 'issued_apv', showNotes: true },
    teamIncomplete: { title: `${r.name} — Team Incomplete`, pols: r.teamIncompletePols, cbPols: [], creditIds: r.teamIds,
      showAgent: true, apvField: 'issued_apv', showNotes: true },
  }
}

// ─── Phone table ───────────────────────────────────────────────────────────────
// Phone: a compact table (agent · team issued · next promotion target · weekly tally).
// A row's caret expands it in place to everything the wide table shows.

function AgentPhoneTable({ agentRows, weekColumns, onCellClick }) {
  if (agentRows.length === 0) {
    return <p className="text-center py-14 text-gray-500 dark:text-white/50 text-sm">No submissions found for this month.</p>
  }
  const thBase = 'text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-white/50 py-2 whitespace-nowrap'
  return (
    <div className="border border-gray-200 dark:border-white/10 rounded-2xl [overflow:clip] bg-white dark:bg-primary/30">
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col />
          <col className="w-[76px]" />
          <col className="w-[76px]" />
          <col className="w-[64px]" />
        </colgroup>
        <thead>
          <tr className="bg-gray-50 dark:bg-white/[0.04] border-b border-gray-200 dark:border-white/10">
            <th className={`${thBase} pl-3 text-left`}>Agent</th>
            <th className={`${thBase} text-right`}>Issued</th>
            <th className={`${thBase} text-right`}>Target</th>
            <th className={`${thBase} pr-3 text-right`}>Weekly</th>
          </tr>
        </thead>
        {agentRows.map(r => (
          <PhoneAgentRow key={r.sfg_id} row={r} weekColumns={weekColumns} onCellClick={onCellClick} />
        ))}
      </table>
    </div>
  )
}

function PhoneAgentRow({ row: r, weekColumns, onCellClick }) {
  const [open, setOpen] = useState(false)
  const showWeekly = weekColumns.length > 0 && r.submissionStatus !== 'suppress'
  const weeksDone  = weekColumns.filter(wk => r.agentWeekNums.has(wk.numStr)).length
  // Met / near states keep their highlight; "not there yet" stays readable on a phone
  // (the wide table's faint grey is too light at this size)
  const tone       = status => (['green', 'yellow', 'orange'].includes(status) ? hlCls(status) : 'text-gray-600 dark:text-white/60')
  const target     = r.promoQual?.regular
  const dash       = <span className="text-gray-400 dark:text-white/35">—</span>

  return (
    <tbody className="border-b border-gray-100 dark:border-white/5 last:border-b-0">
      {/* The whole row toggles; the button inside is the keyboard / screen-reader control (its click bubbles up) */}
      <tr onClick={() => setOpen(o => !o)} className="cursor-pointer active:bg-gray-50 dark:active:bg-white/5">
        <td className="pl-3 pr-1 py-0.5">
          <button type="button" aria-expanded={open} aria-label={`${r.name || r.sfg_id}, ${open ? 'collapse' : 'expand'} details`}
            className="flex items-center gap-1.5 w-full min-h-[44px] text-left">
            <svg className={`w-3.5 h-3.5 shrink-0 transition-transform text-gray-500 dark:text-white/50 ${open ? '' : '-rotate-90'}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
            <span className="min-w-0 break-words text-[13px] font-semibold leading-snug text-gray-900 dark:text-white">{r.name || r.sfg_id}</span>
          </button>
        </td>
        <td className={`py-0.5 text-right text-[13px] tabular-nums ${r.teamIssued < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
          {r.teamIssued !== 0 ? fmtAmt(r.teamIssued) : dash}
        </td>
        <td className="py-0.5 text-right text-[13px] tabular-nums">
          {target != null ? <span className={`px-1.5 py-0.5 ${tone(r.promoStat.apv)}`}>{fmtAmt(target)}</span> : dash}
        </td>
        <td className="pr-3 py-0.5 text-right text-[13px] tabular-nums">
          {showWeekly ? <span className={`px-1.5 py-0.5 ${tone(r.submissionStatus)}`}>{weeksDone}/{weekColumns.length}</span> : dash}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={4} className="bg-gray-50/70 dark:bg-white/[0.03] border-t border-gray-100 dark:border-white/5">
            <AgentDetail row={r} weekColumns={weekColumns} onCellClick={onCellClick} />
          </td>
        </tr>
      )}
    </tbody>
  )
}

// One tappable APV figure. Behaves like a table cell: opens the policy breakdown when
// there is something behind it, otherwise shows a muted dash.
function FigureButton({ label, value, config, onCellClick }) {
  const hasChargebacks = (config?.cbPols?.length ?? 0) > 0 || (config?.likelyCbPols?.length ?? 0) > 0
  const clickable = !!config && (value !== 0 || hasChargebacks)
  const tone = value > 0 ? 'text-gray-900 dark:text-white'
             : value < 0 ? 'text-red-600 dark:text-red-400'
             :             'text-gray-400 dark:text-white/35'
  const body = (
    <>
      <span className="block text-xs text-gray-600 dark:text-white/60">{label}</span>
      <span className={`block text-[15px] font-bold tabular-nums mt-0.5 ${tone}`}>
        {(value !== 0 || clickable) ? fmtAmt(value) : '—'}
      </span>
    </>
  )
  return clickable ? (
    <button
      type="button"
      onClick={() => onCellClick(config)}
      className="flex flex-col items-start justify-start text-left min-w-0 min-h-[56px] -mx-1 px-1 py-1 rounded-lg active:bg-gray-100 dark:active:bg-white/10"
    >
      {body}
    </button>
  ) : (
    <div className="flex flex-col items-start justify-start min-w-0 min-h-[56px] -mx-1 px-1 py-1">{body}</div>
  )
}

function CardAccordion({ title, summary, children }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t border-gray-200 dark:border-white/10">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 min-h-[48px] text-left"
      >
        <span className="text-[15px] font-semibold text-gray-900 dark:text-white">{title}</span>
        <span className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-white/70 min-w-0">
          <span className="truncate">{summary}</span>
          <svg className={`w-4 h-4 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </span>
      </button>
      {open && <div className="pb-3">{children}</div>}
    </div>
  )
}

function AgentDetail({ row: r, weekColumns, onCellClick }) {
  const mc = modalConfigsFor(r)
  const showWeekly   = weekColumns.length > 0 && r.submissionStatus !== 'suppress'
  const weeksPresent = weekColumns.filter(wk => r.agentWeekNums.has(wk.numStr))
  const hl = (value, status, fmt = v => v) => (
    value == null
      ? <span className="text-gray-400 dark:text-white/35">—</span>
      : <span className={`px-1.5 py-0.5 ${hlCls(status)}`}>{fmt(value)}</span>
  )
  const target = (label, node) => (
    <div className="min-w-0">
      <span className="block text-xs text-gray-600 dark:text-white/60">{label}</span>
      <span className="block text-[15px] font-bold tabular-nums mt-0.5 text-gray-900 dark:text-white">{node}</span>
    </div>
  )

  return (
    <div className="px-4 pb-1 [&>div:first-child]:border-t-0">
      <CardAccordion title="Agent" summary={`Issued ${fmtAmt(r.agentIssued)}`}>
        <div className="grid grid-cols-4 gap-2">
          <FigureButton label="Submitted"  value={r.agentSubmitted}  config={mc.agentSubmitted}  onCellClick={onCellClick} />
          <FigureButton label="Issued"     value={r.agentIssued}     config={mc.agentIssued}     onCellClick={onCellClick} />
          <FigureButton label="Pending"    value={r.agentPending}    config={mc.agentPending}    onCellClick={onCellClick} />
          <FigureButton label="Incomplete" value={r.agentIncomplete} config={mc.agentIncomplete} onCellClick={onCellClick} />
        </div>
      </CardAccordion>

      <CardAccordion title="Team" summary={`Issued ${fmtAmt(r.teamIssued)}`}>
        <div className="grid grid-cols-4 gap-2">
          <FigureButton label="Issued"     value={r.teamIssued}     config={mc.teamIssued}     onCellClick={onCellClick} />
          <FigureButton label="Pending"    value={r.teamPending}    config={mc.teamPending}    onCellClick={onCellClick} />
          <FigureButton label="Incomplete" value={r.teamIncomplete} config={mc.teamIncomplete} onCellClick={onCellClick} />
          <div className="min-w-0 min-h-[56px] py-1">
            <span className="block text-xs text-gray-600 dark:text-white/60">Writers</span>
            <span className={`block text-[15px] font-bold tabular-nums mt-0.5 ${r.hasDownlines && r.writers > 0 ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-white/35'}`}>
              {r.hasDownlines && r.writers > 0 ? r.writers : '—'}
            </span>
          </div>
        </div>
      </CardAccordion>

      {r.promoQual && (
        <CardAccordion title="Promotion targets" summary={r.promoQual.regular != null ? `APV ${fmtAmt(r.promoQual.regular)}` : '—'}>
          <div className="grid grid-cols-3 gap-2">
            {target('APV',       hl(r.promoQual.regular,   r.promoStat.apv,       fmtAmt))}
            {target('Slingshot', hl(r.promoQual.slingshot, r.promoStat.slingshot, fmtAmt))}
            {target('Writers',   hl(r.promoQual.writers,   r.promoStat.writers))}
          </div>
        </CardAccordion>
      )}

      {r.hasDownlines && r.leadQual && (
        <CardAccordion title="Leadership targets" summary={r.leadQual.regular != null ? `APV ${fmtAmt(r.leadQual.regular)}` : '—'}>
          <div className="grid grid-cols-3 gap-2">
            {target('APV',     hl(r.leadQual.regular, r.leadStat.apv,     fmtAmt))}
            {target('Writers', hl(r.leadQual.writers, r.leadStat.writers))}
          </div>
        </CardAccordion>
      )}

      {showWeekly && (
        <CardAccordion title="Weekly" summary={`${weeksPresent.length} of ${weekColumns.length} weeks`}>
          <div className="flex flex-wrap gap-2">
            {weekColumns.map(wk => {
              const hasIt = r.agentWeekNums.has(wk.numStr)
              return (
                <span key={wk.numStr} className="text-sm tabular-nums">
                  {hasIt
                    ? <span className={`px-2 py-1 inline-block ${hlCls(r.submissionStatus)}`}>{wk.label}</span>
                    : <span className="px-2 py-1 inline-block text-gray-400 dark:text-white/35">—</span>}
                </span>
              )
            })}
          </div>
        </CardAccordion>
      )}
    </div>
  )
}

// ─── Agent Row ─────────────────────────────────────────────────────────────────

function AgentRow({ row: r, weekColumns, isEven, onCellClick }) {
  const BL       = 'border-l border-gray-100 dark:border-white/5 '
  const rowBg    = isEven ? 'bg-white dark:bg-transparent' : 'bg-gray-50/50 dark:bg-white/[0.018]'
  const stickyBg = isEven ? 'bg-white dark:bg-secondary'  : 'bg-gray-50 dark:bg-secondary'
  const mc       = modalConfigsFor(r)

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
      {apvCell(r.agentSubmitted,  true,  mc.agentSubmitted)}
      {apvCell(r.agentIssued,     false, mc.agentIssued)}
      {apvCell(r.agentPending,    false, mc.agentPending)}
      {apvCell(r.agentIncomplete, false, mc.agentIncomplete)}

      {/* Team APVs */}
      {apvCell(r.teamIssued,     true,  mc.teamIssued)}
      {apvCell(r.teamPending,    false, mc.teamPending)}
      {apvCell(r.teamIncomplete, false, mc.teamIncomplete)}
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
