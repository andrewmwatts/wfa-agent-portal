import { Fragment, useMemo, useState } from 'react'
import { fmtCurrency as fmtAmt } from '../../utils/format'
import {
  nextContractLevel, nextLeadershipLevel, previousContractLevel, contractLevelRank,
} from '../../../shared/commissionLevel'
import {
  buildDownlineTree, computeTeamIssued, computeMaxLegApv,
  legRulePreventsQual, fridayWeekCount, fridayDatesOfMonth, submissionRequirementMet,
} from '../../../shared/promotionQualification'

// Leadership titles carry no carrier appointment level, so the restructure rules
// and the contract/leadership track split both key off this.
const LEADERSHIP_LEVELS = new Set(['TL', 'KL', 'AO'])

const INPUT_CLS = 'w-full rounded-lg border border-gray-300 dark:border-white/20 bg-white dark:bg-white/5 text-gray-900 dark:text-white text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent/50'

function fmtApv(n) {
  if (n == null && n !== 0) return '—'
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// On-screen agent name — the friendly/preferred name, falling back to the Opt
// name. Jotform copy blocks deliberately keep the raw Opt name instead (see
// buildJotformLines): that payload is submitted to SFG and has to match theirs.
function agentName(person, fallback = '') {
  return person?.preferred_name?.trim() || person?.opt_name?.trim() || fallback
}

function fmtMonth(isoMonth) {
  if (!isoMonth) return '—'
  const [y, m] = isoMonth.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

// Thin fetch wrapper that surfaces non-2xx responses instead of failing silently.
async function apiRequest(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const data = await res.json()
      if (data?.error) message = data.detail ? `${data.error}: ${data.detail}` : data.error
    } catch { /* non-JSON error body */ }
    throw new Error(message)
  }
  return res.status === 204 ? null : res.json()
}

function CopyBlock({ lines }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(lines.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/15 overflow-hidden mt-2">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-white/5 border-b border-gray-200 dark:border-white/10">
        <span className="text-xs font-semibold text-gray-400 dark:text-white/40 uppercase tracking-wider">Jotform Copy Block</span>
        <button onClick={copy} className="text-xs text-accent hover:text-accent/80 font-medium">
          {copied ? '✓ Copied' : 'Copy All'}
        </button>
      </div>
      <div className="px-3 py-3 font-mono text-xs text-gray-700 dark:text-white/70 space-y-0.5">
        {lines.map((l, i) => <div key={i} className="select-all whitespace-pre">{l}</div>)}
      </div>
    </div>
  )
}

function buildJotformLines(person, apv, writers, monthNum, promoType, cycleMonth, existing, submissionWeeks = []) {
  const fmt$ = n => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const name  = person?.opt_name ?? ''
  const sfgId = person?.sfg_id ?? ''
  const level = person?.commission_level ?? ''

  const base = [name, sfgId, level]

  if (promoType === 'Slingshot') {
    // Slingshot also requires personal weekly submissions, so the form needs the
    // specific business weeks the agent submitted in.
    const lines = [...base, 'Slingshot Qualification', fmtMonth(cycleMonth), fmt$(apv), `${writers} writers`]
    if (submissionWeeks.length) lines.push(`Submission weeks: ${submissionWeeks.join(', ')}`)
    return lines
  }
  if (promoType === 'TL' || promoType === 'KL') {
    const lines = [...base, `${promoType} Qualification Month ${monthNum}`, fmtMonth(cycleMonth), fmt$(apv), `${writers} writers`]
    if (existing?.month_1) lines.push(`Month 1: ${fmtMonth(existing.month_1)}`)
    if (existing?.month_2) lines.push(`Month 2: ${fmtMonth(existing.month_2)}`)
    return lines
  }
  if (promoType === 'AO') {
    const lines = [name, sfgId, 'Agency Owner', `AO Qualification Month ${monthNum}`, fmtMonth(cycleMonth), fmt$(apv), `${writers} writers`]
    if (existing?.month_1) lines.push(`Month 1: ${fmtMonth(existing.month_1)}`)
    if (existing?.month_2) lines.push(`Month 2: ${fmtMonth(existing.month_2)}`)
    return lines
  }
  // Standard
  const lines = [...base, `Standard Qualification Month ${monthNum}`, fmtMonth(cycleMonth), fmt$(apv), `${writers} writers`]
  if (existing?.month_1) lines.push(`Month 1: ${fmtMonth(existing.month_1)}`)
  if (existing?.month_2) lines.push(`Month 2: ${fmtMonth(existing.month_2)}`)
  return lines
}

