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

const DISPUTE_TYPES = [
  'Missing policy', 'APV mismatch', 'Chargeback', 'Timing difference',
  'Split/Reset', 'Prior month carryover', 'Other',
]

export default function Step1Reconciliation({ cycle, reconciliations, personnel, canWrite, onStepComplete, onRefresh }) {
  const fileRef = useRef(null)

  const [file,          setFile]          = useState(null)
  const [parsed,        setParsed]        = useState(null) // { dateFrom, dateTo, agents }
  const [parseError,    setParseError]    = useState(null)
  const [running,       setRunning]       = useState(false)
  const [runResult,     setRunResult]     = useState(null)
  const [runError,      setRunError]      = useState(null)

  const [expanded,      setExpanded]      = useState({})         // reconciliation id → bool
  const [resolvingId,   setResolvingId]   = useState(null)       // which card is in resolve flow
  const [resolveMode,   setResolveMode]   = useState(null)       // 'legitimate' | 'dispute'
  const [resolveNote,   setResolveNote]   = useState('')
  const [disputeForm,   setDisputeForm]   = useState({ type: '', amount: '', notes: '' })
  const [savingId,      setSavingId]      = useState(null)

  const [analyzingId,   setAnalyzingId]   = useState(null)
  const [hypotheses,    setHypotheses]    = useState({})         // id → text (local cache)

  const [editPolicy,    setEditPolicy]    = useState(null)
  const [dupeOpen,      setDupeOpen]      = useState(false)

  // Sort by abs(delta) desc; resolved go to bottom
  const sorted = [...reconciliations].sort((a, b) => {
    const aRes = !!a.resolution, bRes = !!b.resolution
    if (aRes !== bRes) return aRes ? 1 : -1
    return Math.abs(b.delta) - Math.abs(a.delta)
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

  async function handleRunAnalysis(rec) {
    setAnalyzingId(rec.id)
    try {
      const res = await fetch('/api/snapshot/analyze', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reconciliation_id: rec.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Analysis failed')
      setHypotheses(h => ({ ...h, [rec.id]: data.hypothesis }))
      await onRefresh()
    } catch (err) {
      console.error('analyze error', err)
    } finally {
      setAnalyzingId(null)
    }
  }

  async function handleResolve(rec, resolution) {
    setSavingId(rec.id)
    try {
      const res = await fetch('/api/snapshot?type=resolution', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id:              rec.id,
          resolution,
          resolution_note: resolveNote || null,
        }),
      })
      if (!res.ok) throw new Error('Failed to save resolution')

      if (resolution === 'disputed') {
        // Also create a dispute row
        await fetch('/api/snapshot?type=disputes', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cycle_id:          cycle.id,
            reconciliation_id: rec.id,
            sfg_id:            rec.sfg_id,
            disputed_amount:   parseFloat(disputeForm.amount) || null,
            dispute_type:      disputeForm.type || null,
            notes:             disputeForm.notes || null,
          }),
        })
      }

      setResolvingId(null)
      setResolveMode(null)
      setResolveNote('')
      setDisputeForm({ type: '', amount: '', notes: '' })
      await onRefresh()
    } catch (err) {
      console.error('resolve error', err)
    } finally {
      setSavingId(null)
    }
  }

  function openResolve(id, mode) {
    setResolvingId(id)
    setResolveMode(mode)
    setResolveNote('')
    setDisputeForm({ type: '', amount: '', notes: '' })
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
        const isAnalyzing = analyzingId === rec.id
        const hypothesis  = hypotheses[rec.id] ?? rec.claude_hypothesis

        const issuedPolicies  = safeJson(rec.issued_policies) ?? []
        const mechanicalFlags = rec.mechanical_flags          ?? []

        const recSfgUpper = rec.sfg_id?.toUpperCase()
        const agentName = issuedPolicies[0]?.agent_name
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

                {/* Claude hypothesis */}
                {hypothesis ? (
                  <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4">
                    <p className="text-xs font-semibold text-blue-600 dark:text-blue-300 mb-1">AI Analysis</p>
                    <p className="text-sm text-gray-700 dark:text-white/80 leading-relaxed">{hypothesis}</p>
                  </div>
                ) : !readOnly && (
                  <button
                    onClick={() => handleRunAnalysis(rec)}
                    disabled={isAnalyzing}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1.5"
                  >
                    {isAnalyzing && <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>}
                    {isAnalyzing ? 'Analyzing…' : 'Run Analysis'}
                  </button>
                )}

                {/* Issued policies table */}
                {issuedPolicies.length > 0 && (
                  <PolicyTable policies={issuedPolicies} title={`Issued policies in window (${issuedPolicies.length})`} onEdit={canWrite ? setEditPolicy : null} />
                )}

                {/* Resolution controls */}
                {!readOnly && !rec.resolution && (
                  <div className="pt-2 border-t border-gray-100 dark:border-white/10">
                    {!isResolving ? (
                      <div className="flex gap-2 flex-wrap">
                        <button onClick={() => openResolve(rec.id, 'legitimate')} className="text-xs px-3 py-1.5 rounded-lg bg-green-500/15 text-green-700 dark:text-green-300 hover:bg-green-500/25 transition-colors font-medium">Mark Legitimate</button>
                        <button onClick={() => openResolve(rec.id, 'dispute')}    className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300 hover:bg-amber-500/25 transition-colors font-medium">Send to Disputes</button>
                        <button onClick={() => handleResolve(rec, 'no_action')}   className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-white/50 hover:bg-gray-200 dark:hover:bg-white/15 transition-colors">Skip / No Action</button>
                      </div>
                    ) : resolveMode === 'legitimate' ? (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-gray-600 dark:text-white/60">Note (optional):</p>
                        <textarea rows={2} value={resolveNote} onChange={e => setResolveNote(e.target.value)} className={INPUT + ' resize-none'} placeholder="Reason this is legitimate…" />
                        <div className="flex gap-2">
                          <button onClick={() => handleResolve(rec, 'legitimate')} disabled={savingId === rec.id} className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 transition-colors disabled:opacity-60">Confirm Legitimate</button>
                          <button onClick={() => setResolvingId(null)} className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-white/20 text-gray-500 dark:text-white/50 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-gray-600 dark:text-white/60">Dispute details:</p>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-xs text-gray-400 dark:text-white/40 mb-1">Dispute type</p>
                            <select value={disputeForm.type} onChange={e => setDisputeForm(f => ({ ...f, type: e.target.value }))} className={INPUT}>
                              <option value="">— select —</option>
                              {DISPUTE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                          <div>
                            <p className="text-xs text-gray-400 dark:text-white/40 mb-1">Disputed amount</p>
                            <input type="number" value={disputeForm.amount} onChange={e => setDisputeForm(f => ({ ...f, amount: e.target.value }))} placeholder={Math.abs(rec.delta).toFixed(2)} className={INPUT} />
                          </div>
                          <div className="col-span-2">
                            <p className="text-xs text-gray-400 dark:text-white/40 mb-1">Notes</p>
                            <textarea rows={2} value={disputeForm.notes} onChange={e => setDisputeForm(f => ({ ...f, notes: e.target.value }))} className={INPUT + ' resize-none'} />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => handleResolve(rec, 'disputed')} disabled={savingId === rec.id} className="text-xs px-3 py-1.5 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 transition-colors disabled:opacity-60">Send to Disputes</button>
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

function CollapsiblePolicyTable({ policies, title, onEdit }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button onClick={() => setOpen(v => !v)} className="flex items-center gap-2 text-xs text-gray-500 dark:text-white/40 hover:text-gray-700 dark:hover:text-white/60 transition-colors mb-2">
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
        <span className="font-semibold uppercase tracking-wider">{title}</span>
      </button>
      {open && <PolicyTable policies={policies} title="" onEdit={onEdit} />}
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
