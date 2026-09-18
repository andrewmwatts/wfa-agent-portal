import { useEffect, useId, useRef, useState } from 'react'
import PolicyModal, { PolicyModalErrorBoundary } from '../PolicyEditModal'
import { fmtDate, fmtCurrency as fmtAmt } from '../../utils/format'
import { normalizeCarrier } from '../../../shared/carriers'
import { readSnapshotFile } from '../../utils/snapshotFile'

// Returns { from: 'YYYY-MM-01', to: 'YYYY-MM-DD' } for the full calendar month
function monthWindow(isoMonth) {
  const [y, m] = isoMonth.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  return { from: `${isoMonth}-01`, to: `${isoMonth}-${String(lastDay).padStart(2, '0')}` }
}

// 'YYYY-MM' → "Aug 2026"
function fmtMonthLabel(ym) {
  const [y, m] = String(ym ?? '').split('-').map(Number)
  if (!y || !m) return String(ym ?? '')
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' })
}

const FLAG_COLORS = {
  'Split/Reset policy':       'bg-amber-500/20 text-amber-600 dark:text-amber-300',
  'Duplicate policy number':  'bg-red-500/20 text-red-500 dark:text-red-400',
  default:                    'bg-blue-500/15 text-blue-600 dark:text-blue-300',
}

function FlagBadge({ flag }) {
  const cls = FLAG_COLORS[flag] ?? FLAG_COLORS.default
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{flag}</span>
}

