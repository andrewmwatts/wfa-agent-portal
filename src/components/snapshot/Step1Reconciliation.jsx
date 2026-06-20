import { useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import PolicyModal, { PolicyModalErrorBoundary } from '../PolicyEditModal'
import { fmtDate, fmtCurrency as fmtAmt } from '../../utils/format'
import { normalizeCarrier } from '../../../shared/carriers'

// Snapshot-specific carrier normalization (mirrors api/snapshot/run.js)
const SNAPSHOT_ALIASES = {
  'lga':                                 'Banner',
  'banner':                              'Banner',
  'foresters':                           'Foresters',
  'foresters dfl':                       'Foresters',
  'american amicable':                   'American Amicable',
  'american amicable group':             'American Amicable',
  'occidental':                          'Occidental',
  'mutual of omaha':                     'Mutual of Omaha',
  'transamerica':                        'TransAmerica',
  'transamerica group':                  'TransAmerica',
  'fidelity and guaranty':               'Fidelity and Guaranty',
  'fidelity and guaranty life annuity':  'Fidelity and Guaranty',
  'americo':                             'Americo',
  'american general':                    'American General',
  'corebridge':                          'American General',
  'sbli':                                'SBLI',
  'united home life':                    'United Home Life',
  'assurity':                            'Assurity',
  'guaranty income life':                'Guaranty Income Life',
}

function normSnapshotCarrier(raw) {
  if (!raw) return raw
  return SNAPSHOT_ALIASES[raw.trim().toLowerCase()] ?? raw.trim()
}

function parseXlsxDate(val) {
  if (!val) return null
  if (typeof val === 'number') {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(val)
    if (!d) return null
    return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`
  }
  const s = String(val).trim()
  const m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/)
  if (m) {
    const yr = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${yr}-${String(m[1]).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}`
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return s.slice(0, 10)
  return null
}

// Returns { from: 'YYYY-MM-01', to: 'YYYY-MM-DD' } for the full calendar month
function monthWindow(isoMonth) {
  const [y, m] = isoMonth.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  return { from: `${isoMonth}-01`, to: `${isoMonth}-${String(lastDay).padStart(2, '0')}` }
}

function parseSnapshotXlsx(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: false })

        // ── Sheet 2: SnapShot by Agent — parse agent rows ─────────────────────
        const agentSheet = wb.Sheets['SnapShot by Agent'] || wb.Sheets[wb.SheetNames[1]] || wb.Sheets[wb.SheetNames[0]]
        const agents = []
        if (agentSheet) {
          const rows = XLSX.utils.sheet_to_json(agentSheet, { header: 1, defval: '' })
          let headerIdx = -1
          for (let i = 0; i < rows.length; i++) {
            const a = String(rows[i][0] ?? '').trim().toLowerCase()
            const b = String(rows[i][1] ?? '').trim().toLowerCase()
            if (a === 'agent' && b.includes('up-line')) { headerIdx = i; break }
          }
          if (headerIdx === -1) {
            // Fallback: look for a row where col A says "Agent"
            for (let i = 0; i < rows.length; i++) {
              if (String(rows[i][0] ?? '').trim().toLowerCase() === 'agent') {
                headerIdx = i; break
              }
            }
          }
          if (headerIdx >= 0) {
            const headers = rows[headerIdx].map(h => String(h ?? '').trim().toLowerCase())
            const agentCol   = headers.indexOf('agent')
            const carrierCol = headers.findIndex(h => h.includes('carrier') || h.includes('company'))
            const apvCol     = headers.findIndex(h => h.includes('placed') || h.includes('apv') || h.includes('premium') || h.includes('amount'))

            for (let i = headerIdx + 1; i < rows.length; i++) {
              const row = rows[i]
              const agentName    = String(row[agentCol >= 0 ? agentCol : 0] ?? '').trim()
              const carrierName  = String(row[carrierCol >= 0 ? carrierCol : 2] ?? '').trim()
              const rawApv       = row[apvCol >= 0 ? apvCol : 3]
              const snapshotApv  = parseFloat(String(rawApv ?? '').replace(/[$,]/g, '')) || 0

              if (!agentName || agentName.toLowerCase() === 'total' || agentName.toLowerCase() === 'grand total') continue
              if (!carrierName || snapshotApv === 0) continue

              agents.push({
                agent_name:   agentName,
                carrier:      normSnapshotCarrier(carrierName),
                snapshot_apv: snapshotApv,
              })
            }
          }
        }

        resolve({ agents })
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
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

function ResolutionBadge({ resolution }) {
  if (!resolution) return null
  const cls = resolution === 'legitimate'
    ? 'bg-green-500/20 text-green-600 dark:text-green-300'
    : resolution === 'disputed'
      ? 'bg-amber-500/20 text-amber-600 dark:text-amber-300'
      : 'bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-white/50'
  const label = resolution === 'legitimate' ? 'Legitimate' : resolution === 'disputed' ? 'Sent to Disputes' : 'No Action'
  return <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${cls}`}>{label}</span>
}


export default function Step1Reconciliation({ cycle, reconciliations, personnel, canWrite, onStepComplete, onRefresh }) {
  const fileRef = useRef(null)

  const [file,          setFile]          = useState(null)
  const [parsed,        setParsed]        = useState(null) // { dateFrom, dateTo, agents }
  const [parseError,    setParseError]    = useState(null)
  const [running,       setRunning]       = useState(false)
  const [runResult,     setRunResult]     = useState(null)
  const [runError,      setRunError]      = useState(null)

  const [expanded,             setExpanded]             = useState({})
  const [resolvingId,          setResolvingId]          = useState(null)  // card in "Mark Legitimate" flow
  const [resolveNote,          setResolveNote]          = useState('')
  const [savingId,             setSavingId]             = useState(null)

  const [disputingCandidate,      setDisputingCandidate]      = useState(null)  // { recId, candidate }
  const [candidateDisputeNote,    setCandidateDisputeNote]    = useState('')
  const [candidateDisputeAmount,  setCandidateDisputeAmount]  = useState('')
  const [candidateDisputeDirection, setCandidateDisputeDirection] = useState('add')

  const [policySearches,    setPolicySearches]    = useState({})   // recId → query string
  const [policyResults,     setPolicyResults]     = useState({})   // recId → [policy]
  const [searchingId,       setSearchingId]       = useState(null)

  const [editPolicy,    setEditPolicy]    = useState(null)
  const [dupeOpen,      setDupeOpen]      = useState(false)

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

  async function handleFileChange(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setParsed(null)
    setParseError(null)
    try {
      const result = await parseSnapshotXlsx(f)
      setParsed(result)
    } catch (err) {
      setParseError(`Could not parse file: ${err.message}`)
    }
  }

  async function handleRunComparison() {
    if (!parsed || !cycle) return
    setRunning(true)
    setRunError(null)
    try {
      const res = await fetch('/api/snapshot/run', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month:           cycle.month,
          snapshot_window: monthWindow(cycle.month),
          snapshot_agents: parsed.agents,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Run failed')
      setRunResult(data)
      await onRefresh()
    } catch (err) {
      setRunError(err.message)
    } finally {
      setRunning(false)
    }
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

  function openEditPolicy(policyData) {
    setEditPolicy({ ...policyData, policy_no: policyData.policy_number ?? policyData.policy_no })
  }

  async function handleCandidateDispute(rec, candidate) {
    setSavingId(rec.id)
    try {
      const absAmt   = parseFloat(String(candidateDisputeAmount).replace(/[$,]/g, ''))
                       || Math.abs(candidate.delta_contribution ?? 0)
      const signedAmt = candidateDisputeDirection === 'reduce' ? -absAmt : absAmt
      await fetch('/api/snapshot?type=disputes', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cycle_id:          cycle.id,
          reconciliation_id: rec.id,
          sfg_id:            rec.sfg_id,
          policy_id:         candidate.policy_id,
          disputed_amount:   signedAmt,
          dispute_type:      candidate.flag,
          notes:             candidateDisputeNote || null,
        }),
      })
      setDisputingCandidate(null)
      setCandidateDisputeNote('')
      setCandidateDisputeAmount('')
      setCandidateDisputeDirection('add')
      await onRefresh()
    } catch (err) {
      console.error('dispute error', err)
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
        body: JSON.stringify({ id: rec.id, resolution, resolution_note: resolveNote || null }),
      })
      if (!res.ok) throw new Error('Failed to save resolution')
      setResolvingId(null)
      setResolveNote('')
      await onRefresh()
    } catch (err) {
      console.error('resolve error', err)
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
          <h4 className="text-sm font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">Upload Snapshot Report</h4>
          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-600 dark:text-white/70">
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
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
                Parsed: {parsed.agents.length} agent-carrier rows
                {cycle.month && (() => { const w = monthWindow(cycle.month); return ` · Window: ${fmtDate(w.from)} – ${fmtDate(w.to)}` })()}
              </span>
            )}
            <button
              onClick={handleRunComparison}
              disabled={!parsed || running}
              className="text-xs font-semibold bg-accent text-white px-4 py-1.5 rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {running && <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>}
              {running ? 'Running…' : 'Run Comparison'}
            </button>
          </div>

          {parseError && <p className="text-xs text-red-500">{parseError}</p>}
          {runError   && <p className="text-xs text-red-500">{runError}</p>}

          {runResult && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
              <SummaryChip label="Clean"        value={runResult.summary.clean_agents}      color="green" />
              <SummaryChip label="Discrepant"   value={runResult.summary.discrepant_agents} color="red"   />
              <SummaryChip label="Total Agents" value={runResult.summary.total_agents}       />
              {runResult.unmatched_agents?.length > 0 && (
                <div className="col-span-2 sm:col-span-4">
                  <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 mb-1">Unmatched agent names from Snapshot:</p>
                  <div className="flex flex-wrap gap-2">
                    {runResult.unmatched_agents.map((w, i) => (
                      <span key={i} className="text-xs bg-amber-500/10 text-amber-600 dark:text-amber-300 px-2 py-0.5 rounded-full">
                        {w.agent_name} ({w.carrier})
                      </span>
                    ))}
                  </div>
                </div>
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

      {/* ── Discrepancy Cards ───────────────────────────────────────────────── */}
      {sorted.length === 0 && reconciliations.length === 0 && (
        <div className="bg-white dark:bg-primary/30 border border-gray-200 dark:border-white/10 rounded-2xl p-10 text-center">
          <p className="text-sm text-gray-400 dark:text-white/40">No discrepancies yet. Upload a Snapshot report to run the comparison.</p>
        </div>
      )}

      {sorted.map(rec => {
        const isExpanded  = expanded[rec.id] ?? !rec.resolution
        const isResolving = resolvingId === rec.id
        const isDisputing = disputingCandidate?.recId === rec.id

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
                <ResolutionBadge resolution={rec.resolution} />
                <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/></svg>
              </div>
            </button>

            {isExpanded && (
              <div className="border-t border-gray-100 dark:border-white/10 px-6 pb-6 pt-4 space-y-4">

                {/* Mechanical flags */}
                {mechanicalFlags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {mechanicalFlags.map((f, i) => <FlagBadge key={i} flag={f} />)}
                  </div>
                )}

                {/* Analysis: candidates or policy search */}
                {analysis?.candidates?.length > 0 ? (
                  <div className="space-y-2">
                    {analysis.candidates.map((c, i) => (
                      <CandidateRow
                        key={i}
                        candidate={c}
                        onEdit={() => openEditPolicy(c)}
                        onDispute={() => {
                          setDisputingCandidate({ recId: rec.id, candidate: c })
                          setCandidateDisputeNote('')
                          setCandidateDisputeAmount(String(Math.abs(c.delta_contribution ?? 0)))
                          setCandidateDisputeDirection('add')
                        }}
                        canWrite={!readOnly && !rec.resolution}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {analysis?.unmatched && (
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
                        onEdit={() => openEditPolicy(p)}
                        onDispute={() => {
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
                  </div>
                )}

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
                            onClick={() => setCandidateDisputeDirection('add')}
                            className={`text-xs px-3 py-1 transition-colors ${candidateDisputeDirection === 'add' ? 'bg-green-500/20 text-green-700 dark:text-green-300 font-semibold' : 'text-gray-400 dark:text-white/40 hover:bg-gray-50 dark:hover:bg-white/5'}`}
                          >Adds to total</button>
                          <button
                            onClick={() => setCandidateDisputeDirection('reduce')}
                            className={`text-xs px-3 py-1 border-l border-gray-300 dark:border-white/20 transition-colors ${candidateDisputeDirection === 'reduce' ? 'bg-red-500/20 text-red-600 dark:text-red-400 font-semibold' : 'text-gray-400 dark:text-white/40 hover:bg-gray-50 dark:hover:bg-white/5'}`}
                          >Reduces total</button>
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
                    <div className="flex gap-2">
                      <button onClick={() => handleCandidateDispute(rec, disputingCandidate.candidate)} disabled={savingId === rec.id} className="text-xs px-3 py-1.5 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 transition-colors disabled:opacity-60">
                        Generate Dispute
                      </button>
                      <button
                        onClick={() => { setDisputingCandidate(null); setCandidateDisputeAmount(''); setCandidateDisputeDirection('add') }}
                        className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-white/20 text-gray-500 dark:text-white/50 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                      >Cancel</button>
                    </div>
                  </div>
                )}

                {/* Resolution: Mark Resolved (for tracker-side fixes; disputes set this automatically) */}
                {!readOnly && !rec.resolution && (
                  <div className="pt-2 border-t border-gray-100 dark:border-white/10">
                    {!isResolving ? (
                      <button onClick={() => { setResolvingId(rec.id); setResolveNote('') }} className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-white/50 hover:bg-gray-200 dark:hover:bg-white/15 transition-colors">Mark Resolved</button>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-gray-600 dark:text-white/60">Resolution note (optional):</p>
                        <textarea rows={2} value={resolveNote} onChange={e => setResolveNote(e.target.value)} className={INPUT + ' resize-none'} placeholder="How was this resolved?…" />
                        <div className="flex gap-2">
                          <button onClick={() => handleResolve(rec, 'legitimate')} disabled={savingId === rec.id} className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 transition-colors disabled:opacity-60">Confirm</button>
                          <button onClick={() => setResolvingId(null)} className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-white/20 text-gray-500 dark:text-white/50 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {rec.resolution && rec.resolution_note && (
                  <p className="text-xs text-gray-500 dark:text-white/40 italic">Note: {rec.resolution_note}</p>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* ── Completion gate ─────────────────────────────────────────────────── */}
      {allResolved && !cycle?.completed_at && canWrite && (
        <div className="flex justify-end">
          <button
            onClick={onStepComplete}
            className="text-sm font-semibold bg-accent text-white px-6 py-2 rounded-xl hover:bg-accent/90 transition-colors"
          >
            Proceed to Disputes →
          </button>
        </div>
      )}

      {/* Policy edit modal */}
      {editPolicy && (
        <PolicyModalErrorBoundary onClose={() => setEditPolicy(null)}>
          <PolicyModal
            policy={editPolicy}
            personnel={personnel}
            onClose={() => setEditPolicy(null)}
            canWrite={canWrite}
            onUpdate={updated => {
              setEditPolicy(null)
              onRefresh()
            }}
            onDelete={() => {
              setEditPolicy(null)
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
        <div className="flex flex-wrap gap-x-4 text-xs text-gray-500 dark:text-white/50">
          <span>APV: <strong className="text-gray-700 dark:text-white/70">{fmtAmt(c.issued_apv)}</strong></span>
          {c.match && c.match !== 'full' && <span>Contribution: <strong className="text-gray-700 dark:text-white/70">{fmtAmt(c.delta_contribution)}</strong></span>}
          {c.conservation_date && <span>CB date: <strong className="text-gray-700 dark:text-white/70">{fmtDate(c.conservation_date)}</strong>{c.conservation_status ? ` · ${c.conservation_status}` : ''}</span>}
          {c.issue_date && (c.type === 'straddle' || c.type === 'missing' || c.type === 'search') && <span>Issue date: <strong className="text-gray-700 dark:text-white/70">{fmtDate(c.issue_date)}</strong></span>}
          {c.status && (c.type === 'non_issued' || c.type === 'search') && <span>Status: {c.status}</span>}
          {c.submit_date && c.type === 'non_issued' && <span>Submitted: {fmtDate(c.submit_date)}</span>}
        </div>
      </div>
      {canWrite && (
        <div className="flex gap-2 flex-shrink-0">
          <button onClick={onEdit} className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-white/60 hover:bg-gray-200 dark:hover:bg-white/15 transition-colors font-medium whitespace-nowrap">Edit</button>
          <button onClick={onDispute} className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300 hover:bg-amber-500/25 transition-colors font-medium whitespace-nowrap">Generate Dispute</button>
        </div>
      )}
    </div>
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
