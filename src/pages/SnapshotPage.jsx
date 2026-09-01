import { useCallback, useEffect, useMemo, useState } from 'react'
import { useViewing } from '../context/ViewingContext'
import Step1Reconciliation from '../components/snapshot/Step1Reconciliation'
import Step2Disputes from '../components/snapshot/Step2Disputes'
import Step3Promotions from '../components/snapshot/Step3Promotions'

function safeJson(val) {
  if (!val) return []
  if (Array.isArray(val)) return val
  try { return JSON.parse(val) } catch { return [] }
}

const STEP_LABELS = ['Reconciliation', 'Disputes', 'Promotions']

export default function SnapshotPage() {
  const { permissions, activeSubject } = useViewing()

  const [cycles,        setCycles]        = useState([])
  const [activeCycleId, setActiveCycleId] = useState(null)
  const [cycleData,     setCycleData]     = useState(null)   // { cycle, reconciliations, disputes, promotions }
  const [context,       setContext]       = useState(null)   // { personnel, qualifications, promotions (agent_promos), monthPolicies }
  const [activeStep,    setActiveStep]    = useState(1)
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState(null)
  const [newCycleOpen,  setNewCycleOpen]  = useState(false)
  const [newCycleMonth, setNewCycleMonth] = useState('')   // 'MM'
  const [newCycleYear,  setNewCycleYear]  = useState('')   // 'YYYY'
  const [creating,      setCreating]      = useState(false)

  // Step 0 (scope selection) — which agency owners this cycle will cover
  const [owners,        setOwners]        = useState([])
  const [ownersLoading, setOwnersLoading] = useState(false)
  const [claims,        setClaims]        = useState([])   // owners already in a cycle this month
  const [excluded,      setExcluded]      = useState(() => new Set())

  const canWrite = permissions.snapshot.write

  // ── Load cycles list ─────────────────────────────────────────────────────────
  async function loadCycles() {
    try {
      const data = await fetch('/api/snapshot?type=cycles').then(r => r.json())
      setCycles(Array.isArray(data) ? data : [])
      return Array.isArray(data) ? data : []
    } catch {
      return []
    }
  }

  useEffect(() => {
    if (!permissions.snapshot.read) return
    loadCycles().then(list => {
      if (list.length > 0) selectCycle(list[0].id, list)
    })
  }, [permissions.snapshot.read])

  // ── Load full cycle + context ─────────────────────────────────────────────────
  const selectCycle = useCallback(async (cycleId, cycleList = cycles) => {
    setActiveCycleId(cycleId)
    setError(null)
    setLoading(true)
    try {
      const found = cycleList.find(c => c.id === cycleId)
      const month = found?.month

      const [cd, ctx] = await Promise.all([
        fetch(`/api/snapshot?type=cycle&id=${cycleId}`).then(r => r.json()),
        month
          ? fetch(`/api/snapshot?type=context&month=${month}`).then(r => r.json())
          : Promise.resolve(null),
      ])

      if (cd.error) throw new Error(cd.error)
      setCycleData(cd)
      setContext(ctx)
      setActiveStep(cd.cycle.step ?? 1)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [cycles])

  // ── Refresh (called after mutations) ─────────────────────────────────────────
  async function refresh() {
    if (!activeCycleId) return
    await selectCycle(activeCycleId)
  }

  // ── Step navigation ───────────────────────────────────────────────────────────
  function canNavigateTo(step) {
    if (!cycleData) return false
    const cycleStep = cycleData.cycle?.step ?? 1
    if (cycleData.cycle?.completed_at) return true  // completed — all readable
    return step <= cycleStep
  }

  async function advanceToStep(step) {
    if (!cycleData) return
    await fetch('/api/snapshot?type=cycle', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: cycleData.cycle.id, step }),
    })
    await refresh()
    setActiveStep(step)
  }

  // ── Step 0: scope selection ──────────────────────────────────────────────────
  //
  // Exclusions are stored as an explicit set rather than by unchecking
  // descendants, so ancestry does the cascading: declining an owner's agency
  // automatically declines everyone beneath them, and re-including that owner
  // restores the subtree without having to remember what was under it. Reaching
  // past an owner who said they'd handle their own reconciliation to run one of
  // their sub-agencies is exactly the thing this prevents.
  const ownerById = useMemo(() => {
    const m = {}
    for (const o of owners) m[o.sfg_id.toUpperCase()] = o
    return m
  }, [owners])

  const excludedByAncestor = useCallback((sfgId) => {
    let cur = ownerById[sfgId?.toUpperCase()]?.parent_owner
    while (cur) {
      if (excluded.has(cur.toUpperCase())) return true
      cur = ownerById[cur.toUpperCase()]?.parent_owner
    }
    return false
  }, [ownerById, excluded])

  const isSelected = useCallback((sfgId) => {
    const id = sfgId?.toUpperCase()
    return !excluded.has(id) && !excludedByAncestor(id)
  }, [excluded, excludedByAncestor])

  function toggleOwner(sfgId) {
    const id = sfgId.toUpperCase()
    setExcluded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedOwnerIds = useMemo(
    () => owners.filter(o => isSelected(o.sfg_id)).map(o => o.sfg_id),
    [owners, isSelected]
  )

  // Whose cycle this is: the viewed subject when they're an owner, otherwise the
  // top of the owner tree they can see (a super_admin running it on their behalf).
  const cycleOwner = useMemo(() => {
    const self = ownerById[activeSubject?.sfg_id?.toUpperCase()]
    if (self) return self
    return owners.find(o => !o.parent_owner) ?? owners[0] ?? null
  }, [ownerById, activeSubject?.sfg_id, owners])

  const claimByOwner = useMemo(() => {
    const m = {}
    for (const c of claims) m[c.owner_sfg_id?.toUpperCase()] = c
    return m
  }, [claims])

  // ── Open new-cycle modal pre-filled to previous month ────────────────────────
  function openNewCycleModal() {
    const prev = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)
    setNewCycleMonth(String(prev.getMonth() + 1).padStart(2, '0'))
    setNewCycleYear(String(prev.getFullYear()))
    setExcluded(new Set())
    setNewCycleOpen(true)

    setOwnersLoading(true)
    fetch('/api/snapshot?type=owners')
      .then(r => r.json())
      .then(d => setOwners(Array.isArray(d) ? d : []))
      .catch(() => setOwners([]))
      .finally(() => setOwnersLoading(false))
  }

  // Who already has these baseshops in a cycle this month — drives the overlap
  // warning. Overlap is allowed on purpose, so this informs rather than blocks.
  useEffect(() => {
    if (!newCycleOpen || !newCycleMonth || !newCycleYear) { setClaims([]); return }
    const month = `${newCycleYear}-${newCycleMonth}`
    let cancelled = false
    fetch(`/api/snapshot?type=cycle-claims&month=${month}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setClaims(Array.isArray(d) ? d : []) })
      .catch(() => { if (!cancelled) setClaims([]) })
    return () => { cancelled = true }
  }, [newCycleOpen, newCycleMonth, newCycleYear])

  // ── Create new cycle ──────────────────────────────────────────────────────────
  async function createCycle() {
    if (!newCycleMonth || !newCycleYear || !selectedOwnerIds.length) return
    const month = `${newCycleYear}-${newCycleMonth}`
    setCreating(true)
    try {
      const data = await fetch('/api/snapshot?type=cycles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month,
          owner_sfg_id:       cycleOwner?.sfg_id ?? null,
          scope_owner_sfg_ids: selectedOwnerIds,
        }),
      }).then(r => r.json())
      if (data.error) { alert(data.error); return }
      const updated = await loadCycles()
      setNewCycleOpen(false)
      await selectCycle(data.id, updated)
    } finally {
      setCreating(false)
    }
  }

  // ── Extract policies from reconciliation JSON for Step2 policyMap ────────────
  const reconPolicies = useMemo(() => {
    if (!cycleData?.reconciliations) return []
    const all = []
    const seen = new Set()
    for (const rec of cycleData.reconciliations) {
      for (const p of safeJson(rec.issued_policies)) {
        if (p.id && !seen.has(p.id)) {
          seen.add(p.id)
          all.push({ ...p, sfg_id: rec.sfg_id, status: p.status ?? 'issued', carrier: p.carrier ?? rec.carrier })
        }
      }
      for (const p of safeJson(rec.non_issued_policies)) {
        if (p.id && !seen.has(p.id)) {
          seen.add(p.id)
          all.push({ ...p, sfg_id: rec.sfg_id, carrier: p.carrier ?? rec.carrier })
        }
      }
      // Include candidate policies so policyMap covers chargebacks / straddles
      let hyp = null
      try { hyp = rec.claude_hypothesis ? JSON.parse(rec.claude_hypothesis) : null } catch {}
      for (const c of hyp?.candidates ?? []) {
        if (c.policy_id && !seen.has(c.policy_id)) {
          seen.add(c.policy_id)
          all.push({
            id:                  c.policy_id,
            policy_no:           c.policy_number,
            policy_number:       c.policy_number,
            applicant:           c.applicant,
            carrier:             rec.carrier,
            issued_apv:          c.issued_apv,
            issue_date:          c.issue_date,
            sfg_id:              rec.sfg_id,
            status:              'issued',
            conservation_status: c.conservation_status,
            conservation_date:   c.conservation_date,
          })
        }
      }
    }
    return all
  }, [cycleData])

  // ── Guard: access ─────────────────────────────────────────────────────────────
  if (!permissions.snapshot.read) {
    return (
      <main className="max-w-4xl mx-auto px-6 py-8">
        <p className="text-sm text-red-500">You don't have access to this section.</p>
      </main>
    )
  }

  const cycle     = cycleData?.cycle ?? null
  const completed = !!cycle?.completed_at

  function fmtCycleMonth(isoMonth) {
    if (!isoMonth) return ''
    const [y, m] = isoMonth.split('-')
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }

  return (
    <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            Snapshot{cycle ? ` — ${fmtCycleMonth(cycle.month)}` : ''}
          </h1>
          {completed && (
            <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400 font-semibold">
              Closed
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Cycle selector */}
          {cycles.length > 1 && (
            <select
              value={activeCycleId ?? ''}
              onChange={e => selectCycle(e.target.value)}
              className="rounded-lg border border-gray-200 dark:border-white/15 bg-white dark:bg-white/5 text-sm text-gray-700 dark:text-white px-3 py-1.5 focus:outline-none">
              {cycles.map(c => (
                <option key={c.id} value={c.id}>
                  {fmtCycleMonth(c.month)} {c.completed_at ? '✓' : ''}
                </option>
              ))}
            </select>
          )}

          {canWrite && (
            <button onClick={openNewCycleModal}
              className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-accent text-white hover:bg-accent/90 transition-colors">
              + New Cycle
            </button>
          )}
        </div>
      </div>

      {/* ── Step nav ───────────────────────────────────────────────────────────── */}
      {cycle && (
        <div className="flex items-center gap-1">
          {STEP_LABELS.map((label, i) => {
            const step   = i + 1
            const active = activeStep === step
            const done   = completed ? true : (cycle.step ?? 1) > step
            const locked = !canNavigateTo(step)
            return (
              <button
                key={step}
                disabled={locked}
                onClick={() => !locked && setActiveStep(step)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  active
                    ? 'bg-accent text-white'
                    : locked
                      ? 'text-gray-300 dark:text-white/20 cursor-default'
                      : done
                        ? 'text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-500/10'
                        : 'text-gray-500 dark:text-white/50 hover:bg-gray-100 dark:hover:bg-white/10'
                }`}>
                <span className={`w-5 h-5 rounded-full text-xs flex items-center justify-center font-bold ${
                  active
                    ? 'bg-white/20'
                    : done && !active
                      ? 'bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-400'
                      : 'bg-gray-100 dark:bg-white/10'
                }`}>
                  {done && !active ? '✓' : step}
                </span>
                {label}
              </button>
            )
          })}
        </div>
      )}

      {/* ── Loading / error ────────────────────────────────────────────────────── */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="text-sm text-gray-400 dark:text-white/40">Loading…</div>
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* ── Empty state ────────────────────────────────────────────────────────── */}
      {!loading && !cycle && cycles.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-200 dark:border-white/15 px-8 py-16 text-center space-y-3">
          <p className="text-sm text-gray-500 dark:text-white/50">No snapshot cycles yet.</p>
          {canWrite && (
            <button onClick={openNewCycleModal}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-white hover:bg-accent/90">
              Create First Cycle
            </button>
          )}
        </div>
      )}

      {/* ── Step content ───────────────────────────────────────────────────────── */}
      {!loading && cycle && (
        <>
          {activeStep === 1 && (
            <Step1Reconciliation
              cycle={cycle}
              reconciliations={cycleData.reconciliations ?? []}
              disputes={cycleData.disputes ?? []}
              personnel={context?.personnel ?? []}
              canWrite={canWrite && !completed}
              onStepComplete={() => advanceToStep(2)}
              onRefresh={refresh}
            />
          )}

          {activeStep === 2 && (
            <Step2Disputes
              cycle={cycle}
              disputes={cycleData.disputes ?? []}
              personnel={context?.personnel ?? []}
              policies={reconPolicies}
              agentMonthApv={context?.agentMonthApv ?? {}}
              canWrite={canWrite && !completed}
              onStepComplete={() => advanceToStep(3)}
              onRefresh={refresh}
            />
          )}

          {activeStep === 3 && (
            <Step3Promotions
              cycle={cycle}
              promotions={cycleData.promotions ?? []}
              context={context}
              canWrite={canWrite && !completed}
              onCycleClose={refresh}
              onRefresh={refresh}
            />
          )}
        </>
      )}

      {/* ── New cycle modal ────────────────────────────────────────────────────── */}
      {newCycleOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">New Snapshot Cycle</h2>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-white/50 mb-2">Month</label>
              <div className="flex gap-2">
                {(() => {
                  const SEL = 'flex-1 rounded-lg border border-gray-300 dark:border-white/20 bg-white dark:bg-white/5 text-gray-900 dark:text-white dark:[color-scheme:dark] text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent/50'
                  const OPT = {}
                  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
                  const thisYear = new Date().getFullYear()
                  const years = [thisYear - 1, thisYear, thisYear + 1]
                  return (
                    <>
                      <select value={newCycleMonth} onChange={e => setNewCycleMonth(e.target.value)} className={SEL}>
                        <option value="" style={OPT}>Month</option>
                        {MONTHS.map((m, i) => (
                          <option key={i} value={String(i + 1).padStart(2, '0')} style={OPT}>{m}</option>
                        ))}
                      </select>
                      <select value={newCycleYear} onChange={e => setNewCycleYear(e.target.value)} className={SEL}>
                        <option value="" style={OPT}>Year</option>
                        {years.map(y => (
                          <option key={y} value={String(y)} style={OPT}>{y}</option>
                        ))}
                      </select>
                    </>
                  )
                })()}
              </div>
            </div>
            {/* Scope — which agencies this cycle covers */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-white/50 mb-1">
                Agencies to reconcile
              </label>
              <p className="text-[11px] text-gray-400 dark:text-white/35 mb-2 leading-relaxed">
                Unselecting an agency also unselects everything beneath it. Excluded
                agencies stay out of every step of this cycle.
              </p>

              {ownersLoading ? (
                <p className="text-xs text-gray-400 dark:text-white/40 py-2">Loading agencies…</p>
              ) : owners.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-white/40 py-2">No agencies available.</p>
              ) : (
                <div className="max-h-52 overflow-y-auto rounded-lg border border-gray-200 dark:border-white/15 divide-y divide-gray-100 dark:divide-white/10">
                  {owners.map(o => {
                    const id       = o.sfg_id.toUpperCase()
                    const selected = isSelected(o.sfg_id)
                    const viaParent = !excluded.has(id) && !selected   // switched off by an ancestor
                    const depth    = o.parent_owner ? 1 : 0
                    const claim    = claimByOwner[id]
                    return (
                      <label
                        key={o.sfg_id}
                        className={`flex items-start gap-2.5 px-3 py-2 cursor-pointer transition-colors
                          ${viaParent ? 'opacity-45' : 'hover:bg-gray-50 dark:hover:bg-white/5'}`}
                        style={{ paddingLeft: 12 + depth * 20 }}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={viaParent}
                          onChange={() => toggleOwner(o.sfg_id)}
                          className="mt-0.5 accent-accent"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-gray-900 dark:text-white truncate">
                            {o.name}
                            <span className="ml-2 text-[11px] text-gray-400 dark:text-white/35">
                              {o.baseshop_size} agents
                            </span>
                          </span>
                          {claim && (
                            <span className="block text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
                              Already in {claim.cycle_owner_name ?? 'another'}&rsquo;s cycle
                              {claim.completed_at ? ' (closed)' : ' (open)'} — running it here
                              duplicates that work.
                            </span>
                          )}
                        </span>
                      </label>
                    )
                  })}
                </div>
              )}

              {cycleOwner && (
                <p className="text-[11px] text-gray-400 dark:text-white/35 mt-2">
                  Running as <span className="text-gray-600 dark:text-white/60 font-medium">{cycleOwner.name}</span>
                  {' · '}{selectedOwnerIds.length} of {owners.length} agencies selected
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => setNewCycleOpen(false)}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-white/60 hover:bg-gray-100 dark:hover:bg-white/10">
                Cancel
              </button>
              <button onClick={createCycle}
                disabled={!newCycleMonth || !newCycleYear || !selectedOwnerIds.length || creating}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-white hover:bg-accent/90 disabled:opacity-50">
                {creating ? 'Creating…' : 'Create Cycle'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