// ── Manual Promotion Modal ─────────────────────────────────────────────────────
function ManualPromoModal({ personnel, cycleId, onClose, onSaved }) {
  const [sfgId,  setSfgId]  = useState('')
  const [type,   setType]   = useState('manual_promotion')
  const [notes,  setNotes]  = useState('')
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  const filtered = personnel
    // Match either name — an agent searched for by their friendly name should be
    // findable even when the roster stores a different Opt name, and vice versa.
    .filter(p => {
      if (!search) return true
      const term = search.toLowerCase()
      return (p.preferred_name ?? '').toLowerCase().includes(term)
          || (p.opt_name       ?? '').toLowerCase().includes(term)
          || (p.sfg_id         ?? '').toLowerCase().includes(term)
    })
    .slice(0, 8)
  const selected = personnel.find(p => p.sfg_id === sfgId)

  async function save() {
    if (!sfgId) return
    setSaving(true)
    try {
      await apiRequest('/api/snapshot?type=promotions', 'POST', {
        cycle_id: cycleId, sfg_id: sfgId, action_type: type, is_manual: true, notes: notes || null,
      })
      onSaved()
      onClose()
    } catch (err) {
      alert(err.message || 'Failed to save promotion.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-base font-bold text-gray-900 dark:text-white">Log Manual Promotion</h2>

        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-white/50 mb-1">Agent</label>
          {selected ? (
            <div className="flex items-center justify-between rounded-lg border border-gray-300 dark:border-white/20 px-3 py-2">
              <span className="text-sm text-gray-900 dark:text-white">{agentName(selected, selected.sfg_id)} <span className="text-gray-400 text-xs">{selected.sfg_id}</span></span>
              <button onClick={() => setSfgId('')} className="text-xs text-gray-400 hover:text-red-500 ml-2">×</button>
            </div>
          ) : (
            <div className="space-y-1">
              <input value={search} onChange={e => setSearch(e.target.value)} className={INPUT_CLS} placeholder="Search by name or ID…" autoFocus />
              {search && (
                <div className="rounded-lg border border-gray-200 dark:border-white/15 overflow-hidden">
                  {filtered.map(p => (
                    <button key={p.sfg_id} onClick={() => { setSfgId(p.sfg_id); setSearch('') }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-white/5 text-gray-900 dark:text-white border-b border-gray-100 dark:border-white/10 last:border-0">
                      {agentName(p, p.sfg_id)} <span className="text-gray-400 text-xs">{p.sfg_id}</span>
                    </button>
                  ))}
                  {!filtered.length && <div className="px-3 py-2 text-xs text-gray-400">No results</div>}
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-white/50 mb-1">Action Type</label>
          <select value={type} onChange={e => setType(e.target.value)} className={INPUT_CLS}>
            <option value="manual_promotion">Manual Promotion</option>
            <option value="promotion">Promotion</option>
            <option value="streak_reset">Streak Reset</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-white/50 mb-1">Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} className={INPUT_CLS} rows={3} placeholder="Optional notes…" />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-white/60 hover:bg-gray-100 dark:hover:bg-white/10">Cancel</button>
          <button onClick={save} disabled={!sfgId || saving}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-white hover:bg-accent/90 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function Step3Promotions({ cycle, promotions, context, canWrite, onCycleClose, onRefresh }) {
  const {
    personnel    = [],
    qualifications = [],
    promotions: agentPromos = [],
    monthPolicies = [],
    chargebacksByAgent    = {},
    submittedWeeksByAgent = {},
    submittedInMonth      = [],
  } = context ?? {}

  const [saving,       setSaving]       = useState(null)
  const [manualModal,  setManualModal]  = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [jotformOpen,  setJotformOpen]  = useState(new Set())

  const readOnly   = !!cycle?.completed_at || !canWrite
  const cycleMonth = cycle?.month

  // ── Lookup maps ──────────────────────────────────────────────────────────────
  const personnelMap = useMemo(() => {
    const m = {}
    for (const p of personnel) m[p.sfg_id?.toUpperCase()] = p
    return m
  }, [personnel])

  // Keyed by "SFGID||LEVEL" so an agent can have separate in-progress rows per track
  const agentPromoMap = useMemo(() => {
    const m = {}
    for (const ap of agentPromos) {
      const id = ap.sfg_id?.toUpperCase()
      if (id && ap.level) m[`${id}||${ap.level}`] = ap
    }
    return m
  }, [agentPromos])

  // Persisted skips for this cycle, keyed by "SFGID||LEVEL"
  const skippedSet = useMemo(() => {
    const s = new Set()
    for (const a of promotions) {
      const id = a.sfg_id?.toUpperCase()
      if (a.action_type === 'skipped' && id && a.level) s.add(`${id}||${a.level}`)
    }
    return s
  }, [promotions])

  const qualByLevel = useMemo(() => {
    const m = {}
    for (const q of qualifications) if (q.level) m[q.level.toLowerCase()] = q
    return m
  }, [qualifications])

  // ── Downline tree + team qualification inputs (mirrors Monthly Agent Totals) ──
  const { descendantsOf, directChildrenOf } = useMemo(() => buildDownlineTree(personnel), [personnel])

  // Issued policies keyed by lowercased sfg_id (for team rollup, cap, and leg rule)
  const issuedPolsBySfgId = useMemo(() => {
    const m = {}
    for (const p of monthPolicies) {
      const id = p.sfg_id?.toLowerCase()
      if (!id) continue
      ;(m[id] ??= []).push(p)
    }
    return m
  }, [monthPolicies])

  // Chargebacks keyed lowercase to match the tree ids
  const chargebacksLower = useMemo(() => {
    const m = {}
    for (const [k, v] of Object.entries(chargebacksByAgent)) m[k.toLowerCase()] = v
    return m
  }, [chargebacksByAgent])

  // Agents (any depth) who submitted a policy this month — for the writers count
  const submittedSet = useMemo(
    () => new Set(submittedInMonth.map(id => id.toLowerCase())),
    [submittedInMonth],
  )

  // Personal submitted-week counts, keyed uppercase (for the slingshot requirement)
  const submittedWeekCount = useMemo(() => {
    const m = {}
    for (const [k, weeks] of Object.entries(submittedWeeksByAgent)) m[k.toUpperCase()] = weeks.length
    return m
  }, [submittedWeeksByAgent])

  const fridayCount = useMemo(() => {
    if (!cycleMonth) return 4
    const [y, mo] = String(cycleMonth).slice(0, 7).split('-').map(Number)
    return fridayWeekCount(y, mo - 1)
  }, [cycleMonth])

  // Personal submitted weeks as M/D labels (e.g. "7/3"), keyed uppercase — the
  // slingshot Jotform lists the specific weeks the agent submitted in. The API
  // returns week numbers, which index into the month's Fridays.
  const submittedWeekLabels = useMemo(() => {
    if (!cycleMonth) return {}
    const [y, mo]  = String(cycleMonth).slice(0, 7).split('-').map(Number)
    const fridays  = fridayDatesOfMonth(y, mo - 1)
    const m = {}
    for (const [k, weeks] of Object.entries(submittedWeeksByAgent)) {
      m[k.toUpperCase()] = (weeks ?? [])
        .map(w => parseInt(String(w).trim(), 10))
        .filter(n => Number.isFinite(n) && n >= 1 && n <= fridays.length)
        .sort((a, b) => a - b)
        .map(n => {
          const d = fridays[n - 1]
          return `${d.getMonth() + 1}/${d.getDate()}`
        })
    }
    return m
  }, [submittedWeeksByAgent, cycleMonth])

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function getThresholds(level) {
    // qualifications rows use string keys matching the level values exactly
    return qualByLevel[String(level).toLowerCase()] ?? qualByLevel[String(level)] ?? null
  }

  function meetsThreshold(q, apv, writers) {
    if (!q) return false
    return apv >= (Number(q.regular) || 0) && writers >= (Number(q.writers) || 0)
  }

  function isSlingshot(q, apv) {
    return !!(q?.slingshot && apv >= Number(q.slingshot))
  }

  // Carrier appointment rule: two vertically-stacked agents can't sit at the
  // same-or-higher contract level at the carrier, even though they stay
  // stacked internally in Symmetry. Two flags, both contract-level only:
  //
  //   moveOut    — this agent's current contract level has reached or passed
  //                their upline's current level → carrier paperwork needed
  //                to detach them from the upline.
  //   moveBackIn — this agent (as an upline) just promoted, and the new
  //                level now exceeds a direct downline who was previously
  //                tied-or-ahead of them → carrier paperwork needed to
  //                reattach that downline underneath them again.
  function restructureFlags(sfgId) {
    const id     = sfgId?.toUpperCase()
    const person = personnelMap[id]
    const upline = personnelMap[person?.upline_sfg_id?.toUpperCase()]

    const myRank     = contractLevelRank(person?.commission_contract?.level)
    const uplineRank = contractLevelRank(upline?.commission_contract?.level)
    const moveOut     = !!(upline && myRank != null && uplineRank != null && myRank >= uplineRank)

    const prevRank = contractLevelRank(previousContractLevel(person?.commission_contract?.level))
    const moveBackIn = myRank != null && prevRank != null && personnel.some(p => {
      if (p.upline_sfg_id?.toUpperCase() !== id) return false
      const downRank = contractLevelRank(p.commission_contract?.level)
      return downRank != null && downRank >= prevRank && downRank < myRank
    })

    return { moveOut, moveBackIn, any: moveOut || moveBackIn }
  }

  // Team qualifying APV (capped for the target level, net chargebacks) + largest leg.
  function teamNumbers(lowerId, targetLevel) {
    const descSet = descendantsOf[lowerId] ?? new Set([lowerId])
    return {
      teamApv: computeTeamIssued(descSet, issuedPolsBySfgId, chargebacksLower, targetLevel),
      maxLeg:  computeMaxLegApv(directChildrenOf[lowerId] ?? [], descendantsOf, issuedPolsBySfgId, targetLevel),
      writers: [...descSet].filter(tid => submittedSet.has(tid)).length,
    }
  }

  // Tracks already finalized this cycle. A promotion takes effect for the FOLLOWING
  // month's qualification, so an agent who promoted (standard final month or
  // slingshot) must not immediately reappear as a candidate for the next level in
  // the same cycle. Kept per-track so a simultaneous contract + leadership
  // qualification still shows both.
  const promotedTracksThisCycle = useMemo(() => {
    const s = new Set()
    for (const a of promotions) {
      if (!['promotion', 'manual_promotion'].includes(a.action_type)) continue
      const id = a.sfg_id?.toUpperCase()
      if (!id) continue
      if (a.level) {
        s.add(`${id}||${LEADERSHIP_LEVELS.has(a.level) ? 'leadership' : 'contract'}`)
      } else {
        // Manual promotions carry no level — the agent was handled by hand, so
        // suppress both tracks rather than guessing which one was promoted.
        s.add(`${id}||contract`)
        s.add(`${id}||leadership`)
      }
    }
    return s
  }, [promotions])

  // Whether this level already has the cycle's month recorded against it. The
  // month markers on agent_promotions are the source of truth; without this a
  // level logged earlier in the cycle re-derives a month number and is offered
  // again (a logged Month 2 would come back around as Month 1).
  function creditedThisCycle(existing) {
    if (!existing || !cycleMonth) return false
    return [existing.month_1, existing.month_2, existing.month_3, existing.slingshot_month]
      .some(m => m && String(m).slice(0, 7) === cycleMonth)
  }

  // Next unrecorded month for a level — derived from how many months are actually
  // on the record rather than by walking a chain of conditions, which fell through
  // to 1 whenever the expected shape didn't match.
  function nextMonthNumber(existing, totalMonths) {
    const recorded = [existing?.month_1, existing?.month_2, existing?.month_3].filter(Boolean).length
    return Math.min(recorded + 1, totalMonths)
  }

  // ── Qualifying agents ────────────────────────────────────────────────────────
  // Each entry represents one qualifying opportunity (contract OR leadership track).
  // A single agent may appear twice if they're qualifying on both tracks simultaneously.
  // Qualification is evaluated on TEAM issued APV (net chargebacks), gated by the
  // 50% leg rule and the $7,500/policy cap for 125/130 — matching Monthly Agent Totals.
  const qualifyingAgents = useMemo(() => {
    const result = []

    for (const person of personnel) {
      const sfgId   = person.sfg_id?.toUpperCase()
      const lowerId = person.sfg_id?.toLowerCase()
      if (!sfgId) continue

      const flags = restructureFlags(sfgId)

      // ── Contract track ────────────────────────────────────────────────────
      const nextContract = nextContractLevel(person.commission_contract?.level ?? '80')
      if (nextContract && !skippedSet.has(sfgId + '||' + nextContract) &&
          !promotedTracksThisCycle.has(sfgId + '||contract')) {
        const q = getThresholds(nextContract)
        const { teamApv, maxLeg, writers } = teamNumbers(lowerId, nextContract)

        // Standard qualification: regular APV + writers met, leg rule satisfied
        const regularMet = meetsThreshold(q, teamApv, writers) &&
                           !legRulePreventsQual(teamApv, q?.regular, maxLeg)

        // Slingshot: higher APV bar + personal weekly submissions, leg rule satisfied
        const submissionMet = submissionRequirementMet(submittedWeekCount[sfgId] ?? 0, fridayCount)
        const slingEligible = isSlingshot(q, teamApv) && submissionMet &&
                              !legRulePreventsQual(teamApv, q?.slingshot, maxLeg)

        if ((regularMet || slingEligible)) {
          const existing = agentPromoMap[`${sfgId}||${nextContract}`] ?? null
          if (!existing?.is_qualified && !creditedThisCycle(existing)) {
            const months   = Number(q?.months) || 2
            const monthNum = nextMonthNumber(existing, months)

            const key = `${sfgId}||contract||${nextContract}||${monthNum}`
            // Matches on level+track rather than month_number: a slingshot action
            // records no month_number, so comparing it would never match.
            const alreadyLogged = promotions.some(
              a => a.sfg_id?.toUpperCase() === sfgId && a.level === nextContract &&
                   ['promotion', 'qualifying_month'].includes(a.action_type)
            )
            if (!alreadyLogged) {
              result.push({
                key, person, sfgId, apv: teamApv, writers, monthNum,
                track: 'contract',
                targetLevel: nextContract,
                promoType:   'Standard',
                slingEligible,
                existing,
                flags,
                totalMonths: months,
              })
            }
          }
        }
      }

      // ── Leadership track ──────────────────────────────────────────────────
      const nextLeadership = nextLeadershipLevel(person.commission_leadership?.level ?? null)
      if (nextLeadership && !skippedSet.has(sfgId + '||' + nextLeadership) &&
          !promotedTracksThisCycle.has(sfgId + '||leadership')) {
        const q = getThresholds(nextLeadership)
        const { teamApv, maxLeg, writers } = teamNumbers(lowerId, nextLeadership)
        const regularMet = meetsThreshold(q, teamApv, writers) &&
                           !legRulePreventsQual(teamApv, q?.regular, maxLeg)
        if (regularMet) {
          const existing = agentPromoMap[`${sfgId}||${nextLeadership}`] ?? null
          if (!existing?.is_qualified && !creditedThisCycle(existing)) {
            const months   = Number(q?.months) || 2
            const monthNum = nextMonthNumber(existing, months)

            const key = `${sfgId}||leadership||${nextLeadership}||${monthNum}`
            const alreadyLogged = promotions.some(
              a => a.sfg_id?.toUpperCase() === sfgId && a.level === nextLeadership &&
                   ['promotion', 'qualifying_month'].includes(a.action_type)
            )
            if (!alreadyLogged) {
              result.push({
                key, person, sfgId, apv: teamApv, writers, monthNum,
                track: 'leadership',
                targetLevel: nextLeadership,
                promoType:   nextLeadership,
                slingEligible: false,
                existing,
                flags,
                totalMonths: months,
              })
            }
          }
        }
      }
    }

    return result.sort((a, b) => agentName(a.person).localeCompare(agentName(b.person)))
  }, [personnel, descendantsOf, directChildrenOf, issuedPolsBySfgId, chargebacksLower, submittedSet, submittedWeekCount, fridayCount, agentPromoMap, qualByLevel, promotions, skippedSet, promotedTracksThisCycle, cycleMonth])

  // ── Broken streaks ───────────────────────────────────────────────────────────
  const brokenStreaks = useMemo(() => {
    const qualifyingIds = new Set(qualifyingAgents.map(q => q.sfgId))
    return agentPromos
      .filter(ap => {
        if (ap.is_qualified || ap.month_3) return false
        if (!ap.month_1) return false
        if (ap.month_1?.slice(0, 7) === cycleMonth) return false  // started this cycle
        if (ap.month_2?.slice(0, 7) === cycleMonth) return false  // completed this cycle
        return !qualifyingIds.has(ap.sfg_id?.toUpperCase())
      })
      .map(ap => {
        const lowerId = ap.sfg_id?.toLowerCase()
        const descSet = descendantsOf[lowerId] ?? new Set([lowerId])
        return {
          ...ap,
          person: personnelMap[ap.sfg_id?.toUpperCase()],
          // No level-specific cap here — the target level for an in-progress
          // streak isn't fixed. The universal post-cutoff cap still applies.
          apv: computeTeamIssued(descSet, issuedPolsBySfgId, chargebacksLower, null),
        }
      })
      .sort((a, b) => agentName(a.person).localeCompare(agentName(b.person)))
  }, [agentPromos, qualifyingAgents, cycleMonth, personnelMap, descendantsOf, issuedPolsBySfgId, chargebacksLower])

  const finalizedActions = promotions.filter(
    a => a.action_type === 'promotion' || a.action_type === 'manual_promotion'
  )

  // Intermediate month logs (e.g. Month 1 of 2) recorded this cycle — these drop
  // out of "Qualifying Months" above once logged, so surface them here instead
  // of letting them disappear until the agent finally qualifies.
  const intermediateActions = useMemo(() => {
    return promotions
      .filter(a => a.action_type === 'qualifying_month')
      .map(a => {
        const sfgId    = a.sfg_id?.toUpperCase()
        const existing = sfgId && a.level ? agentPromoMap[`${sfgId}||${a.level}`] : null
        const totalMonths = Number(getThresholds(a.level)?.months) || 2
        return { ...a, person: personnelMap[sfgId], existing, totalMonths }
      })
      .sort((a, b) => agentName(a.person).localeCompare(agentName(b.person)))
  }, [promotions, agentPromoMap, personnelMap, qualByLevel])

  // Restructure flags are contract-level only (leadership titles don't carry
  // a carrier appointment level, so the same-level-as-upline rule doesn't apply).
  const unresolvedFlags = finalizedActions.filter(
    a => !LEADERSHIP_LEVELS.has(a.level) && restructureFlags(a.sfg_id).any && !a.hierarchy_flag_noted
  )

  // Reconstructs the Jotform copy text for an already-finalized promotion —
  // standard final-month and slingshot both land here (both post action_type
  // 'promotion'), so this covers both instead of only the pre-finalize preview
  // in the Qualifying Months section above, which disappears once logged.
  function finalizedJotformLines(a) {
    const sfgId = a.sfg_id?.toUpperCase()
    const level = a.level
    const person = personnelMap[sfgId]
    if (!sfgId || !level || !person) return null
    const existing  = agentPromoMap[`${sfgId}||${level}`] ?? null
    const promoType = existing?.is_slingshot ? 'Slingshot' : (LEADERSHIP_LEVELS.has(level) ? level : 'Standard')
    const { teamApv, writers } = teamNumbers(sfgId.toLowerCase(), level)
    const monthNum = a.month_number ?? (existing?.month_3 ? 3 : existing?.month_2 ? 2 : 1)
    return buildJotformLines(person, teamApv, writers, monthNum, promoType, cycleMonth, existing,
                             submittedWeekLabels[sfgId] ?? [])
  }

  // ── Actions ──────────────────────────────────────────────────────────────────
  async function logMonth(sfgId, monthNum, promoType, targetLevel, existing, totalMonths, track) {
    setSaving(sfgId + '-' + targetLevel + '-month')
    try {
      const isFinal = monthNum >= totalMonths

      await apiRequest('/api/snapshot?type=agent_promotion', 'POST', {
        sfg_id:         sfgId,
        // agent_promotions.promotion_type is a DB category constrained to
        // 'commission' | 'leadership' | 'badge' — not the display label
        // (Standard/Slingshot/TL/KL/AO), which is `promoType` below.
        promotion_type: track === 'contract' ? 'commission' : 'leadership',
        level:          targetLevel,
        month_1:        monthNum === 1 ? cycleMonth : (existing?.month_1 ?? null),
        month_2:        monthNum === 2 ? cycleMonth : (existing?.month_2 ?? null),
        month_3:        (isFinal && totalMonths === 3) ? cycleMonth : (existing?.month_3 ?? null),
        // Standard month-by-month path is never a slingshot — slingshot has its
        // own action (logSlingshot), which records slingshot_month instead.
        is_slingshot:   false,
        is_qualified:   isFinal,
        qualified_date: isFinal ? new Date().toISOString().slice(0, 10) : null,
      })

      await apiRequest('/api/snapshot?type=promotions', 'POST', {
        cycle_id:     cycle.id,
        sfg_id:       sfgId,
        action_type:  isFinal ? 'promotion' : 'qualifying_month',
        month_number: monthNum,
        level:        targetLevel,
      })

      if (isFinal) setJotformOpen(prev => new Set([...prev, sfgId + '||' + targetLevel]))
      await onRefresh()
    } catch (err) {
      alert(err.message || 'Failed to log promotion month.')
    } finally {
      setSaving(null)
    }
  }

  // Slingshot: a single-month qualification (higher APV bar + weekly submissions).
  // Records slingshot_month and finalizes immediately, clearing any partial
  // month-by-month progress toward the same level.
  async function logSlingshot(sfgId, targetLevel, track) {
    setSaving(sfgId + '-' + targetLevel + '-sling')
    try {
      await apiRequest('/api/snapshot?type=agent_promotion', 'POST', {
        sfg_id:          sfgId,
        promotion_type:  track === 'contract' ? 'commission' : 'leadership',
        level:           targetLevel,
        month_1:         null,
        month_2:         null,
        month_3:         null,
        slingshot_month: cycleMonth,
        is_slingshot:    true,
        is_qualified:    true,
        qualified_date:  new Date().toISOString().slice(0, 10),
      })

      await apiRequest('/api/snapshot?type=promotions', 'POST', {
        cycle_id:    cycle.id,
        sfg_id:      sfgId,
        action_type: 'promotion',
        level:       targetLevel,
      })

      setJotformOpen(prev => new Set([...prev, sfgId + '||' + targetLevel]))
      await onRefresh()
    } catch (err) {
      alert(err.message || 'Failed to log slingshot promotion.')
    } finally {
      setSaving(null)
    }
  }

  async function skipAgent(sfgId, targetLevel) {
    setSaving(sfgId + '-' + targetLevel + '-skip')
    try {
      await apiRequest('/api/snapshot?type=promotions', 'POST', {
        cycle_id: cycle.id, sfg_id: sfgId, action_type: 'skipped', level: targetLevel,
      })
      await onRefresh()
    } catch (err) {
      alert(err.message || 'Failed to skip.')
    } finally {
      setSaving(null)
    }
  }

  async function resetStreak(ap) {
    if (!ap.id) { alert('Cannot reset: no record ID.'); return }
    if (!confirm(`Reset ${agentName(ap.person, ap.sfg_id)}'s qualifying streak?`)) return
    setSaving(ap.sfg_id + '-reset')
    try {
      await Promise.all([
        apiRequest('/api/snapshot?type=agent_promotion', 'DELETE', { id: ap.id }),
        apiRequest('/api/snapshot?type=promotions', 'POST', { cycle_id: cycle.id, sfg_id: ap.sfg_id, action_type: 'streak_reset' }),
      ])
      await onRefresh()
    } catch (err) {
      alert(err.message || 'Failed to reset streak.')
    } finally {
      setSaving(null)
    }
  }

  // Resets every broken streak in one pass. Sequential rather than parallel so a
  // partial failure leaves a clear boundary, and so the count reported back is
  // the number actually reset.
  async function resetAllStreaks() {
    const targets = brokenStreaks.filter(ap => ap.id)
    if (!targets.length) return
    if (!confirm(`Reset all ${targets.length} broken streak${targets.length !== 1 ? 's' : ''}? This cannot be undone.`)) return
    setSaving('reset-all')
    let done = 0
    try {
      for (const ap of targets) {
        await apiRequest('/api/snapshot?type=agent_promotion', 'DELETE', { id: ap.id })
        await apiRequest('/api/snapshot?type=promotions', 'POST', {
          cycle_id: cycle.id, sfg_id: ap.sfg_id, action_type: 'streak_reset',
        })
        done++
      }
    } catch (err) {
      alert(`${err.message || 'Failed to reset streaks.'}\n\n${done} of ${targets.length} were reset.`)
    } finally {
      setSaving(null)
      await onRefresh()
    }
  }

  async function noteFlag(actionId) {
    setSaving(actionId)
    try {
      await apiRequest('/api/snapshot?type=promotion', 'PUT', { id: actionId, hierarchy_flag_noted: true })
      await onRefresh()
    } catch (err) {
      alert(err.message || 'Failed to note flag.')
    } finally {
      setSaving(null)
    }
  }

  async function submitJotform(actionId) {
    setSaving(actionId + '-jf')
    try {
      await apiRequest('/api/snapshot?type=promotion', 'PUT', { id: actionId, jotform_submitted_at: new Date().toISOString() })
      await onRefresh()
    } catch (err) {
      alert(err.message || 'Failed to mark jotform submitted.')
    } finally {
      setSaving(null)
    }
  }

  async function closeCycle() {
    setSaving('close')
    try {
      await apiRequest('/api/snapshot?type=cycle', 'PUT', { id: cycle.id, completed_at: new Date().toISOString() })
      onCycleClose()
    } catch (err) {
      alert(err.message || 'Failed to close cycle.')
    } finally {
      setSaving(null)
      setConfirmClose(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  if (!context) {
    return <div className="flex items-center justify-center py-16 text-sm text-gray-400 dark:text-white/40">Loading context…</div>
  }

  return (
    <div className="space-y-8">
      {/* Manual promotion button */}
      {!readOnly && (
        <div className="flex justify-end">
          <button onClick={() => setManualModal(true)}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-white hover:bg-accent/90 transition-colors">
            + Log Manual Promotion
          </button>
        </div>
      )}

      {/* ── A: Broken Streaks ──────────────────────────────────────────────────── */}
      {brokenStreaks.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white">
              Broken Streaks <span className="ml-1 text-xs font-normal text-red-500">{brokenStreaks.length} agent{brokenStreaks.length !== 1 ? 's' : ''}</span>
            </h2>
            {!readOnly && brokenStreaks.some(ap => ap.id) && (
              <button onClick={resetAllStreaks} disabled={!!saving}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/30 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50">
                {saving === 'reset-all' ? 'Resetting all…' : 'Reset All'}
              </button>
            )}
          </div>
          <div className="rounded-2xl border border-gray-200 dark:border-white/15 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-white/5 border-b border-gray-200 dark:border-white/10">
                <tr>
                  {['Agent', 'Level', 'Month 1', 'Month 2', 'This Month APV', 'APV Target', 'Writers Target', ''].map((h, i) => (
                    <th key={i} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-white/50">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/10">
                {brokenStreaks.map(ap => {
                  const q = getThresholds(ap.level)
                  return (
                    <tr key={ap.sfg_id} className="hover:bg-gray-50/50 dark:hover:bg-white/[0.02]">
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{agentName(ap.person, ap.sfg_id)}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-white/50">{ap.level}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-white/50">{fmtMonth(ap.month_1)}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-white/50">{ap.month_2 ? fmtMonth(ap.month_2) : '—'}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-white/50">{fmtApv(ap.apv)}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-white/50">{q?.regular != null ? fmtApv(q.regular) : '—'}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-white/50">{q?.writers ?? '—'}</td>
                      <td className="px-4 py-3">
                        {!readOnly && (
                          <button onClick={() => resetStreak(ap)} disabled={saving === ap.sfg_id + '-reset'}
                            className="px-2.5 py-1 rounded-lg text-xs font-semibold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/30 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50">
                            {saving === ap.sfg_id + '-reset' ? 'Resetting…' : 'Reset Streak'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── B: Qualifying Months ───────────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-bold text-gray-900 dark:text-white mb-3">
          Qualifying Months
          {qualifyingAgents.length > 0 && <span className="ml-1 text-xs font-normal text-gray-400">{qualifyingAgents.length} detected</span>}
        </h2>
        {qualifyingAgents.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 dark:border-white/15 px-6 py-8 text-center text-sm text-gray-400 dark:text-white/40">
            No agents detected as qualifying this month.
          </div>
        ) : (
          <div className="space-y-3">
            {qualifyingAgents.map(({ key, person, sfgId, apv, writers, monthNum, promoType, targetLevel, track, existing, flags, totalMonths, slingEligible }) => {
              const isFinal     = monthNum >= totalMonths
              const slingSaving = sfgId + '-' + targetLevel + '-sling'
              const jotformKey  = sfgId + '||' + targetLevel
              const savingKey   = sfgId + '-' + targetLevel + '-month'
              // Slingshot finalizes in a single month, so its copy block has to be
              // available before logging — isFinal alone is false at month 1 of 2
              // and would hide it until after the promotion was already recorded.
              const showJotform = isFinal || slingEligible || jotformOpen.has(jotformKey)
              // Slingshot-eligible agents will log the single-month slingshot, so
              // show that Jotform format for them.
              const jotformLines = buildJotformLines(
                person, apv, writers, monthNum,
                slingEligible ? 'Slingshot' : promoType,
                cycleMonth, existing, submittedWeekLabels[sfgId] ?? [],
              )
              const currentLevelLabel = track === 'contract'
                ? `${person.commission_contract?.level ?? '80'}%`
                : (person.commission_leadership?.level ?? 'None')
              const q = getThresholds(targetLevel)

              return (
                <div key={key} className="rounded-2xl border border-gray-200 dark:border-white/15 overflow-hidden">
                  {/* Header */}
                  <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-gray-50 dark:bg-white/5 border-b border-gray-200 dark:border-white/10">
                    <span className="font-semibold text-gray-900 dark:text-white text-sm">{agentName(person, person.sfg_id)}</span>
                    <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-white/50">
                      {currentLevelLabel} → {track === 'contract' ? `${targetLevel}%` : targetLevel}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                      isFinal
                        ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400'
                        : 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400'
                    }`}>
                      {isFinal ? `FINAL — ${promoType}` : `Month ${monthNum}/${totalMonths} — ${promoType}`}
                    </span>
                    {track === 'contract' && flags.moveOut && (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-400" title="New level reaches or passes their upline's current level — carrier paperwork needed to detach them from their upline (stays stacked in Symmetry)">
                        Restructure: Move Out
                      </span>
                    )}
                    {track === 'contract' && flags.moveBackIn && (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-teal-100 dark:bg-teal-500/20 text-teal-700 dark:text-teal-400" title="This promotion puts them back above a downline that was previously tied-or-ahead — carrier paperwork needed to reattach that downline underneath them">
                        Restructure: Move Back In
                      </span>
                    )}
                    {slingEligible && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-400">⚡ Slingshot eligible</span>
                    )}
                    <div className="ml-auto flex items-center gap-3 text-xs text-gray-500 dark:text-white/50">
                      <span>{fmtApv(apv)}{q?.regular != null ? ` / ${fmtApv(q.regular)} target` : ''}</span>
                      <span>{writers} / {q?.writers ?? '—'} writer{Number(q?.writers) !== 1 ? 's' : ''}</span>
                      {q?.slingshot != null && (
                        <span className="text-purple-500 dark:text-purple-400">Slingshot: {fmtApv(q.slingshot)}</span>
                      )}
                    </div>
                  </div>

                  {/* Body */}
                  <div className="px-4 py-3 space-y-2">
                    {existing?.month_1 && (
                      <div className="text-xs text-gray-500 dark:text-white/50">
                        Month 1: {fmtMonth(existing.month_1)}
                        {existing.month_2 && ` · Month 2: ${fmtMonth(existing.month_2)}`}
                      </div>
                    )}

                    {showJotform && <CopyBlock lines={jotformLines} />}

                    {!readOnly && (
                      <div className="flex items-center gap-2 pt-1 flex-wrap">
                        <button
                          onClick={() => logMonth(sfgId, monthNum, promoType, targetLevel, existing, totalMonths, track)}
                          disabled={!!saving}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 ${
                            isFinal
                              ? 'bg-green-600 text-white hover:bg-green-700'
                              : 'bg-accent text-white hover:bg-accent/90'
                          }`}>
                          {saving === savingKey ? 'Logging…' : isFinal ? 'Log & Submit Promotion' : `Log Month ${monthNum}`}
                        </button>

                        {slingEligible && (
                          <button
                            onClick={() => logSlingshot(sfgId, targetLevel, track)}
                            disabled={!!saving}
                            title="Qualifies in a single month via the higher APV bar + weekly submissions"
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-yellow-500 text-white hover:bg-yellow-600 disabled:opacity-50">
                            {saving === slingSaving ? 'Logging…' : '⚡ Log Slingshot Promotion'}
                          </button>
                        )}

                        <button
                          onClick={() => skipAgent(sfgId, targetLevel)}
                          disabled={!!saving}
                          className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-600 dark:hover:text-white/60 hover:bg-gray-100 dark:hover:bg-white/10 disabled:opacity-50">
                          {saving === sfgId + '-' + targetLevel + '-skip' ? 'Skipping…' : 'Skip'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── B2: Progress Logged This Cycle ─────────────────────────────────────── */}
      {intermediateActions.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-gray-900 dark:text-white mb-3">
            Progress Logged This Cycle <span className="ml-1 text-xs font-normal text-gray-400">({intermediateActions.length})</span>
          </h2>
          <div className="rounded-2xl border border-gray-200 dark:border-white/15 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-white/5 border-b border-gray-200 dark:border-white/10">
                <tr>
                  {['Agent', 'Level', 'Progress', 'Month 1', 'Month 2', 'Notes'].map((h, i) => (
                    <th key={i} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-white/50">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/10">
                {intermediateActions.map(a => (
                  <tr key={a.id}>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{agentName(a.person, a.sfg_id)}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-white/50">{a.level ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400">
                        Month {a.month_number}/{a.totalMonths}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-white/50">{a.existing?.month_1 ? fmtMonth(a.existing.month_1) : '—'}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-white/50">{a.existing?.month_2 ? fmtMonth(a.existing.month_2) : '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-400 dark:text-white/40">{a.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── C: Promotions Finalized ────────────────────────────────────────────── */}
      {finalizedActions.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-gray-900 dark:text-white mb-3">
            Promotions Finalized <span className="ml-1 text-xs font-normal text-gray-400">({finalizedActions.length})</span>
          </h2>
          <div className="rounded-2xl border border-gray-200 dark:border-white/15 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-white/5 border-b border-gray-200 dark:border-white/10">
                <tr>
                  {['Agent', 'Type', 'Level', 'Jotform', 'Flags', 'Notes'].map((h, i) => (
                    <th key={i} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-white/50">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/10">
                {finalizedActions.map(a => {
                  const person    = personnelMap[a.sfg_id?.toUpperCase()]
                  // Restructure flags are contract-level only — leadership
                  // titles don't carry a carrier appointment level.
                  const flags     = LEADERSHIP_LEVELS.has(a.level)
                    ? { moveOut: false, moveBackIn: false, any: false }
                    : restructureFlags(a.sfg_id)
                  const jfKey     = a.sfg_id?.toUpperCase() + '||' + a.level
                  const jfOpen    = jotformOpen.has(jfKey)
                  const canShowJf = !!a.level && a.action_type !== 'manual_promotion'
                  return (
                    <Fragment key={a.id}>
                      <tr>
                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{agentName(person, a.sfg_id)}</td>
                        <td className="px-4 py-3 text-gray-500 dark:text-white/50 capitalize">{(a.action_type ?? '').replace('_', ' ')}</td>
                        <td className="px-4 py-3 text-gray-500 dark:text-white/50">{a.level ?? '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {a.jotform_submitted_at
                              ? <span className="text-xs text-green-600 dark:text-green-400">✓ Submitted</span>
                              : !readOnly
                                ? <button onClick={() => submitJotform(a.id)} disabled={saving === a.id + '-jf'}
                                    className="px-2.5 py-1 rounded-lg text-xs font-semibold text-gray-600 dark:text-white/60 border border-gray-200 dark:border-white/20 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50">
                                    {saving === a.id + '-jf' ? 'Saving…' : 'Mark Submitted'}
                                  </button>
                                : <span className="text-xs text-gray-400">—</span>
                            }
                            {canShowJf && (
                              <button
                                onClick={() => setJotformOpen(prev => {
                                  const s = new Set(prev)
                                  s.has(jfKey) ? s.delete(jfKey) : s.add(jfKey)
                                  return s
                                })}
                                className="text-xs text-accent hover:text-accent/80 font-medium">
                                {jfOpen ? 'Hide' : 'View'} Jotform
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {flags.any ? (
                            <div className="flex flex-col gap-1 items-start">
                              <span className="text-[11px] font-medium text-gray-500 dark:text-white/50">
                                {[flags.moveOut && 'Move Out', flags.moveBackIn && 'Move Back In'].filter(Boolean).join(' · ')}
                              </span>
                              {a.hierarchy_flag_noted
                                ? <span className="text-xs text-green-600 dark:text-green-400">✓ Noted</span>
                                : !readOnly
                                  ? <button onClick={() => noteFlag(a.id)} disabled={saving === a.id}
                                      className="px-2.5 py-1 rounded-lg text-xs font-semibold text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-500/30 hover:bg-orange-50 dark:hover:bg-orange-500/10 disabled:opacity-50">
                                      {saving === a.id ? 'Saving…' : 'Note Flags'}
                                    </button>
                                  : <span className="text-xs text-orange-500">⚠ Unresolved</span>
                              }
                            </div>
                          ) : <span className="text-xs text-gray-300 dark:text-white/20">—</span>
                          }
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400 dark:text-white/40">{a.notes || '—'}</td>
                      </tr>
                      {jfOpen && (
                        <tr>
                          <td colSpan={6} className="px-4 pb-4 bg-gray-50/50 dark:bg-white/[0.02]">
                            {(() => {
                              const lines = finalizedJotformLines(a)
                              return lines
                                ? <CopyBlock lines={lines} />
                                : <p className="text-xs text-gray-400 dark:text-white/40 pt-2">Unable to reconstruct Jotform text for this row.</p>
                            })()}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Close Cycle ────────────────────────────────────────────────────────── */}
      {!readOnly && (
        <div className="pt-4 border-t border-gray-200 dark:border-white/15 flex items-center justify-between">
          <p className="text-xs text-gray-400 dark:text-white/40">
            {unresolvedFlags.length > 0
              ? `${unresolvedFlags.length} unresolved hierarchy flag${unresolvedFlags.length !== 1 ? 's' : ''}`
              : 'All flags resolved.'}
          </p>
          <button
            onClick={() => unresolvedFlags.length > 0 ? setConfirmClose(true) : closeCycle()}
            disabled={saving === 'close'}
            className="px-6 py-2.5 rounded-xl text-sm font-bold bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-100 disabled:opacity-50">
            {saving === 'close' ? 'Closing…' : 'Close Cycle'}
          </button>
        </div>
      )}

      {/* Confirm close with unresolved flags */}
      {confirmClose && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">Unresolved Hierarchy Flags</h2>
            <p className="text-sm text-gray-500 dark:text-white/50">The following promotions have unresolved flags:</p>
            <ul className="space-y-1 text-sm text-orange-600 dark:text-orange-400">
              {unresolvedFlags.map(a => (
                <li key={a.id}>• {agentName(personnelMap[a.sfg_id?.toUpperCase()], a.sfg_id)}</li>
              ))}
            </ul>
            <p className="text-xs text-gray-400 dark:text-white/40">Close cycle anyway?</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmClose(false)}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-white/60 hover:bg-gray-100 dark:hover:bg-white/10">
                Go Back
              </button>
              <button onClick={closeCycle} disabled={saving === 'close'}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                {saving === 'close' ? 'Closing…' : 'Close Anyway'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual promotion modal */}
      {manualModal && (
        <ManualPromoModal
          personnel={personnel}
          cycleId={cycle.id}
          onClose={() => setManualModal(false)}
          onSaved={onRefresh}
        />
      )}
    </div>
  )
}
