import { useState, useRef } from 'react'
import Papa from 'papaparse'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Case-insensitive column picker — tries each key in order, exact then fuzzy */
function getField(row, ...keys) {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '')
      return String(row[k]).trim()
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

function parseCSVDate(val) {
  if (!val) return null
  const s = String(val).trim()

  // M/D/YYYY or M/D/YY  (e.g. 3/15/2024)
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (mdy) {
    let yr = parseInt(mdy[3])
    if (yr < 100) yr += yr < 50 ? 2000 : 1900
    const d = new Date(yr, parseInt(mdy[1]) - 1, parseInt(mdy[2]))
    return isNaN(d) ? null : d
  }

  // YYYY-MM-DD (optionally followed by T…)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]))

  // MM-DD-YYYY
  const dmy = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/)
  if (dmy) return new Date(parseInt(dmy[3]), parseInt(dmy[1]) - 1, parseInt(dmy[2]))

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

// ── Row processing ────────────────────────────────────────────────────────────

function processRows(csvRows, existingPersonnel) {
  const existingIds = new Set(
    existingPersonnel.map(p => p.sfg_id?.toLowerCase()).filter(Boolean)
  )

  return csvRows.map((raw, idx) => {
    const errors   = []
    const warnings = []

    const rawSfgId     = getField(raw, 'AgentCode', 'SFG ID', 'sfg_id', 'SfgId', 'SFGID', 'Agent Code')
    const rawAgentName = getField(raw, 'AgentName', 'Agent Name')
    const rawFirstName = getField(raw, 'FirstName', 'First Name', 'first_name')
    const rawLastName  = getField(raw, 'LastName',  'Last Name',  'last_name')
    const rawUpline    = getField(raw, 'Upline', 'UplineCode', 'Upline SFG ID', 'upline_sfg_id', 'UplineAgentCode')
    const rawHire      = getField(raw, 'Hire Date', 'HireDate', 'hire_date', 'ContractDate', 'Contract Date', 'Start Date', 'StartDate', 'WritingDate', 'Writing Date')
    const rawBirth     = getField(raw, 'BirthDate', 'Birth Date', 'birth_date', 'DOB', 'Date of Birth', 'DateOfBirth')
    const rawNPN       = getField(raw, 'NPN', 'npn', 'NPN Number')
    const rawStatus    = getField(raw, 'Status', 'status')

    if (!rawSfgId) {
      errors.push('SFG ID / AgentCode is required')
    }

    const sfgId = rawSfgId.trim().toUpperCase()
    const upline = rawUpline.trim().toUpperCase() || null

    // preferred_name: built from FirstName + LastName if present
    const preferredName = rawFirstName || rawLastName
      ? [rawFirstName, rawLastName].filter(Boolean).join(' ')
      : null

    // opt_name: AgentName column (agency display name / code)
    const optName = rawAgentName || null

    const hireDateISO   = fmtISO(parseCSVDate(rawHire))
    const birthDateISO  = fmtISO(parseCSVDate(rawBirth))
    if (rawHire  && !hireDateISO)  warnings.push(`Could not parse hire date: "${rawHire}"`)
    if (rawBirth && !birthDateISO) warnings.push(`Could not parse birth date: "${rawBirth}"`)

    const isDuplicate = sfgId && existingIds.has(sfgId.toLowerCase())
    if (isDuplicate) warnings.push('Agent already exists — will be skipped on import')

    const rowStatus = errors.length > 0 ? 'red' : warnings.length > 0 ? 'yellow' : 'green'

    return {
      _csvIdx:        idx,
      sfg_id:         sfgId        || '',
      preferred_name: preferredName,
      opt_name:       optName,
      upline_sfg_id:  upline,
      hire_date:      hireDateISO   || null,
      birth_date:     birthDateISO  || null,
      npn:            rawNPN        || null,
      status:         rawStatus    || null,
      isDuplicate,
      rowStatus,
      errors,
      warnings,
      excluded:       errors.length > 0,
    }
  })
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status, excluded }) {
  if (excluded) return (
    <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
      Excluded
    </span>
  )
  const map = {
    green:  ['bg-green-100 text-green-800',  'Ready'],
    yellow: ['bg-yellow-100 text-yellow-800', 'Review'],
    red:    ['bg-red-100 text-red-800',        'No ID'],
  }
  const [cls, label] = map[status] ?? ['bg-gray-100 text-gray-700', status]
  return (
    <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>
      {label}
    </span>
  )
}

