import { useState, useRef, useEffect } from 'react'
import Papa from 'papaparse'

// ── Helpers ──────────────────────────────────────────────────────────────────

function toTitleCase(str) {
  if (!str) return ''
  return String(str)
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim()
}

function parseCSVDate(val) {
  if (!val) return null
  const s = String(val).trim()
  // M/D/YYYY or M/D/YY
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (mdy) {
    let yr = parseInt(mdy[3])
    if (yr < 100) yr += yr < 50 ? 2000 : 1900
    const mo = parseInt(mdy[1]) - 1
    const dy = parseInt(mdy[2])
    const d = new Date(yr, mo, dy)
    return isNaN(d) ? null : d
  }
  // YYYY-MM-DD
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]))
  return null
}

function fmtISO(d) {
  if (!d) return null
  const y  = d.getFullYear()
  const m  = String(d.getMonth() + 1).padStart(2, '0')
  const dy = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dy}`
}

function fmtDate(isoStr) {
  if (!isoStr) return ''
  const iso = String(isoStr).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!iso) return isoStr
  const d = new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]))
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtAmt(val) {
  if (val === null || val === undefined || val === '') return ''
  const n = parseFloat(String(val).replace(/[$,]/g, ''))
  if (isNaN(n)) return ''
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function parseNum(val) {
  if (val === null || val === undefined || val === '') return null
  const n = parseFloat(String(val).replace(/[$,]/g, '').trim())
  return isNaN(n) ? null : n
}

/** Next Friday on or after the given date. If the date is already a Friday, return it. */
function calcSubmitWeek(submitDate) {
  if (!submitDate) return null
  const d   = new Date(submitDate)
  const dow = d.getDay() // 0=Sun … 5=Fri 6=Sat
  const daysAhead = dow === 5 ? 0 : ((5 - dow + 7) % 7 || 7)
  d.setDate(d.getDate() + daysAhead)
  return d
}

/** Which Friday of the month (1–5) does this Friday fall on? */
function calcSubmitWeekNum(submitWeekDate) {
  if (!submitWeekDate) return null
  const firstOfMonth = new Date(submitWeekDate.getFullYear(), submitWeekDate.getMonth(), 1)
  let firstFriday = new Date(firstOfMonth)
  while (firstFriday.getDay() !== 5) firstFriday.setDate(firstFriday.getDate() + 1)
  let count  = 0
  let cursor = new Date(firstFriday)
  while (cursor <= submitWeekDate) {
    count++
    cursor.setDate(cursor.getDate() + 7)
  }
  return count || null
}

function getField(row, ...keys) {
  for (const k of keys) {
    // exact match
    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') return String(row[k]).trim()
    // case-insensitive
    const lower = k.toLowerCase()
    for (const rk of Object.keys(row)) {
      if (rk.toLowerCase() === lower) {
        const rv = String(row[rk] ?? '').trim()
        if (rv !== '') return rv
      }
    }
  }
  return ''
}

// ── Row processing ────────────────────────────────────────────────────────────

function processRows(csvRows, personnel, crosswalk, existingPolicies) {
  // Build lookups
  const personByName = {}   // name lower → { sfg_id, name }
  const personByOpt  = {}   // sfg_id lower → { sfg_id, name }
  for (const p of personnel) {
    const sfgLower = p.sfg_id?.toLowerCase()
    if (!sfgLower) continue
    const name  = (p.preferred_name || p.opt_name || '').trim()
    const entry = { sfg_id: p.sfg_id, name }
    if (name) personByName[name.toLowerCase()] = entry
    personByOpt[sfgLower] = entry
  }

  const crosswalkMap = {}  // `${carrier.lower}||${policy_name.lower}` → subtype
  for (const c of crosswalk) {
    if (c.carrier && c.policy_name) {
      crosswalkMap[`${c.carrier.toLowerCase()}||${c.policy_name.toLowerCase()}`] = c.subtype || ''
    }
  }

  // Build natural-key duplicate set from existing policies
  const dupKeys = new Set()
  for (const p of existingPolicies) {
    if (p.sfg_id && p.applicant && p.submit_date && p.carrier && p.policy_name) {
      dupKeys.add(
        `${p.sfg_id.toLowerCase()}||${p.applicant.toLowerCase()}||${p.submit_date}||${p.carrier.toLowerCase()}||${p.policy_name.toLowerCase()}`
      )
    }
  }

  return csvRows.map((raw, idx) => {
    const warnings = []
    const errors   = []

    const rawAgent     = getField(raw, 'Agent', 'agent', 'Agent Name', 'AgentName')
    const rawApplicant = getField(raw, 'Applicant', 'applicant', 'Client', 'client')
    const rawCarrier   = getField(raw, 'Carrier', 'carrier')
    const rawPolicy    = getField(raw, 'Policy Name', 'policy_name', 'PolicyName', 'Product', 'product')
    const rawPolicyNo  = getField(raw, 'Policy Number', 'policy_number', 'PolicyNumber', 'Policy No', 'PolicyNo')
    const rawStatus    = getField(raw, 'Status', 'status')
    const rawSubmDate  = getField(raw, 'Submit Date', 'submit_date', 'SubmitDate', 'Date Submitted', 'DateSubmitted')
    const rawIssDate   = getField(raw, 'Issue Date', 'issue_date', 'IssueDate')
    const rawFace      = getField(raw, 'Face Amount', 'face_amount', 'FaceAmount', 'Face')
    const rawSubmApv   = getField(raw, 'Submitted APV', 'submitted_apv', 'SubmittedAPV', 'Subm APV', 'APV')
    const rawSfgId     = getField(raw, 'SFG ID', 'sfg_id', 'SfgId', 'SFGID', 'AgentCode', 'agentcode', 'Agent Code')

    // Applicant: title-case normalise
    const origApplicant = rawApplicant
    const applicant     = toTitleCase(origApplicant)
    if (applicant && applicant !== origApplicant) {
      warnings.push(`Applicant name normalized: "${origApplicant}" → "${applicant}"`)
    }

    const carrier    = rawCarrier
    const policyName = rawPolicy
    const policyNo   = rawPolicyNo
    const status     = rawStatus
    const faceAmt    = parseNum(rawFace)
    const submApv    = parseNum(rawSubmApv)

    const submitDateObj  = parseCSVDate(rawSubmDate)
    const issueDateObj   = parseCSVDate(rawIssDate)
    const submitDateISO  = fmtISO(submitDateObj)
    const issueDateISO   = fmtISO(issueDateObj)
    const submitWeekObj  = calcSubmitWeek(submitDateObj)
    const submitWeekISO  = fmtISO(submitWeekObj)
    const submitWeekNum  = calcSubmitWeekNum(submitWeekObj)

    // Crosswalk lookup
    const cwKey   = `${carrier.toLowerCase()}||${policyName.toLowerCase()}`
    const subtype = crosswalkMap[cwKey] ?? null
    if (!subtype && carrier && policyName) {
      warnings.push(`No crosswalk match for "${carrier} / ${policyName}"`)
    }

    const isChildPolicy = /child|juv|juvenile/i.test(policyName)

    // Agent lookup — sfg_id first, then name
    let sfg_id    = rawSfgId
    let agentName = ''
    let matched   = false

    if (sfg_id) {
      const byOpt = personByOpt[sfg_id.toLowerCase()]
      if (byOpt) { agentName = byOpt.name; matched = true }
    }
    if (!matched && rawAgent) {
      // Try by full name first
      const byName = personByName[rawAgent.toLowerCase()]
      if (byName) { sfg_id = byName.sfg_id; agentName = byName.name; matched = true }
    }
    if (!matched && rawAgent) {
      // Fallback: treat Agent column value as an SFG ID (common in carrier exports)
      const byId = personByOpt[rawAgent.toLowerCase()]
      if (byId) { sfg_id = byId.sfg_id; agentName = byId.name; matched = true }
    }

    if (!matched) {
      errors.push(rawAgent ? `Agent not found: "${rawAgent}"` : 'No agent name or SFG ID provided')
    }

    // Duplicate check
    let isDuplicate = false
    if (sfg_id && applicant && submitDateISO && carrier && policyName) {
      const key = `${sfg_id.toLowerCase()}||${applicant.toLowerCase()}||${submitDateISO}||${carrier.toLowerCase()}||${policyName.toLowerCase()}`
      isDuplicate = dupKeys.has(key)
    }

    const rowStatus = !matched ? 'red' : (isDuplicate || warnings.length > 0) ? 'yellow' : 'green'

    return {
      _csvIdx:         idx,
      sfg_id,
      agentName,
      applicant,
      carrier,
      policy_name:     policyName,
      policy_number:   policyNo,
      status,
      submit_date:     submitDateISO,
      issue_date:      issueDateISO,
      face_amount:     faceAmt,
      submitted_apv:   submApv,
      submit_week:     submitWeekISO,
      submit_week_num: submitWeekNum,
      subtype,
      isChildPolicy,
      isDuplicate,
      rowStatus,
      warnings,
      errors,
      excluded:        isDuplicate,   // duplicates excluded by default
      includeAnyway:   false,
    }
  })
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status, excluded }) {
  if (excluded) return <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Excluded</span>
  const map = {
    green:  ['bg-green-100 text-green-800',  'Ready'],
    yellow: ['bg-yellow-100 text-yellow-800','Review'],
    red:    ['bg-red-100 text-red-800',       'No Agent'],
  }
  const [cls, label] = map[status] ?? ['bg-gray-100 text-gray-700', status]
  return <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
}

function PreviewRow({ row, personnel, onUpdate, idx }) {
  const [expanded,    setExpanded]    = useState(false)
  const [agentSearch, setAgentSearch] = useState('')

  const bgCls = row.excluded
    ? 'bg-gray-50 opacity-60'
    : { green: 'bg-green-50', yellow: 'bg-yellow-50', red: 'bg-red-50' }[row.rowStatus] ?? ''

  const filteredPersonnel = agentSearch.length > 1
    ? personnel.filter(p => {
        const name = (p.preferred_name || p.opt_name || '').toLowerCase()
        return name.includes(agentSearch.toLowerCase()) ||
               (p.sfg_id ?? '').toLowerCase().includes(agentSearch.toLowerCase())
      }).slice(0, 8)
    : []

  function selectAgent(p) {
    const name = (p.preferred_name || p.opt_name || '').trim()
    onUpdate(idx, {
      sfg_id:    p.sfg_id,
      agentName: name,
      rowStatus: row.warnings.length > 0 ? 'yellow' : 'green',
      errors:    [],
      excluded:  row.isDuplicate,
    })
    setAgentSearch('')
  }

  const noteCount = row.warnings.length + row.errors.length

  return (
    <div className={`border-b last:border-0 px-3 py-2 text-sm ${bgCls}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="w-16 flex-shrink-0">
          <StatusBadge status={row.rowStatus} excluded={row.excluded} />
        </div>

        <span className="w-36 truncate font-medium flex-shrink-0">{row.applicant || <em className="text-gray-400">—</em>}</span>
        <span className="w-28 truncate text-gray-600 flex-shrink-0">{row.carrier}</span>
        <span className="w-40 truncate text-gray-600 flex-shrink-0">{row.policy_name}</span>
        <span className="w-20 text-gray-500 flex-shrink-0">{fmtDate(row.submit_date)}</span>
        <span className="w-20 text-right text-gray-500 flex-shrink-0">{fmtAmt(row.submitted_apv)}</span>

        {/* Agent column */}
        {row.rowStatus === 'red' && !row.excluded ? (
          <div className="relative w-48 flex-shrink-0">
            <input
              className="border rounded px-2 py-0.5 text-xs w-full"
              placeholder="Search agent…"
              value={agentSearch}
              onChange={e => setAgentSearch(e.target.value)}
            />
            {filteredPersonnel.length > 0 && (
              <ul className="absolute z-20 top-full left-0 bg-white border rounded shadow text-xs w-full mt-0.5 max-h-40 overflow-y-auto">
                {filteredPersonnel.map(p => (
                  <li
                    key={p.sfg_id}
                    className="px-2 py-1 hover:bg-blue-50 cursor-pointer"
                    onMouseDown={() => selectAgent(p)}
                  >
                    {(p.preferred_name || p.opt_name || p.sfg_id)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <span className="w-36 truncate text-gray-600 flex-shrink-0">
            {row.agentName || <em className="text-gray-400">—</em>}
          </span>
        )}

        {/* Right-side controls */}
        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
          {row.isDuplicate && !row.excluded && (
            <span className="text-xs text-orange-600 font-medium">Duplicate</span>
          )}
          {noteCount > 0 && (
            <button
              className="text-xs text-blue-600 underline whitespace-nowrap"
              onClick={() => setExpanded(e => !e)}
            >
              {expanded ? 'hide' : `${noteCount} note${noteCount !== 1 ? 's' : ''}`}
            </button>
          )}
          <label className="flex items-center gap-1 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!row.excluded}
              onChange={e => onUpdate(idx, {
                excluded:      !e.target.checked,
                includeAnyway: e.target.checked && row.isDuplicate,
              })}
              disabled={row.rowStatus === 'red' && !row.sfg_id}
            />
            Include
          </label>
        </div>
      </div>

      {expanded && noteCount > 0 && (
        <div className="mt-1 ml-2 space-y-0.5 pl-2 border-l-2 border-gray-200">
          {row.errors.map((e, i) => (
            <p key={`e${i}`} className="text-red-600 text-xs">⚠ {e}</p>
          ))}
          {row.warnings.map((w, i) => (
            <p key={`w${i}`} className="text-yellow-700 text-xs">• {w}</p>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function BulkImportModal({ onClose, personnel = [], existingPolicies = [] }) {
  const [phase,      setPhase]      = useState('upload')   // upload | preview | confirm | importing | result
  const [rows,       setRows]       = useState([])
  const [crosswalk,  setCrosswalk]  = useState(null)
  const [parseError, setParseError] = useState('')
  const [result,     setResult]     = useState(null)
  const [filterStatus, setFilterStatus] = useState('all')
  const fileRef = useRef()

  // Load crosswalk once on mount
  useEffect(() => {
    fetch('/api/policies?type=crosswalk')
      .then(r => r.json())
      .then(data => setCrosswalk(Array.isArray(data) ? data : []))
      .catch(() => setCrosswalk([]))
  }, [])

  function handleFile(file) {
    if (!file) return
    setParseError('')
    Papa.parse(file, {
      header:         true,
      skipEmptyLines: true,
      complete(res) {
        if (!res.data?.length) { setParseError('No data rows found in file.'); return }
        const processed = processRows(res.data, personnel, crosswalk ?? [], existingPolicies)
        setRows(processed)
        setPhase('preview')
      },
      error(err) { setParseError(err.message) },
    })
  }

  function handleDrop(e) {
    e.preventDefault()
    handleFile(e.dataTransfer.files[0])
  }

  function updateRow(idx, patch) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }

  const visibleRows = filterStatus === 'all'
    ? rows
    : rows.filter(r => r.rowStatus === filterStatus)

  const counts = {
    green:    rows.filter(r => r.rowStatus === 'green'  && !r.excluded).length,
    yellow:   rows.filter(r => r.rowStatus === 'yellow' && !r.excluded).length,
    red:      rows.filter(r => r.rowStatus === 'red'    && !r.excluded).length,
    excluded: rows.filter(r => r.excluded).length,
  }

  // Rows eligible to import: included, not red (unless agent was assigned)
  const toImport = rows.filter(r => !r.excluded && r.rowStatus !== 'red')

  async function doImport() {
    setPhase('importing')
    const payload = toImport.map(r => ({
      sfg_id:          r.sfg_id,
      applicant:       r.applicant,
      carrier:         r.carrier,
      policy_name:     r.policy_name,
      policy_number:   r.policy_number   || null,
      face_amount:     r.face_amount,
      submitted_apv:   r.submitted_apv,
      status:          r.status          || null,
      submit_date:     r.submit_date     || null,
      issue_date:      r.issue_date      || null,
      submit_week:     r.submit_week     || null,
      submit_week_num: r.submit_week_num ?? null,
      subtype:         r.subtype         || null,
      includeAnyway:   r.includeAnyway   ?? false,
      agentName:       r.agentName,
    }))

    try {
      const res  = await fetch('/api/policies?type=import', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ rows: payload }),
      })
      const data = await res.json()
      setResult(data)
      setPhase('result')
    } catch (err) {
      setResult({ inserted: 0, skipped: 0, errors: [{ error: err.message }] })
      setPhase('result')
    }
  }

  function downloadErrorsCsv() {
    const errRows = rows.filter(r => r.errors.length > 0 || r.rowStatus === 'red')
    const out = errRows.map(r => ({
      Applicant:    r.applicant,
      Agent:        r.agentName || '',
      Carrier:      r.carrier,
      'Policy Name': r.policy_name,
      'Submit Date': r.submit_date || '',
      'Submitted APV': r.submitted_apv ?? '',
      Issues:        [...r.errors, ...r.warnings].join('; '),
    }))
    const csv  = Papa.unparse(out)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = Object.assign(document.createElement('a'), { href: url, download: 'import-errors.csv' })
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-800">Bulk Policy Import</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">

          {/* ── Upload phase ── */}
          {phase === 'upload' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Upload a CSV file with policy data. Required columns: <strong>Applicant</strong>, <strong>Carrier</strong>, <strong>Policy Name</strong>, <strong>Submit Date</strong>.
                Optional: Agent, SFG ID, Policy Number, Face Amount, Submitted APV, Issue Date, Status.
              </p>

              <div
                className="border-2 border-dashed border-gray-300 rounded-lg p-16 text-center cursor-pointer hover:border-blue-400 transition-colors"
                onDragOver={e => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
              >
                <p className="text-gray-400 text-sm">Drag &amp; drop a CSV file here, or <span className="text-blue-600 underline">click to browse</span></p>
                <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => handleFile(e.target.files[0])} />
              </div>

              {parseError && <p className="text-red-600 text-sm">{parseError}</p>}
              {crosswalk === null && <p className="text-gray-400 text-xs animate-pulse">Loading crosswalk data…</p>}
            </div>
          )}

          {/* ── Preview phase ── */}
          {phase === 'preview' && (
            <div className="space-y-3">
              {/* Summary chips */}
              <div className="flex gap-3 flex-wrap">
                <span className="px-3 py-1 rounded-full bg-green-100 text-green-800 text-sm font-medium">{counts.green} ready</span>
                <span className="px-3 py-1 rounded-full bg-yellow-100 text-yellow-800 text-sm font-medium">{counts.yellow} need review</span>
                <span className="px-3 py-1 rounded-full bg-red-100 text-red-800 text-sm font-medium">{counts.red} no agent</span>
                <span className="px-3 py-1 rounded-full bg-gray-100 text-gray-600 text-sm font-medium">{counts.excluded} excluded</span>
              </div>

              {/* Filter tabs */}
              <div className="flex gap-2 text-sm flex-wrap">
                {[
                  ['all',    `All (${rows.length})`],
                  ['green',  'Ready'],
                  ['yellow', 'Review'],
                  ['red',    'No Agent'],
                ].map(([f, label]) => (
                  <button
                    key={f}
                    onClick={() => setFilterStatus(f)}
                    className={`px-3 py-1 rounded-full border transition-colors ${
                      filterStatus === f
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-gray-300 text-gray-600 hover:border-blue-400'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Column headers */}
              <div className="flex gap-2 text-xs font-semibold text-gray-500 uppercase px-3 pb-1 border-b">
                <span className="w-16">Status</span>
                <span className="w-36">Applicant</span>
                <span className="w-28">Carrier</span>
                <span className="w-40">Policy</span>
                <span className="w-20">Submit</span>
                <span className="w-20 text-right">APV</span>
                <span className="w-36">Agent</span>
              </div>

              {/* Row list */}
              <div className="border rounded-lg overflow-hidden">
                {visibleRows.length === 0 ? (
                  <p className="text-gray-400 text-sm text-center py-8">No rows match this filter.</p>
                ) : (
                  visibleRows.map(row => {
                    const realIdx = rows.indexOf(row)
                    return (
                      <PreviewRow
                        key={row._csvIdx}
                        row={row}
                        personnel={personnel}
                        onUpdate={updateRow}
                        idx={realIdx}
                      />
                    )
                  })
                )}
              </div>

              <p className="text-xs text-gray-500">
                <strong>{toImport.length}</strong> of {rows.length} rows will be imported.
                Uncheck rows to exclude them. Red rows need an agent assigned before they can be included.
              </p>
            </div>
          )}

          {/* ── Confirm phase ── */}
          {phase === 'confirm' && (
            <div className="space-y-4">
              <p className="text-gray-700 text-sm">Review the import summary before proceeding:</p>
              <div className="bg-gray-50 rounded-lg p-5 space-y-3 text-sm">
                <div className="flex justify-between border-b pb-2">
                  <span className="text-gray-600">Rows to insert</span>
                  <span className="font-semibold text-green-700">{toImport.length}</span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-gray-600">Rows excluded / skipped</span>
                  <span className="font-semibold">{rows.length - toImport.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Duplicates included anyway</span>
                  <span className="font-semibold">{toImport.filter(r => r.includeAnyway).length}</span>
                </div>
              </div>
              <p className="text-xs text-gray-400">
                The server will perform a final natural-key duplicate check before inserting each row.
              </p>
            </div>
          )}

          {/* ── Importing phase ── */}
          {phase === 'importing' && (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-600 text-sm">Importing {toImport.length} rows…</p>
            </div>
          )}

          {/* ── Result phase ── */}
          {phase === 'result' && result && (
            <div className="space-y-4">
              <div className={`border rounded-lg p-5 space-y-3 text-sm ${result.errors?.length ? 'bg-yellow-50 border-yellow-200' : 'bg-green-50 border-green-200'}`}>
                <p className="font-semibold text-base">{result.errors?.length ? 'Import completed with errors' : 'Import complete ✓'}</p>
                <div className="flex justify-between">
                  <span className="text-gray-600">Rows inserted</span>
                  <span className="font-semibold text-green-700">{result.inserted}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Skipped (server duplicate check)</span>
                  <span className="font-semibold">{result.skipped}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Errors</span>
                  <span className={`font-semibold ${result.errors?.length ? 'text-red-600' : ''}`}>{result.errors?.length ?? 0}</span>
                </div>
              </div>

              {result.errors?.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-red-700">Row-level errors:</p>
                  <div className="border border-red-200 rounded-lg overflow-hidden text-xs">
                    {result.errors.slice(0, 10).map((e, i) => (
                      <div key={i} className="px-3 py-1.5 border-b last:border-0 bg-red-50 flex gap-2">
                        {e.applicant && <span className="font-medium">{e.applicant}</span>}
                        {e.agent     && <span className="text-gray-500">({e.agent})</span>}
                        <span className="text-red-600">{e.error}</span>
                      </div>
                    ))}
                    {result.errors.length > 10 && (
                      <div className="px-3 py-1.5 text-gray-500">…and {result.errors.length - 10} more</div>
                    )}
                  </div>
                  <button onClick={downloadErrorsCsv} className="text-sm text-blue-600 underline">
                    Download all error rows as CSV
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t bg-gray-50">
          <div>
            {phase === 'preview' && rows.some(r => r.errors.length > 0 || r.rowStatus === 'red') && (
              <button onClick={downloadErrorsCsv} className="text-sm text-blue-600 underline">
                Download error rows
              </button>
            )}
          </div>
          <div className="flex gap-3">
            {phase === 'upload' && (
              <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100">
                Cancel
              </button>
            )}

            {phase === 'preview' && (
              <>
                <button
                  onClick={() => { setRows([]); setFilterStatus('all'); setPhase('upload') }}
                  className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100"
                >
                  ← Back
                </button>
                <button
                  onClick={() => setPhase('confirm')}
                  disabled={toImport.length === 0}
                  className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Review &amp; Confirm ({toImport.length})
                </button>
              </>
            )}

            {phase === 'confirm' && (
              <>
                <button
                  onClick={() => setPhase('preview')}
                  className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100"
                >
                  ← Back
                </button>
                <button
                  onClick={doImport}
                  className="px-4 py-2 text-sm rounded-lg bg-green-600 text-white font-medium hover:bg-green-700"
                >
                  Import {toImport.length} rows
                </button>
              </>
            )}

            {phase === 'result' && (
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700"
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
