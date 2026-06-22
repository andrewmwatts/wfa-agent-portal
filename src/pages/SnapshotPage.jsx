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
  const { permissions } = useViewing()

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

  // ── Create new cycle ──────────────────────────────────────────────────────────
  async function createCycle() {
    if (!newCycleMonth || !newCycleYear) return
    const month = `${newCycleYear}-${newCycleMonth}`
    setCreating(true)
    try {
      const data = await fetch('/api/snapshot?type=cycles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month }),
      }).then(r => r.json())
      if (data.error) { alert(data.error); return }
      const updated = await loadCycles()
      setNewCycleOpen(false)
      setNewCycleMonth('')
      setNewCycleYear('')
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
            <button onClick={() => {
              const now = new Date()
              setNewCycleMonth(String(now.getMonth() + 1).padStart(2, '0'))
              setNewCycleYear(String(now.getFullYear()))
              setNewCycleOpen(true)
            }}
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
            <button onClick={() => setNewCycleOpen(true)}
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
                  const SEL = 'flex-1 rounded-lg border border-gray-300 dark:border-white/20 bg-white dark:bg-white/5 text-gray-900 dark:text-white text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent/50'
                  const OPT = { background: 'transparent' }
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
            <div className="flex justify-end gap-2">
              <button onClick={() => { setNewCycleOpen(false); setNewCycleMonth(''); setNewCycleYear('') }}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-white/60 hover:bg-gray-100 dark:hover:bg-white/10">
                Cancel
              </button>
              <button onClick={createCycle} disabled={!newCycleMonth || !newCycleYear || creating}
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