function PreviewRow({ row, onUpdate, idx }) {
  const [expanded, setExpanded] = useState(false)
  const noteCount = row.warnings.length + row.errors.length

  const bgCls = row.excluded
    ? 'bg-gray-50 opacity-60'
    : { green: 'bg-green-50', yellow: 'bg-yellow-50', red: 'bg-red-50' }[row.rowStatus] ?? ''

  return (
    <div className={`border-b last:border-0 px-3 py-2 text-sm ${bgCls}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="w-16 flex-shrink-0">
          <StatusBadge status={row.rowStatus} excluded={row.excluded} />
        </div>

        <span className="w-24 font-mono text-xs font-semibold flex-shrink-0">
          {row.sfg_id || <em className="text-gray-400 font-sans font-normal">—</em>}
        </span>
        <span className="w-44 truncate text-gray-700 flex-shrink-0">
          {row.opt_name || <em className="text-gray-400">—</em>}
        </span>
        <span className="w-24 font-mono text-xs text-gray-500 flex-shrink-0">
          {row.upline_sfg_id || '—'}
        </span>
        <span className="w-28 text-gray-500 flex-shrink-0 text-xs">
          {fmtDate(row.hire_date) || '—'}
        </span>

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
              onChange={e => onUpdate(idx, { excluded: !e.target.checked })}
              disabled={row.rowStatus === 'red'}
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

export default function BulkAgentImportModal({ onClose, existingPersonnel = [], onImportDone }) {
  const [phase,      setPhase]      = useState('upload')  // upload | preview | confirm | importing | result
  const [rows,       setRows]       = useState([])
  const [parseError, setParseError] = useState('')
  const [result,     setResult]     = useState(null)
  const [filterStatus, setFilterStatus] = useState('all')
  const fileRef = useRef()

  function handleFile(file) {
    if (!file) return
    setParseError('')
    Papa.parse(file, {
      header:         true,
      skipEmptyLines: true,
      complete(res) {
        if (!res.data?.length) { setParseError('No data rows found in file.'); return }
        setRows(processRows(res.data, existingPersonnel))
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

  // Rows eligible to import: included and have a valid SFG ID
  const toImport = rows.filter(r => !r.excluded && r.rowStatus !== 'red')

  const counts = {
    green:    rows.filter(r => r.rowStatus === 'green'  && !r.excluded).length,
    yellow:   rows.filter(r => r.rowStatus === 'yellow' && !r.excluded).length,
    red:      rows.filter(r => r.rowStatus === 'red').length,
    excluded: rows.filter(r => r.excluded).length,
  }

  const visibleRows = filterStatus === 'all'
    ? rows
    : rows.filter(r => r.rowStatus === filterStatus)

  async function doImport() {
    setPhase('importing')
    const payload = toImport
      .filter(r => !r.isDuplicate)  // server will skip anyway, but be explicit
      .map(r => ({
        sfg_id:         r.sfg_id,
        preferred_name: r.preferred_name || null,
        opt_name:       r.opt_name       || null,
        upline_sfg_id:  r.upline_sfg_id  || null,
        hire_date:      r.hire_date      || null,
        birth_date:     r.birth_date     || null,
        npn:            r.npn            || null,
        status:         r.status         || null,
      }))

    try {
      const res  = await fetch('/api/import-agents', {
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

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-800">Bulk Agent Import</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">

          {/* ── Upload ── */}
          {phase === 'upload' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Upload a CSV with agent data. The import will add new agents and skip any SFG IDs already in the system.
              </p>
              <div className="bg-gray-50 rounded-lg border border-gray-200 px-4 py-3 text-sm text-gray-600 space-y-1">
                <p className="font-medium text-gray-700">Recognized column names:</p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs mt-1">
                  <span><span className="font-mono bg-gray-100 px-1 rounded">AgentCode</span> → SFG ID <span className="text-red-500">*</span></span>
                  <span><span className="font-mono bg-gray-100 px-1 rounded">FirstName</span> + <span className="font-mono bg-gray-100 px-1 rounded">LastName</span> → Name</span>
                  <span><span className="font-mono bg-gray-100 px-1 rounded">AgentName</span> → Opt Name</span>
                  <span><span className="font-mono bg-gray-100 px-1 rounded">UplineCode</span> → Upline SFG ID</span>
                  <span><span className="font-mono bg-gray-100 px-1 rounded">Hire Date</span> / <span className="font-mono bg-gray-100 px-1 rounded">ContractDate</span> → Hire Date</span>
                  <span><span className="font-mono bg-gray-100 px-1 rounded">BirthDate</span> / <span className="font-mono bg-gray-100 px-1 rounded">DOB</span> → Birth Date</span>
                  <span><span className="font-mono bg-gray-100 px-1 rounded">NPN</span> → NPN</span>
                  <span><span className="font-mono bg-gray-100 px-1 rounded">Status</span> → Status</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">Column names are matched case-insensitively. <span className="text-red-500">*</span> required.</p>
              </div>

              <div
                className="border-2 border-dashed border-gray-300 rounded-lg p-16 text-center cursor-pointer hover:border-blue-400 transition-colors"
                onDragOver={e => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
              >
                <p className="text-gray-400 text-sm">
                  Drag &amp; drop a CSV file here, or <span className="text-blue-600 underline">click to browse</span>
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={e => handleFile(e.target.files[0])}
                />
              </div>

              {parseError && <p className="text-red-600 text-sm">{parseError}</p>}
            </div>
          )}

          {/* ── Preview ── */}
          {phase === 'preview' && (
            <div className="space-y-3">
              {/* Summary chips */}
              <div className="flex gap-3 flex-wrap">
                <span className="px-3 py-1 rounded-full bg-green-100 text-green-800 text-sm font-medium">{counts.green} ready</span>
                <span className="px-3 py-1 rounded-full bg-yellow-100 text-yellow-800 text-sm font-medium">{counts.yellow} review</span>
                <span className="px-3 py-1 rounded-full bg-red-100 text-red-800 text-sm font-medium">{counts.red} no SFG ID</span>
                <span className="px-3 py-1 rounded-full bg-gray-100 text-gray-600 text-sm font-medium">{counts.excluded} excluded</span>
              </div>

              {/* Filter tabs */}
              <div className="flex gap-2 text-sm flex-wrap">
                {[
                  ['all',    `All (${rows.length})`],
                  ['green',  'Ready'],
                  ['yellow', 'Review'],
                  ['red',    'No SFG ID'],
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
                <span className="w-24">SFG ID</span>
                <span className="w-44">Name</span>
                <span className="w-24">Upline</span>
                <span className="w-28">Hire Date</span>
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
                        onUpdate={updateRow}
                        idx={realIdx}
                      />
                    )
                  })
                )}
              </div>

              <p className="text-xs text-gray-500">
                <strong>{toImport.length}</strong> of {rows.length} rows will be imported.
                Duplicates are automatically skipped by the server.
              </p>
            </div>
          )}

          {/* ── Confirm ── */}
          {phase === 'confirm' && (
            <div className="space-y-4">
              <p className="text-gray-700 text-sm">Review before proceeding:</p>
              <div className="bg-gray-50 rounded-lg p-5 space-y-3 text-sm">
                <div className="flex justify-between border-b pb-2">
                  <span className="text-gray-600">New agents to insert</span>
                  <span className="font-semibold text-green-700">
                    {toImport.filter(r => !r.isDuplicate).length}
                  </span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-gray-600">Duplicates (will be skipped)</span>
                  <span className="font-semibold text-orange-600">
                    {toImport.filter(r => r.isDuplicate).length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Excluded / no SFG ID</span>
                  <span className="font-semibold">{rows.length - toImport.length}</span>
                </div>
              </div>
            </div>
          )}

          {/* ── Importing ── */}
          {phase === 'importing' && (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-600 text-sm">Importing agents…</p>
            </div>
          )}

          {/* ── Result ── */}
          {phase === 'result' && result && (
            <div className="space-y-4">
              <div className={`border rounded-lg p-5 space-y-3 text-sm ${
                result.errors?.length ? 'bg-yellow-50 border-yellow-200' : 'bg-green-50 border-green-200'
              }`}>
                <p className="font-semibold text-base">
                  {result.errors?.length ? 'Import completed with errors' : 'Import complete ✓'}
                </p>
                <div className="flex justify-between">
                  <span className="text-gray-600">Agents inserted</span>
                  <span className="font-semibold text-green-700">{result.inserted}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Skipped (already exist)</span>
                  <span className="font-semibold">{result.skipped}</span>
                </div>
                {result.errors?.length > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Errors</span>
                    <span className="font-semibold text-red-600">{result.errors.length}</span>
                  </div>
                )}
              </div>

              {result.errors?.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-red-700">Errors:</p>
                  <div className="border border-red-200 rounded-lg overflow-hidden text-xs">
                    {result.errors.slice(0, 10).map((e, i) => (
                      <div key={i} className="px-3 py-1.5 border-b last:border-0 bg-red-50 flex gap-2">
                        {e.sfg_id && <span className="font-mono font-medium">{e.sfg_id}</span>}
                        <span className="text-red-600">{e.error}</span>
                      </div>
                    ))}
                    {result.errors.length > 10 && (
                      <div className="px-3 py-1.5 text-gray-500">…and {result.errors.length - 10} more</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-gray-50">
          {phase === 'upload' && (
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100"
            >
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
                disabled={toImport.filter(r => !r.isDuplicate).length === 0}
                className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Review &amp; Confirm ({toImport.filter(r => !r.isDuplicate).length})
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
                Import {toImport.filter(r => !r.isDuplicate).length} agents
              </button>
            </>
          )}

          {phase === 'result' && (
            <button
              onClick={() => { onImportDone?.(); onClose() }}
              className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