function ResolutionBadge({ resolution, phase }) {
  if (!resolution) return null
  const cls = resolution === 'legitimate'
    ? 'bg-green-500/20 text-green-600 dark:text-green-300'
    : resolution === 'disputed'
      ? 'bg-amber-500/20 text-amber-600 dark:text-amber-300'
      : 'bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-white/50'
  // In Final Review there is nothing left to dispute: a resolved card is one that was accepted as it stands.
  const label = resolution === 'legitimate'
    ? (phase === 'final' ? 'Accepted' : 'Legitimate')
    : resolution === 'disputed' ? 'Sent to Disputes' : 'No Action'
  return <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${cls}`}>{label}</span>
}

// The Snapshot page swaps the step content for a spinner every time it refreshes —
// after a run, and after every policy edit — which unmounts this component and would
// throw away the uploaded file, the last run's summary and any agents matched by
// hand. Keeping them here, per cycle and per pass, lets a review go run → edit → run
// again without re-uploading the file, and keeps the run summary on screen.
const importCache = new Map()
const EMPTY_IMPORT = { file: null, parsed: null, overrides: {}, runResult: null, edited: false }

function useImportState(key) {
  const [state, setState] = useState(() => importCache.get(key) ?? EMPTY_IMPORT)
  useEffect(() => { setState(importCache.get(key) ?? EMPTY_IMPORT) }, [key])
  // The cache, not the closure, is the source of truth: a handler that fires just as
  // the component unmounts still has to leave the latest values behind.
  const update = patch => {
    const next = { ...(importCache.get(key) ?? EMPTY_IMPORT), ...patch }
    importCache.set(key, next)
    setState(next)
  }
  return [state, update]
}

/**
 * One reconciliation pass over an uploaded Snapshot report.
 *
 *   phase 'draft' — Step 1: the draft ledger. Chargebacks count as unlogged, so each
 *                   reversal is flagged for logging; a difference is either disputed or
 *                   fixed by editing the tracker.
 *   phase 'final' — Final Review: the ledger after edits and disputes. Logged
 *                   chargebacks are counted, and there is nothing left to dispute — the
 *                   only remedy is an edit — before going on to Promotions.
 *
 * Both take either export, run the same adjudication, and show the same cards.
 */
export default function Step1Reconciliation({ cycle, reconciliations, disputes = [], personnel, canWrite, onStepComplete, onRefresh, phase = 'draft' }) {
  const fileRef  = useRef(null)
  const isFinal  = phase === 'final'

  const [imp, updateImp] = useImportState(`${cycle?.id}:${phase}`)
  const { file, parsed, overrides, runResult, edited } = imp
  const [parseError,    setParseError]    = useState(null)
  const [running,       setRunning]       = useState(false)
  const [runError,      setRunError]      = useState(null)

  const [expanded,  setExpanded]  = useState({})
  const [savingId,  setSavingId]  = useState(null)

  const [disputingCandidate,        setDisputingCandidate]        = useState(null)  // { recId, candidate }
  const [candidateDisputeNote,      setCandidateDisputeNote]      = useState('')
  const [candidateDisputeAmount,    setCandidateDisputeAmount]    = useState('')
  const [candidateDisputeDirection, setCandidateDisputeDirection] = useState('add')
  const [disputeError,              setDisputeError]              = useState(null)

  const [policySearches,    setPolicySearches]    = useState({})   // recId → query string
  const [policyResults,     setPolicyResults]     = useState({})   // recId → [policy]
  const [searchingId,       setSearchingId]       = useState(null)

  const [editPolicy,    setEditPolicy]    = useState(null)
  const [dupeOpen,      setDupeOpen]      = useState(false)
  const [fixesOpen,     setFixesOpen]     = useState(false)

  const [editingDisputeId,  setEditingDisputeId]  = useState(null)
  const [disputeEditAmt,    setDisputeEditAmt]    = useState('')
  const [disputeEditDir,    setDisputeEditDir]    = useState('add')
  const [disputeEditNote,   setDisputeEditNote]   = useState('')
  const [disputeEditErr,    setDisputeEditErr]    = useState(null)
  const [deletingDisputeId, setDeletingDisputeId] = useState(null)

  // Sort by carrier A-Z, then agent name A-Z; resolved go to bottom
  const sorted = [...reconciliations].sort((a, b) => {
    const aRes = !!a.resolution, bRes = !!b.resolution
    if (aRes !== bRes) return aRes ? 1 : -1
    const cc = (a.carrier ?? '').localeCompare(b.carrier ?? '')
    if (cc !== 0) return cc
    return (a.agent_name ?? a.sfg_id ?? '').localeCompare(b.agent_name ?? b.sfg_id ?? '')
  })

  const allResolved = reconciliations.length > 0 && reconciliations.every(r => r.resolution)
  const dupePolicies = runResult?.duplicate_policies ?? []
  const numberFixes  = runResult?.policy_number_fixes ?? []

  // A Placed Policies export says which business month it covers; the workbook doesn't.
  const cycleMonth   = String(cycle?.month ?? '').slice(0, 7)
  const fileMonths   = parsed?.format === 'policy_lines' ? (parsed.meta?.months ?? []) : []
  const monthMismatch = fileMonths.length > 0 && !(fileMonths.length === 1 && fileMonths[0] === cycleMonth)

  async function handleFileChange(e) {
    const f = e.target.files?.[0]
    if (!f) return
    updateImp({ file: f, parsed: null, overrides: {}, edited: false })
    setParseError(null)
    try {
      // One uploader for both exports — the content decides which one it is.
      const result = await readSnapshotFile(f)
      if (result.error) setParseError(result.error)
      else updateImp({ parsed: result })
    } catch (err) {
      setParseError(`Could not parse file: ${err.message}`)
    }
  }

  async function handleRunComparison(withOverrides = overrides) {
    if (!parsed || !cycle) return
    setRunning(true)
    setRunError(null)
    try {
      const res = await fetch('/api/snapshot/run', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cycle_id:        cycle.id,
          phase,
          snapshot_window: monthWindow(cycle.month),
          ...(parsed.format === 'policy_lines'
            ? { snapshot_policies: parsed.policies, agent_overrides: withOverrides }
            : { snapshot_agents: parsed.agents }),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Run failed')
      updateImp({ runResult: data, edited: false })
      await onRefresh()
    } catch (err) {
      setRunError(err.message)
    } finally {
      setRunning(false)
    }
  }

  // A person settled who an unmatched name is: remember it and re-run so every
  // line under that name lands on the right agent.
  function assignAgent(fileName, sfgId) {
    const next = { ...overrides, [fileName]: sfgId }
    updateImp({ overrides: next })
    handleRunComparison(next)
  }

  async function handlePolicySearch(rec, q) {
    setPolicySearches(s => ({ ...s, [rec.id]: q }))
    if (!q.trim()) { setPolicyResults(r => ({ ...r, [rec.id]: [] })); return }
    setSearchingId(rec.id)
    try {
      const params = new URLSearchParams({ type: 'policies', sfg_id: rec.sfg_id, carrier: rec.carrier, q: q.trim() })
      const data = await fetch(`/api/snapshot?${params}`).then(r => r.json())
      setPolicyResults(r => ({ ...r, [rec.id]: Array.isArray(data) ? data : [] }))
    } catch { /* silent */ } finally {
      setSearchingId(null)
    }
  }

  async function openEditPolicy(policyData) {
    const base = {
      ...policyData,
      id:        policyData.id ?? policyData.policy_id,
      policy_no: policyData.policy_number ?? policyData.policy_no,
    }
    // Always fetch the full live record — the snapshot JSON only carries a subset of
    // fields and goes stale after edits (missing chargeback, submit_date, face_amount, etc.)
    const sfgId    = base.sfg_id ?? policyData.sfg_id
    const carrier  = base.carrier
    const policyNo = base.policy_no ?? ''
    if (sfgId && carrier && policyNo) {
      try {
        const params = new URLSearchParams({ type: 'policies', sfg_id: sfgId, carrier, q: policyNo })
        const data = await fetch(`/api/snapshot?${params}`).then(r => r.json())
        const match = Array.isArray(data)
          ? data.find(p => (p.policy_number ?? '').toLowerCase() === policyNo.toLowerCase())
          : null
        if (match) {
          // Object.assign overwrites snapshot JSON fields with live DB values.
          // The trailing object maps DB column names → modal key names so that
          // startEdit()'s draft is fully populated and the PUT won't write NULLs
          // for fields the snapshot JSON never carried (cb_month, subm_apv, etc.)
          Object.assign(base, match, {
            id:          base.id          ?? match.id,
            policy_no:   base.policy_no   ?? match.policy_number,
            policy_type: match.policy_name ?? base.policy_type ?? '',
            subm_apv:    match.submitted_apv           != null ? String(match.submitted_apv)           : '',
            face_amt:    match.face_amount              != null ? String(match.face_amount)              : '',
            cb_apv:      match.snapshot_chargeback_apv  != null ? String(match.snapshot_chargeback_apv)  : '',
            cb_month:    match.snapshot_chargeback_month
                           ? String(match.snapshot_chargeback_month).slice(0, 7)
                           : '',
          })
        }
      } catch { /* fall through — open with what we have */ }
    }
    setEditPolicy(base)
  }

  async function handleCandidateDispute(rec, candidate) {
    setSavingId(rec.id)
    setDisputeError(null)
    try {
      const absAmt    = parseFloat(String(candidateDisputeAmount).replace(/[$,]/g, ''))
                        || Math.abs(candidate.delta_contribution ?? 0)
      const signedAmt = candidateDisputeDirection === 'reduce' ? -absAmt : absAmt
      const res = await fetch('/api/snapshot?type=disputes', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cycle_id:          cycle.id,
          reconciliation_id: rec.id,
          sfg_id:            rec.sfg_id,
          policy_id:         candidate.policy_id ?? null,
          disputed_amount:   signedAmt,
          dispute_type:      candidate.flag,
          notes:             candidateDisputeNote || null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setDisputeError(body.error || `Server error ${res.status}`)
        return
      }
      setDisputingCandidate(null)
      setCandidateDisputeNote('')
      setCandidateDisputeAmount('')
      setCandidateDisputeDirection('add')
      setDisputeError(null)
      await onRefresh()
    } catch (err) {
      console.error('dispute error', err)
      setDisputeError(err.message || 'Unknown error')
    } finally {
      setSavingId(null)
    }
  }

  function startEditDispute(d) {
    setEditingDisputeId(d.id)
    setDisputeEditAmt(String(Math.abs(d.disputed_amount ?? 0)))
    setDisputeEditDir((d.disputed_amount ?? 0) >= 0 ? 'add' : 'reduce')
    setDisputeEditNote(d.notes ?? '')
    setDisputeEditErr(null)
  }

  async function handleDisputeUpdate(disputeId) {
    setSavingId(disputeId)
    setDisputeEditErr(null)
    try {
      const abs    = parseFloat(String(disputeEditAmt).replace(/[$,]/g, '')) || 0
      const signed = disputeEditDir === 'reduce' ? -abs : abs
      const res = await fetch('/api/snapshot?type=dispute', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: disputeId, disputed_amount: signed, notes: disputeEditNote || null }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setDisputeEditErr(body.error || `Server error ${res.status}`)
        return
      }
      setEditingDisputeId(null)
      await onRefresh()
    } catch (err) {
      setDisputeEditErr(err.message || 'Unknown error')
    } finally {
      setSavingId(null)
    }
  }

  async function handleDisputeDelete(disputeId) {
    setSavingId(disputeId)
    try {
      const res = await fetch('/api/snapshot?type=dispute', {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: disputeId }),
      })
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      setDeletingDisputeId(null)
      await onRefresh()
    } catch (err) {
      console.error('delete dispute error', err)
    } finally {
      setSavingId(null)
    }
  }

  async function handleResolve(rec, resolution) {
    setSavingId(rec.id)
    try {
      const res = await fetch('/api/snapshot?type=resolution', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: rec.id, resolution, phase }),
      })
      if (!res.ok) throw new Error('Failed to save resolution')
      await onRefresh()
    } catch (err) {
      console.error('resolve error', err)
    } finally {
      setSavingId(null)
    }
  }

  async function handleUnresolve(rec) {
    setSavingId(rec.id)
    try {
      const res = await fetch('/api/snapshot?type=resolution', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: rec.id, resolution: null, phase }),
      })
      if (!res.ok) throw new Error('Failed to clear resolution')
      await onRefresh()
    } catch (err) {
      console.error('unresolve error', err)
    } finally {
      setSavingId(null)
    }
  }

  const INPUT = 'w-full bg-gray-100 dark:bg-primary/60 border border-gray-200 dark:border-white/15 text-gray-900 dark:text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/60'
  const readOnly = cycle?.completed_at || !canWrite

  return (
    <div className="space-y-5">

      {/* ── Upload Panel ────────────────────────────────────────────────────── */}
      {!readOnly && (
        <div className="bg-white dark:bg-primary/30 border border-gray-200 dark:border-white/10 rounded-2xl p-6 space-y-4">
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">
              {isFinal ? 'Upload Final Snapshot Report' : 'Upload Snapshot Report'}
            </h4>
            <p className="text-xs text-gray-400 dark:text-white/35 mt-1.5 max-w-2xl leading-relaxed">
              {isFinal
                ? 'The final ledger, after your edits and the disputes. Chargebacks logged this month are counted, so anything that shows up here is a place the tracker still differs — fix it with Edit, then run again.'
                : 'The draft ledger. Chargebacks are treated as not yet logged, so each Reversal is flagged for you to log; other differences are either disputed or fixed with Edit.'}
            </p>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-600 dark:text-white/70">
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-white/20 text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
              >
                Choose file
              </button>
              {file ? <span className="text-xs text-gray-500 dark:text-white/50">{file.name}</span> : <span className="text-xs text-gray-400 dark:text-white/30">No file chosen</span>}
            </label>
            {parsed && (
              <span className="text-xs text-green-600 dark:text-green-400">
                {parsed.format === 'policy_lines'
                  ? `Placed Policies export: ${parsed.meta.lines} lines · ${parsed.meta.agents} agents${parsed.meta.reversals ? ` · ${parsed.meta.reversals} reversals` : ''}${fileMonths.length ? ` · ${fileMonths.map(fmtMonthLabel).join(', ')}` : ''}`
                  : `Snapshot workbook: ${parsed.agents.length} agent-carrier rows`}
                {cycle.month && (() => { const w = monthWindow(cycle.month); return ` · Window: ${fmtDate(w.from)} – ${fmtDate(w.to)}` })()}
              </span>
            )}
            <button
              onClick={() => handleRunComparison()}
              disabled={!parsed || running}
              className="text-xs font-semibold bg-accent text-white px-4 py-1.5 rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {running && <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>}
              {running ? 'Running…' : monthMismatch ? 'Run Anyway' : 'Run Comparison'}
            </button>
          </div>

          {parseError && <p className="text-xs text-red-500">{parseError}</p>}
          {runError   && <p className="text-xs text-red-500">{runError}</p>}

          {/* The workbook carries no date, but a Placed Policies export does — a
              file for another month would otherwise silently replace this cycle's results. */}
          {monthMismatch && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              This file is for {fileMonths.map(fmtMonthLabel).join(', ')}, but this cycle is {fmtMonthLabel(cycleMonth)}. Check you chose the right file before running.
            </p>
          )}

          {/* Editing a policy doesn't re-run anything, so the cards below still show
              the numbers from before the edit until the comparison is run again. */}
          {edited && parsed && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Policies edited since the last run — run the comparison again to refresh these results.
            </p>
          )}

          {runResult && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
              <SummaryChip label="Clean"        value={runResult.summary.clean_agents}      color="green" />
              <SummaryChip label="Discrepant"   value={runResult.summary.discrepant_agents} color="red"   />
              <SummaryChip label={runResult.source_format === 'policy_lines' ? 'Agents in file' : 'Total Agents'} value={runResult.summary.total_snapshot_agents} />
              {runResult.source_format === 'policy_lines' && (
                <SummaryChip label="Policy lines" value={runResult.summary.lines} />
              )}
              {/* An agency this cycle covers that the uploaded file says nothing
                  about almost always means the wrong export was uploaded — every
                  unmentioned agent would otherwise read as a full-APV discrepancy. */}
              {runResult.coverage?.some(c => c.agents_in_file === 0) && (
                <div className="col-span-2 sm:col-span-4 rounded-lg bg-amber-500/10 border border-amber-400/30 px-3 py-2">
                  <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 mb-1">
                    This file covers no agents for {runResult.coverage.filter(c => c.agents_in_file === 0).length} selected {runResult.coverage.filter(c => c.agents_in_file === 0).length === 1 ? 'agency' : 'agencies'}:
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {runResult.coverage.filter(c => c.agents_in_file === 0).map(c => c.owner_name).join(', ')}
                    {' — '}check you uploaded the right export before resolving anything.
                  </p>
                </div>
              )}

              {runResult.unmatched_agents?.length > 0 && (
                <div className="col-span-2 sm:col-span-4">
                  <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 mb-1">Unmatched agent names from Snapshot:</p>
                  {runResult.source_format === 'policy_lines' ? (
                    // Names in this export aren't in a fixed format, so a name that neither
                    // its policy numbers nor its spelling settles is handed to a person.
                    <div className="space-y-2">
                      {runResult.unmatched_agents.map((w, i) => (
                        <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-amber-500/10 px-3 py-2">
                          <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">{w.agent_name}</span>
                          <span className="text-xs text-amber-600/80 dark:text-amber-300/70">
                            {w.lines} line{w.lines !== 1 ? 's' : ''} · {fmtAmt(w.snapshot_apv)}{w.carrier ? ` · ${w.carrier}` : ''}
                          </span>
                          <AssignAgent
                            candidates={w.candidates}
                            personnel={personnel}
                            disabled={running}
                            onAssign={sfgId => assignAgent(w.agent_name, sfgId)}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {runResult.unmatched_agents.map((w, i) => (
                        <span key={i} className="text-xs bg-amber-500/10 text-amber-600 dark:text-amber-300 px-2 py-0.5 rounded-full">
                          {w.agent_name} ({w.carrier})
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {runResult.agent_matches?.length > 0 && (
                <AgentMatchPanel matches={runResult.agent_matches} />
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Duplicate Policy Panel ──────────────────────────────────────────── */}
      {dupePolicies.length > 0 && (
        <div className="bg-white dark:bg-primary/30 border border-amber-300 dark:border-amber-600/40 rounded-2xl overflow-hidden">
          <button
            onClick={() => setDupeOpen(v => !v)}
            className="w-full flex items-center justify-between px-6 py-4 text-left"
          >
            <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">
              ⚠ {dupePolicies.length} Duplicate Policy Number{dupePolicies.length !== 1 ? 's' : ''} — Review before proceeding
            </span>
            <svg className={`w-4 h-4 text-amber-600 dark:text-amber-400 transition-transform ${dupeOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/></svg>
          </button>
          {dupeOpen && (
            <div className="px-6 pb-4 overflow-x-auto">
              <table className="w-full text-xs min-w-[600px]">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-white/10">
                    {['Policy No', 'Applicant', 'Agent', 'Carrier', 'Issue Date', 'APV'].map(h => (
                      <th key={h} className="text-left text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-white/40 pb-2 pr-4">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                  {dupePolicies.map((d, i) => (
                    <tr key={i}>
                      <td className="py-2 pr-4 font-mono text-amber-600 dark:text-amber-300">{d.policy_no}</td>
                      <td className="py-2 pr-4 text-gray-700 dark:text-white/80">{d.applicant}</td>
                      <td className="py-2 pr-4 text-gray-600 dark:text-white/60">{d.agent}</td>
                      <td className="py-2 pr-4 text-gray-600 dark:text-white/60">{d.carrier}</td>
                      <td className="py-2 pr-4 text-gray-500 dark:text-white/50">{fmtDate(d.issue_date)}</td>
                      <td className="py-2 pr-4 text-gray-600 dark:text-white/60 tabular-nums">{fmtAmt(d.apv)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Policy Number Fixes ─────────────────────────────────────────────── */}
      {/* The same policy under two numbers: Snapshot and the tracker agree on the
          agent, client and APV but not the number — worth correcting in the tracker
          so the next reconciliation can match it directly. */}
      {numberFixes.length > 0 && (
        <div className="bg-white dark:bg-primary/30 border border-amber-300 dark:border-amber-600/40 rounded-2xl overflow-hidden">
          <button
            onClick={() => setFixesOpen(v => !v)}
            className="w-full flex items-center justify-between px-6 py-4 text-left"
          >
            <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">
              {numberFixes.length} tracker policy number{numberFixes.length !== 1 ? 's' : ''} differ{numberFixes.length === 1 ? 's' : ''} from Snapshot
            </span>
            <svg className={`w-4 h-4 text-amber-600 dark:text-amber-400 transition-transform ${fixesOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/></svg>
          </button>
          {fixesOpen && (
            <div className="px-6 pb-4 overflow-x-auto">
              <p className="text-xs text-gray-500 dark:text-white/50 mb-2">Matched on agent, client and APV instead of policy number.</p>
              <table className="w-full text-xs min-w-[600px]">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-white/10">
                    {['Agent', 'Carrier', 'Client', 'APV', 'Snapshot #', 'Tracker #'].map(h => (
                      <th key={h} className="text-left text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-white/40 pb-2 pr-4">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                  {numberFixes.map((f, i) => (
                    <tr key={i}>
                      <td className="py-2 pr-4 text-gray-700 dark:text-white/80">{f.agent_name}</td>
                      <td className="py-2 pr-4 text-gray-600 dark:text-white/60">{f.carrier}</td>
                      <td className="py-2 pr-4 text-gray-600 dark:text-white/60">{f.applicant || f.client}</td>
                      <td className="py-2 pr-4 text-gray-600 dark:text-white/60 tabular-nums">{fmtAmt(f.apv)}</td>
                      <td className="py-2 pr-4 font-mono text-green-600 dark:text-green-400">{f.file_number}</td>
                      <td className="py-2 pr-4 font-mono text-amber-600 dark:text-amber-300">{f.tracker_number}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Discrepancy Cards ───────────────────────────────────────────────── */}
      {sorted.length === 0 && reconciliations.length === 0 && (
        isFinal && runResult && runResult.summary?.discrepant_agents === 0 ? (
          // The point of a final review: a clean run is the goal, so say so.
          <div className="rounded-2xl border border-green-300 dark:border-green-600/40 bg-green-50 dark:bg-green-500/10 p-8 text-center">
            <p className="text-sm font-semibold text-green-700 dark:text-green-300">
              ✓ Everything aligns — the tracker matches the final ledger for all {runResult.summary.clean_agents} agent{runResult.summary.clean_agents === 1 ? '' : 's'} in this file.
            </p>
          </div>
        ) : (
          <div className="bg-white dark:bg-primary/30 border border-gray-200 dark:border-white/10 rounded-2xl p-10 text-center">
            <p className="text-sm text-gray-400 dark:text-white/40">
              {isFinal
                ? (cycle?.completed_at
                    ? 'No Final Review was recorded for this cycle.'
                    : 'Nothing to review yet. Upload the final Snapshot report and run the comparison.')
                : 'No discrepancies yet. Upload a Snapshot report to run the comparison.'}
            </p>
          </div>
        )
      )}

      {sorted.map(rec => {
        const isExpanded     = expanded[rec.id] ?? !rec.resolution
        const isDisputing    = disputingCandidate?.recId === rec.id
        // Final Review has no disputes: they were worked in Step 2, and what's left is edited.
        const linkedDisputes = isFinal ? [] : disputes.filter(d => d.reconciliation_id === rec.id)

        // Parse analysis from stored JSON (populated by run.js)
        let analysis = null
        if (rec.claude_hypothesis) {
          try {
            const p = JSON.parse(rec.claude_hypothesis)
            if (p && 'candidates' in p) analysis = p
          } catch {}
        }

        const mechanicalFlags = rec.mechanical_flags ?? []

        const recSfgUpper = rec.sfg_id?.toUpperCase()
        const agentName = rec.agent_name
          || personnel.find(p => p.sfg_id?.toUpperCase() === recSfgUpper)?.opt_name
          || rec.sfg_id

        return (
          <div key={rec.id} className={`bg-white dark:bg-primary/30 border rounded-2xl overflow-hidden transition-colors ${rec.resolution ? 'border-gray-200 dark:border-white/10 opacity-75' : 'border-gray-200 dark:border-white/15'}`}>
            {/* Card header */}
            <button
              onClick={() => setExpanded(e => ({ ...e, [rec.id]: !isExpanded }))}
              className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-4 flex-wrap">
                <span className="text-sm font-bold text-gray-900 dark:text-white">{agentName}</span>
                <span className="text-sm text-gray-500 dark:text-white/50">{rec.carrier}</span>
                <span className="text-xs text-gray-400 dark:text-white/40">Tracker: <strong className="text-gray-700 dark:text-white/80">{fmtAmt(rec.db_apv)}</strong></span>
                <span className="text-xs text-gray-400 dark:text-white/40">Snapshot: <strong className="text-gray-700 dark:text-white/80">{fmtAmt(rec.snapshot_apv)}</strong></span>
                <span className={`text-xs font-bold ${rec.delta > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                  Δ {rec.delta >= 0 ? '+' : ''}{fmtAmt(rec.delta)}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                <ResolutionBadge resolution={rec.resolution} phase={phase} />
                <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/></svg>
              </div>
            </button>

            {isExpanded && (
              <div className="border-t border-gray-100 dark:border-white/10 px-6 pb-6 pt-4 space-y-4">

                {/* How the tracker figure was built (recorded by the newer runs) */}
                {analysis?.tracker && (
                  <p className="text-xs text-gray-400 dark:text-white/40">
                    Tracker = issued {fmtAmt(analysis.tracker.issued ?? 0)}
                    {analysis.tracker.chargebacks ? ` − chargebacks logged ${fmtAmt(analysis.tracker.chargebacks)}` : ''}
                    {analysis.source === 'policy_lines' && !analysis.lump && ` · ${analysis.matched_lines} matching ${analysis.matched_lines === 1 ? 'policy' : 'policies'}`}
                    {Math.abs(analysis.rounding ?? 0) >= 0.005 ? ` · ${fmtAmt(analysis.rounding)} carrier rounding` : ''}
                  </p>
                )}

                {/* Mechanical flags */}
                {mechanicalFlags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {mechanicalFlags.map((f, i) => <FlagBadge key={i} flag={f} />)}
                  </div>
                )}

                {/* Linked disputes (pinned) */}
                {linkedDisputes.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-gray-500 dark:text-white/40 uppercase tracking-wide">Linked Disputes</p>
                    {linkedDisputes.map(d => {
                      const isEditingThis   = editingDisputeId === d.id
                      const isDeletingThis  = deletingDisputeId === d.id
                      const isSavingThis    = savingId === d.id
                      const amtDisplay      = d.disputed_amount != null
                        ? `${d.disputed_amount >= 0 ? '+' : ''}${fmtAmt(d.disputed_amount)}`
                        : null

                      if (isEditingThis) return (
                        <div key={d.id} className="rounded-xl border border-amber-300 dark:border-amber-600/50 bg-amber-50 dark:bg-amber-500/5 px-4 py-3 space-y-3">
                          <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                            Edit dispute{d.applicant ? `: ${d.applicant}` : ''}
                          </p>
                          <div className="flex flex-wrap items-center gap-3">
                            <div className="flex items-center gap-1.5">
                              <label className="text-xs text-gray-500 dark:text-white/50 whitespace-nowrap">Amount:</label>
                              <span className="text-xs text-gray-400 dark:text-white/40">$</span>
                              <input
                                type="text" inputMode="decimal"
                                value={disputeEditAmt}
                                onChange={e => setDisputeEditAmt(e.target.value)}
                                className="w-28 text-sm font-semibold bg-white dark:bg-primary/60 border border-gray-300 dark:border-white/20 text-gray-900 dark:text-white rounded-lg px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-accent/60 tabular-nums"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500 dark:text-white/50">Effect:</span>
                              <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-white/20">
                                <button type="button" onClick={() => setDisputeEditDir('add')}
                                  className={`text-xs px-3 py-1 transition-colors ${disputeEditDir === 'add' ? 'bg-green-500/20 text-green-700 dark:text-green-300 font-semibold' : 'text-gray-400 dark:text-white/40 hover:bg-gray-50 dark:hover:bg-white/5'}`}>
                                  Adds to Snapshot</button>
                                <button type="button" onClick={() => setDisputeEditDir('reduce')}
                                  className={`text-xs px-3 py-1 border-l border-gray-300 dark:border-white/20 transition-colors ${disputeEditDir === 'reduce' ? 'bg-red-500/20 text-red-600 dark:text-red-400 font-semibold' : 'text-gray-400 dark:text-white/40 hover:bg-gray-50 dark:hover:bg-white/5'}`}>
                                  Reduces Snapshot</button>
                              </div>
                            </div>
                          </div>
                          <textarea rows={2} value={disputeEditNote} onChange={e => setDisputeEditNote(e.target.value)}
                            placeholder="Notes (optional)…" className={INPUT + ' resize-none'} />
                          {disputeEditErr && <p className="text-xs text-red-500 dark:text-red-400">{disputeEditErr}</p>}
                          <div className="flex gap-2">
                            <button type="button" onClick={() => handleDisputeUpdate(d.id)} disabled={isSavingThis}
                              className="text-xs px-3 py-1.5 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 transition-colors disabled:opacity-60">
                              {isSavingThis ? 'Saving…' : 'Save'}
                            </button>
                            <button type="button" onClick={() => setEditingDisputeId(null)}
                              className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-white/20 text-gray-500 dark:text-white/50 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                              Cancel
                            </button>
                          </div>
                        </div>
                      )

                      if (isDeletingThis) return (
                        <div key={d.id} className="flex items-center justify-between rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 px-4 py-2.5 gap-3">
                          <p className="text-xs text-red-700 dark:text-red-400">
                            Remove this dispute{d.applicant ? ` (${d.applicant})` : ''}?
                          </p>
                          <div className="flex gap-2 flex-shrink-0">
                            <button type="button" onClick={() => handleDisputeDelete(d.id)} disabled={isSavingThis}
                              className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-60">
                              {isSavingThis ? 'Removing…' : 'Remove'}
                            </button>
                            <button type="button" onClick={() => setDeletingDisputeId(null)}
                              className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-white/20 text-gray-500 dark:text-white/50 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                              Cancel
                            </button>
                          </div>
                        </div>
                      )

                      return (
                        <div key={d.id} className="flex items-center justify-between rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 px-4 py-2.5 gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-xs font-semibold text-amber-700 dark:text-amber-300 flex-shrink-0">Dispute</span>
                            <span className="text-xs text-gray-700 dark:text-white/70 truncate">
                              {d.applicant || d.policy_number || d.dispute_type || 'Unnamed'}
                            </span>
                            {d.policy_number && d.applicant && (
                              <span className="text-xs text-gray-400 dark:text-white/40 truncate font-mono">#{d.policy_number}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {amtDisplay && (
                              <span className="text-xs font-semibold text-amber-700 dark:text-amber-300 tabular-nums">{amtDisplay}</span>
                            )}
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${d.status === 'resolved' ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400' : 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300'}`}>
                              {d.status ?? 'open'}
                            </span>
                            {!readOnly && !rec.resolution && (
                              <>
                                <button type="button" onClick={() => startEditDispute(d)}
                                  className="text-xs px-2.5 py-1 rounded-lg bg-white dark:bg-white/10 text-gray-600 dark:text-white/60 hover:bg-gray-100 dark:hover:bg-white/15 border border-gray-200 dark:border-white/15 transition-colors">
                                  Edit
                                </button>
                                <button type="button" onClick={() => setDeletingDisputeId(d.id)}
                                  className="text-xs px-2.5 py-1 rounded-lg bg-white dark:bg-white/10 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 border border-gray-200 dark:border-white/15 transition-colors">
                                  Remove
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Analysis: AI candidates */}
                {analysis?.candidates?.length > 0 && (
                  <div className="space-y-2">
                    {analysis.candidates.map((c, i) => (
                      <CandidateRow
                        key={i}
                        candidate={c}
                        onEdit={() => openEditPolicy({ ...c, carrier: rec.carrier, sfg_id: rec.sfg_id })}
                        onDispute={isFinal ? undefined : () => {
                          setDisputingCandidate({ recId: rec.id, candidate: c })
                          setCandidateDisputeNote('')
                          setCandidateDisputeAmount(String(Math.abs(c.delta_contribution ?? 0)))
                          // Policy-level items carry a signed difference: Snapshot above the
                          // tracker is an overstatement to reduce, below it is credit to add.
                          setCandidateDisputeDirection(c.signed && c.delta_contribution > 0 ? 'reduce' : 'add')
                        }}
                        canWrite={!readOnly && !rec.resolution}
                      />
                    ))}
                  </div>
                )}

                {/* Policy search — shown when no clean AI candidates, or when disputes are linked (in case a second is needed) */}
                {(!analysis?.candidates?.length || linkedDisputes.length > 0) && <div className="space-y-3">
                    {analysis?.unmatched && !analysis?.candidates?.length && (
                      <p className="text-xs text-gray-400 dark:text-white/40 italic">
                        No automatic match found for Δ {fmtAmt(rec.delta)} — search for the policy below.
                      </p>
                    )}
                    {/* Persistent policy search */}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={policySearches[rec.id] ?? ''}
                        onChange={e => handlePolicySearch(rec, e.target.value)}
                        placeholder="Search by applicant name or policy #…"
                        className={INPUT}
                      />
                      {searchingId === rec.id && (
                        <svg className="w-4 h-4 animate-spin text-gray-400 flex-shrink-0 mt-1.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                      )}
                    </div>
                    {(policyResults[rec.id] ?? []).map((p, i) => (
                      <CandidateRow
                        key={i}
                        candidate={{ ...p, flag: 'Search result', type: 'search', delta_contribution: p.issued_apv, policy_id: p.id }}
                        onEdit={() => openEditPolicy({ ...p, sfg_id: rec.sfg_id })}
                        onDispute={isFinal ? undefined : () => {
                          const cand = { ...p, flag: 'Search result', type: 'search', delta_contribution: p.issued_apv, policy_id: p.id }
                          setDisputingCandidate({ recId: rec.id, candidate: cand })
                          setCandidateDisputeNote('')
                          setCandidateDisputeAmount(String(Math.abs(p.issued_apv ?? 0)))
                          setCandidateDisputeDirection('add')
                        }}
                        canWrite={!readOnly && !rec.resolution}
                      />
                    ))}
                    {policySearches[rec.id]?.trim() && policyResults[rec.id]?.length === 0 && searchingId !== rec.id && (
                      <p className="text-xs text-gray-400 dark:text-white/40">No policies found.</p>
                    )}
                  </div>}

                {/* Per-candidate dispute inline form */}
                {isDisputing && (
                  <div className="rounded-xl border border-amber-300 dark:border-amber-600/50 bg-amber-50 dark:bg-amber-500/5 px-4 py-3 space-y-3">
                    <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                      Generate dispute: {disputingCandidate.candidate.applicant}
                    </p>

                    {/* Amount + direction */}
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <label className="text-xs text-gray-500 dark:text-white/50 whitespace-nowrap">Amount in dispute:</label>
                        <span className="text-xs text-gray-400 dark:text-white/40">$</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={candidateDisputeAmount}
                          onChange={e => setCandidateDisputeAmount(e.target.value)}
                          className="w-28 text-sm font-semibold bg-white dark:bg-primary/60 border border-gray-300 dark:border-white/20 text-gray-900 dark:text-white rounded-lg px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-accent/60 tabular-nums"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 dark:text-white/50">Effect on total:</span>
                        <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-white/20">
                          <button
                            type="button"
                            onClick={() => setCandidateDisputeDirection('add')}
                            className={`text-xs px-3 py-1 transition-colors ${candidateDisputeDirection === 'add' ? 'bg-green-500/20 text-green-700 dark:text-green-300 font-semibold' : 'text-gray-400 dark:text-white/40 hover:bg-gray-50 dark:hover:bg-white/5'}`}
                          >Adds to Snapshot</button>
                          <button
                            type="button"
                            onClick={() => setCandidateDisputeDirection('reduce')}
                            className={`text-xs px-3 py-1 border-l border-gray-300 dark:border-white/20 transition-colors ${candidateDisputeDirection === 'reduce' ? 'bg-red-500/20 text-red-600 dark:text-red-400 font-semibold' : 'text-gray-400 dark:text-white/40 hover:bg-gray-50 dark:hover:bg-white/5'}`}
                          >Reduces Snapshot</button>
                        </div>
                      </div>
                    </div>

                    <textarea
                      rows={2}
                      value={candidateDisputeNote}
                      onChange={e => setCandidateDisputeNote(e.target.value)}
                      placeholder="Notes (optional)…"
                      className={INPUT + ' resize-none'}
                    />
                    {disputeError && (
                      <p className="text-xs text-red-500 dark:text-red-400">{disputeError}</p>
                    )}
                    <div className="flex gap-2">
                      <button type="button" onClick={() => handleCandidateDispute(rec, disputingCandidate.candidate)} disabled={savingId === rec.id} className="text-xs px-3 py-1.5 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 transition-colors disabled:opacity-60">
                        {savingId === rec.id ? 'Saving…' : 'Generate Dispute'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setDisputingCandidate(null); setCandidateDisputeAmount(''); setCandidateDisputeDirection('add'); setDisputeError(null) }}
                        className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-white/20 text-gray-500 dark:text-white/50 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                      >Cancel</button>
                    </div>
                  </div>
                )}

                {/* Resolution footer */}
                {!readOnly && (
                  <div className="pt-2 border-t border-gray-100 dark:border-white/10">
                    {!rec.resolution ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleResolve(rec, linkedDisputes.length > 0 ? 'disputed' : 'legitimate')}
                          disabled={savingId === rec.id}
                          className="text-xs px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-60"
                        >
                          {savingId === rec.id ? 'Saving…' : 'Mark Resolved'}
                        </button>
                        <span className="text-xs text-gray-400 dark:text-white/30">
                          {isFinal ? '→ Accepted as it stands' : linkedDisputes.length > 0 ? '→ Sent to Disputes' : '→ Legitimate'}
                        </span>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleUnresolve(rec)}
                        disabled={savingId === rec.id}
                        className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/15 text-gray-400 dark:text-white/40 hover:bg-gray-50 dark:hover:bg-white/5 hover:text-gray-600 dark:hover:text-white/60 transition-colors disabled:opacity-60"
                      >
                        Reopen
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* ── Completion gate ─────────────────────────────────────────────────── */}
      {(() => {
        if (cycle?.completed_at || !canWrite) return null
        // Step 1 has cards to resolve before it can move on. A Final Review is aiming
        // for NONE, so a run that found nothing left to fix is enough to proceed.
        const cleanRun = isFinal && reconciliations.length === 0 && runResult?.summary?.discrepant_agents === 0
        if (allResolved || cleanRun) {
          return (
            <div className="flex justify-end">
              <button
                onClick={onStepComplete}
                className="text-sm font-semibold bg-accent text-white px-6 py-2 rounded-xl hover:bg-accent/90 transition-colors"
              >
                {isFinal ? 'Proceed to Promotions →' : 'Proceed to Disputes →'}
              </button>
            </div>
          )
        }
        // Nothing is recorded — the page was reloaded after a clean run, or no review was run.
        if (isFinal && reconciliations.length === 0) {
          return (
            <div className="flex justify-end">
              <button
                onClick={() => {
                  if (window.confirm('No Final Review results are recorded for this cycle. Continue to Promotions without one?')) onStepComplete()
                }}
                className="text-xs text-gray-400 dark:text-white/40 underline hover:text-gray-600 dark:hover:text-white/60 transition-colors"
              >
                Continue to Promotions without a Final Review
              </button>
            </div>
          )
        }
        return null
      })()}

      {/* Policy edit modal */}
      {editPolicy && (
        <PolicyModalErrorBoundary onClose={() => setEditPolicy(null)}>
          <PolicyModal
            policy={editPolicy}
            personnel={personnel}
            onClose={() => setEditPolicy(null)}
            canWrite={canWrite}
            limitedFields
            initialEdit={canWrite}
            onUpdate={updated => {
              setEditPolicy(null)
              updateImp({ edited: true })
              onRefresh()
            }}
            onDelete={() => {
              setEditPolicy(null)
              updateImp({ edited: true })
              onRefresh()
            }}
          />
        </PolicyModalErrorBoundary>
      )}
    </div>
  )
}

// ─── Candidate Row ────────────────────────────────────────────────────────────

const CANDIDATE_STYLES = {
  chargeback: { border: 'border-amber-200 dark:border-amber-600/30',  bg: 'bg-amber-50 dark:bg-amber-500/5',   badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  non_issued: { border: 'border-blue-200 dark:border-blue-600/30',    bg: 'bg-blue-50 dark:bg-blue-500/5',     badge: 'bg-blue-500/15 text-blue-600 dark:text-blue-300'   },
  straddle:   { border: 'border-purple-200 dark:border-purple-600/30',bg: 'bg-purple-50 dark:bg-purple-500/5', badge: 'bg-purple-500/15 text-purple-700 dark:text-purple-300' },
  not_taken:  { border: 'border-orange-200 dark:border-orange-600/30',bg: 'bg-orange-50 dark:bg-orange-500/5', badge: 'bg-orange-500/15 text-orange-700 dark:text-orange-300' },
  missing:    { border: 'border-red-200 dark:border-red-600/30',      bg: 'bg-red-50 dark:bg-red-500/5',       badge: 'bg-red-500/15 text-red-600 dark:text-red-400'       },
  search:     { border: 'border-gray-200 dark:border-white/15',       bg: 'bg-gray-50 dark:bg-white/5',        badge: 'bg-gray-200 dark:bg-white/10 text-gray-600 dark:text-white/60' },
  // Policy-level findings from a Placed Policies export
  apv_diff:               { border: 'border-amber-200 dark:border-amber-600/30',   bg: 'bg-amber-50 dark:bg-amber-500/5',   badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300'   },
  not_issued:             { border: 'border-blue-200 dark:border-blue-600/30',     bg: 'bg-blue-50 dark:bg-blue-500/5',     badge: 'bg-blue-500/15 text-blue-600 dark:text-blue-300'     },
  outside_window:         { border: 'border-purple-200 dark:border-purple-600/30', bg: 'bg-purple-50 dark:bg-purple-500/5', badge: 'bg-purple-500/15 text-purple-700 dark:text-purple-300' },
  agent_mismatch:         { border: 'border-teal-200 dark:border-teal-600/30',     bg: 'bg-teal-50 dark:bg-teal-500/5',     badge: 'bg-teal-500/15 text-teal-700 dark:text-teal-300'     },
  split:                  { border: 'border-indigo-200 dark:border-indigo-600/30', bg: 'bg-indigo-50 dark:bg-indigo-500/5', badge: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300' },
  not_in_tracker:         { border: 'border-red-200 dark:border-red-600/30',       bg: 'bg-red-50 dark:bg-red-500/5',       badge: 'bg-red-500/15 text-red-600 dark:text-red-400'        },
  reversal_unlogged:      { border: 'border-orange-200 dark:border-orange-600/30', bg: 'bg-orange-50 dark:bg-orange-500/5', badge: 'bg-orange-500/15 text-orange-700 dark:text-orange-300' },
  reversal_diff:          { border: 'border-amber-200 dark:border-amber-600/30',   bg: 'bg-amber-50 dark:bg-amber-500/5',   badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300'   },
  chargeback_not_in_file: { border: 'border-amber-200 dark:border-amber-600/30',   bg: 'bg-amber-50 dark:bg-amber-500/5',   badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300'   },
}

function CandidateRow({ candidate: c, onEdit, onDispute, canWrite }) {
  const s = CANDIDATE_STYLES[c.type] ?? CANDIDATE_STYLES.missing

  return (
    <div className={`flex items-start justify-between gap-4 rounded-xl border ${s.border} ${s.bg} px-4 py-3`}>
      <div className="space-y-0.5 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.badge}`}>{c.flag}</span>
          {c.match && c.match !== 'full' && <span className="text-xs text-gray-400 dark:text-white/40">{c.match} of APV</span>}
        </div>
        <p className="text-sm font-medium text-gray-800 dark:text-white/80">
          {c.applicant} <span className="text-gray-400 dark:text-white/40 font-normal">#{c.policy_number}</span>
        </p>
        {c.signed ? (
          <div className="flex flex-wrap gap-x-4 text-xs text-gray-500 dark:text-white/50">
            <span>Snapshot: <strong className="text-gray-700 dark:text-white/70">{fmtAmt(c.snapshot_apv ?? 0)}</strong></span>
            <span>Tracker: <strong className="text-gray-700 dark:text-white/70">{fmtAmt(c.tracker_apv ?? 0)}</strong></span>
            <span>Δ <strong className={c.delta_contribution > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}>{c.delta_contribution > 0 ? '+' : ''}{fmtAmt(c.delta_contribution)}</strong></span>
            {c.issue_date && <span>Issue date: <strong className="text-gray-700 dark:text-white/70">{fmtDate(c.issue_date)}</strong></span>}
            {c.status && <span>Status: {c.status}</span>}
            {c.conservation_date && <span>CB date: <strong className="text-gray-700 dark:text-white/70">{fmtDate(c.conservation_date)}</strong>{c.conservation_status ? ` · ${c.conservation_status}` : ''}</span>}
          </div>
        ) : (
        <div className="flex flex-wrap gap-x-4 text-xs text-gray-500 dark:text-white/50">
          <span>APV: <strong className="text-gray-700 dark:text-white/70">{fmtAmt(c.issued_apv)}</strong></span>
          {c.match && c.match !== 'full' && <span>Contribution: <strong className="text-gray-700 dark:text-white/70">{fmtAmt(c.delta_contribution)}</strong></span>}
          {c.conservation_date && <span>CB date: <strong className="text-gray-700 dark:text-white/70">{fmtDate(c.conservation_date)}</strong>{c.conservation_status ? ` · ${c.conservation_status}` : ''}</span>}
          {c.issue_date && (c.type === 'straddle' || c.type === 'missing' || c.type === 'search') && <span>Issue date: <strong className="text-gray-700 dark:text-white/70">{fmtDate(c.issue_date)}</strong></span>}
          {c.status && (c.type === 'non_issued' || c.type === 'search') && <span>Status: {c.status}</span>}
          {c.submit_date && c.type === 'non_issued' && <span>Submitted: {fmtDate(c.submit_date)}</span>}
        </div>
        )}
        {c.note && <p className="text-xs text-gray-600 dark:text-white/60 mt-0.5">{c.note}</p>}
        {c.signed && c.client && (
          <p className="text-xs text-gray-400 dark:text-white/40">Snapshot client: {c.client}{c.product ? ` · ${c.product}` : ''}</p>
        )}
        {c.flag === 'Flag for review' && c.application_notes && (
          <p className="text-xs text-gray-600 dark:text-white/60 italic mt-0.5">{c.application_notes}</p>
        )}
      </div>
      {canWrite && (
        <div className="flex gap-2 flex-shrink-0">
          {c.policy_id && <button onClick={onEdit} className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-white/60 hover:bg-gray-200 dark:hover:bg-white/15 transition-colors font-medium whitespace-nowrap">Edit</button>}
          {onDispute && <button onClick={onDispute} className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300 hover:bg-amber-500/25 transition-colors font-medium whitespace-nowrap">Generate Dispute</button>}
        </div>
      )}
    </div>
  )
}

// ─── Agent matching (Placed Policies export) ──────────────────────────────────

const MATCH_BASIS = {
  'name+policy': 'name + policy #s',
  policy:        'policy #s only',
  name:          'name only',
  manual:        'chosen by you',
}

// Names in this export aren't in a fixed format, so show HOW each one was matched —
// the ones settled by something other than an exact name deserve a glance.
function AgentMatchPanel({ matches }) {
  const [open,    setOpen]    = useState(false)
  const [showAll, setShowAll] = useState(false)

  const review = matches.filter(m => !m.exact)
  const shown  = (showAll ? matches : review)
    .slice()
    .sort((a, b) => Number(a.exact) - Number(b.exact) || a.agent_name.localeCompare(b.agent_name))

  return (
    <div className="col-span-2 sm:col-span-4">
      <button
        onClick={() => setOpen(v => !v)}
        className="text-xs font-semibold text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white/70 transition-colors"
      >
        {open ? '▾' : '▸'} Agent matching — {matches.length - review.length} matched by exact name
        {review.length > 0 ? `, ${review.length} matched by policy # or a close name` : ''}
      </button>
      {open && (
        <div className="mt-2 rounded-xl border border-gray-100 dark:border-white/10 overflow-x-auto">
          <table className="w-full text-xs min-w-[560px]">
            <thead className="bg-gray-50 dark:bg-white/5">
              <tr>
                {['In file', 'Matched to', 'Basis', 'Evidence'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-white/40 px-3 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/5">
              {shown.map(m => (
                <tr key={m.agent_name}>
                  <td className="px-3 py-2 text-gray-800 dark:text-white/80">{m.agent_name}</td>
                  <td className="px-3 py-2 text-gray-700 dark:text-white/70">
                    {m.matched_name} <span className="font-mono text-gray-400 dark:text-white/40">{m.sfg_id}</span>
                    {!m.in_scope && <span className="ml-2 text-gray-400 dark:text-white/40">(outside this cycle)</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-500 dark:text-white/50">{MATCH_BASIS[m.basis] ?? m.basis}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-white/50">
                    {m.policy_matches > 0
                      ? `${m.policy_matches} policy # match${m.policy_matches !== 1 ? 'es' : ''}`
                      : m.shared_matches > 0 ? 'split policy # only' : 'no policy #s to check'}
                    {' · '}name {Math.round(m.name_score * 100)}%
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-3 text-gray-400 dark:text-white/40">Every agent matched by exact name.</td></tr>
              )}
            </tbody>
          </table>
          {matches.length > review.length && (
            <button
              onClick={() => setShowAll(v => !v)}
              className="w-full text-xs text-gray-400 dark:text-white/40 hover:text-gray-600 dark:hover:text-white/60 py-2 border-t border-gray-100 dark:border-white/10 transition-colors"
            >
              {showAll ? 'Show only the ones to review' : `Show all ${matches.length} agents`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Picks who an unresolved file name is — from the closest matches the server
// ranked, or by searching the whole roster.
function AssignAgent({ candidates, personnel, disabled, onAssign }) {
  const [choice, setChoice] = useState('')
  const [query,  setQuery]  = useState('')
  const listId = useId()

  // A roster suggestion is entered as "Name · SFG0000000"; pull the id back out.
  const typed  = (query.match(/SFG\d+/i) ?? [])[0]?.toUpperCase()
  const sfgId  = typed || choice
  const field  = 'text-xs bg-white dark:bg-primary/60 border border-gray-200 dark:border-white/15 text-gray-700 dark:text-white/80 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-accent/60'

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {candidates?.length > 0 && (
        <select value={choice} onChange={e => { setChoice(e.target.value); setQuery('') }} className={field}>
          <option value="">Closest matches…</option>
          {candidates.map(c => (
            <option key={c.sfg_id} value={c.sfg_id}>
              {c.name} · {c.sfg_id}{c.policy_matches ? ` · ${c.policy_matches} policy #` : ''}
            </option>
          ))}
        </select>
      )}
      <input
        list={listId}
        value={query}
        onChange={e => { setQuery(e.target.value); setChoice('') }}
        placeholder="or search the roster…"
        className={`${field} w-44`}
      />
      <datalist id={listId}>
        {personnel.map(p => (
          <option key={p.sfg_id} value={`${p.preferred_name || p.opt_name} · ${p.sfg_id}`} />
        ))}
      </datalist>
      <button
        onClick={() => onAssign(sfgId)}
        disabled={disabled || !sfgId}
        className="text-xs font-semibold px-3 py-1 rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Assign &amp; re-run
      </button>
    </span>
  )
}

// ─── Policy Table ─────────────────────────────────────────────────────────────

function PolicyTable({ policies, title, onEdit }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-white/40 mb-2">{title}</p>
      <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-white/10">
        <table className="w-full text-xs min-w-[700px]">
          <thead className="bg-gray-50 dark:bg-white/5">
            <tr>
              {['Applicant', 'Policy #', 'Issue Date', 'APV', 'Status', 'Conservation', 'CB Month', 'CB APV', 'Notes'].map(h => (
                <th key={h} className="text-left text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-white/40 px-3 py-2 whitespace-nowrap">{h}</th>
              ))}
              {onEdit && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-white/5">
            {policies.map((p, i) => (
              <tr key={i} className="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                <td className="px-3 py-2 text-gray-800 dark:text-white/80">{p.applicant}</td>
                <td className="px-3 py-2 font-mono text-gray-600 dark:text-white/60">{p.policy_number || p.policy_no || '—'}</td>
                <td className="px-3 py-2 text-gray-500 dark:text-white/50 whitespace-nowrap">{fmtDate(p.issue_date)}</td>
                <td className="px-3 py-2 tabular-nums text-gray-700 dark:text-white/80">{fmtAmt(p.issued_apv)}</td>
                <td className="px-3 py-2 text-gray-500 dark:text-white/50">{p.status || '—'}</td>
                <td className="px-3 py-2 text-gray-500 dark:text-white/50">{p.conservation_status || '—'}</td>
                <td className="px-3 py-2 text-gray-500 dark:text-white/50 whitespace-nowrap">{p.snapshot_chargeback_month || '—'}</td>
                <td className="px-3 py-2 tabular-nums text-gray-500 dark:text-white/50">{p.snapshot_chargeback_apv ? fmtAmt(p.snapshot_chargeback_apv) : '—'}</td>
                <td className="px-3 py-2 text-gray-400 dark:text-white/40 max-w-[120px] truncate">{p.policy_notes || '—'}</td>
                {onEdit && (
                  <td className="px-3 py-2">
                    <button onClick={() => onEdit({ ...p, policy_type: p.policy_name, policy_no: p.policy_number })} className="text-xs text-accent hover:underline whitespace-nowrap">Edit</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}


function SummaryChip({ label, value, color }) {
  const colorCls = color === 'green'
    ? 'text-green-600 dark:text-green-300'
    : color === 'red'
      ? 'text-red-500 dark:text-red-400'
      : 'text-gray-900 dark:text-white'
  return (
    <div className="bg-gray-50 dark:bg-primary/60 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2">
      <p className="text-xs text-gray-400 dark:text-white/40 mb-0.5">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${colorCls}`}>{value}</p>
    </div>
  )
}

function safeJson(val) {
  if (!val) return null
  if (Array.isArray(val)) return val
  if (typeof val === 'object') return val
  try { return JSON.parse(val) } catch { return null }
}
