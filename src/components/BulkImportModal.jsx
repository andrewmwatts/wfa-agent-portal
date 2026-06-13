import { useState, useRef, useEffect } from 'react'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { fmtDate as fmtDateUtil, fmtCurrency } from '../utils/format'

// ── Helpers ──────────────────────────────────────────────────────────────────

// Editable-grid variants: blank (not "—") when empty
const fmtDate = s => fmtDateUtil(s, { empty: '' })
const fmtAmt  = v => fmtCurrency(v, { empty: '' })

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

function processRows(csvRows, personnel, existingPolicies) {
  // Build lookups
  const personByName = {}   // name lower → { sfg_id, name }
  const personByOpt  = {}   // sfg_id lower → { sfg_id, name }
  for (const p of personnel) {
    const sfgLower = p.sfg_id?.toLowerCase()
    if (!sfgLower) continue
    const name  = (p.preferred_name || p.opt_name || '').trim()
    const entry = { sfg_id: p.sfg_id, name }
    // Index by preferred_name AND opt_name separately so either can match
    if (p.preferred_name?.trim()) personByName[p.preferred_name.trim().toLowerCase()] = entry
    if (p.opt_name?.trim())       personByName[p.opt_name.trim().toLowerCase()]       = entry
    personByOpt[sfgLower] = entry
  }

  // Build natural-key duplicate map from existing policies
  // Value stores { id, not_in_opt } so we can detect "restore" cases
  const dupMap = new Map()
  for (const p of existingPolicies) {
    if (p.sfg_id && p.applicant && p.submit_date && p.carrier && p.policy_name) {
      dupMap.set(
        `${p.sfg_id.toLowerCase()}||${p.applicant.toLowerCase()}||${p.submit_date}||${p.carrier.toLowerCase()}||${p.policy_name.toLowerCase()}`,
        { id: p.id, not_in_opt: !!p.not_in_opt }
      )
    }
  }

  return csvRows.map((raw, idx) => {
    const warnings = []
    const errors   = []

    const rawAgent     = getField(raw, 'Agent', 'agent', 'Agent Name', 'AgentName', 'Writing Agent', 'WritingAgent', 'Producer', 'producer', 'Writer', 'writer', 'Written By', 'WrittenBy', 'Producing Agent', 'ProducingAgent')
    const rawApplicant = getField(raw, 'Applicant', 'applicant', 'Client', 'client', 'Insured', 'insured', 'Client Name', 'ClientName')
    const rawPolicy    = getField(raw, 'Policy Name', 'policy_name', 'PolicyName', 'Policy', 'Product', 'product', 'Plan', 'plan', 'Product Name', 'ProductName')

    // Auto-exclude aggregate/total rows (e.g. a "Total" footer row from carrier exports)
    const isSummaryRow = /^totals?$/i.test(rawAgent.trim())
                      || /^totals?$/i.test(rawApplicant.trim())
                      || /^totals?$/i.test(rawPolicy.trim())
    if (isSummaryRow) {
      return {
        _csvIdx: idx, sfg_id: '', agentName: '', rawAgent, applicant: rawApplicant,
        carrier: '', policy_name: '', policy_number: '', status: '',
        submit_date: null, issue_date: null, face_amount: null, submitted_apv: null,
        submit_week: null, submit_week_num: null,
        isChildPolicy: false, isDuplicate: false,
        rowStatus: 'red', warnings: [], errors: ['Summary row — auto-excluded'],
        excluded: true, includeAnyway: false,
      }
    }
    const rawCarrier   = getField(raw, 'Carrier', 'carrier', 'Company', 'company', 'Insurance Company')
    const rawPolicyNo  = getField(raw, 'Policy Number', 'policy_number', 'PolicyNumber', 'Policy No', 'PolicyNo', 'Policy #', 'Contract Number', 'ContractNumber')
    const rawSubmDate  = getField(raw, 'Submit Date', 'submit_date', 'SubmitDate', 'Date Submitted', 'DateSubmitted', 'App Date', 'AppDate', 'Application Date', 'Submission Date')
    const rawIssDate   = getField(raw, 'Issue Date', 'issue_date', 'IssueDate', 'Date Issued', 'DateIssued', 'Issued Date')
    const rawFace      = getField(raw, 'Face Amount', 'face_amount', 'FaceAmount', 'FaceAmt', 'Face', 'Coverage Amount', 'Death Benefit', 'Benefit Amount')
    const rawSubmApv   = getField(raw, 'APV')
    const rawSfgId     = getField(raw, 'SFG ID', 'sfg_id', 'SfgId', 'SFGID', 'AgentCode', 'agentcode', 'Agent Code', 'Agent ID', 'AgentID', 'Producer Code', 'ProducerCode', 'Writing Agent Code', 'Writer Code')

    // Applicant: title-case normalise
    const origApplicant = rawApplicant  // already resolved above
    const applicant     = toTitleCase(origApplicant)
    if (applicant && applicant !== origApplicant) {
      warnings.push(`Applicant name normalized: "${origApplicant}" → "${applicant}"`)
    }

    const carrier    = rawCarrier
    const policyName = rawPolicy
    const policyNo   = rawPolicyNo
    const faceAmt    = parseNum(rawFace)
    const submApv    = parseNum(rawSubmApv)

    const submitDateObj  = parseCSVDate(rawSubmDate)
    const issueDateObj   = parseCSVDate(rawIssDate)
    const submitDateISO  = fmtISO(submitDateObj)
    const issueDateISO   = fmtISO(issueDateObj)
    const submitWeekObj  = calcSubmitWeek(submitDateObj)
    const submitWeekISO  = fmtISO(submitWeekObj)
    const submitWeekNum  = calcSubmitWeekNum(submitWeekObj)

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
    let isDuplicate      = false
    let isNotInOptRestore = false
    let existingId       = null
    if (sfg_id && applicant && submitDateISO && carrier && policyName) {
      const key = `${sfg_id.toLowerCase()}||${applicant.toLowerCase()}||${submitDateISO}||${carrier.toLowerCase()}||${policyName.toLowerCase()}`
      const existing = dupMap.get(key)
      if (existing) {
        isDuplicate = true
        if (existing.not_in_opt) {
          isNotInOptRestore = true
          existingId        = existing.id
          warnings.push('Currently marked Not in Opt — will restore into Opt and set APV')
        }
      }
    }

    const rowStatus = !matched ? 'red' : (isDuplicate || warnings.length > 0) ? 'yellow' : 'green'

    return {
      _csvIdx:          idx,
      sfg_id,
      agentName,
      rawAgent,
      applicant,
      carrier,
      policy_name:      policyName,
      policy_number:    policyNo,
      status:           '',   // never import status from CSV — left blank for manual entry
      submit_date:      submitDateISO,
      issue_date:       issueDateISO,
      face_amount:      faceAmt,
      submitted_apv:    submApv,
      issued_apv:       submApv,
      submit_week:      submitWeekISO,
      submit_week_num:  submitWeekNum,
      isChildPolicy,
      isDuplicate,
      isNotInOptRestore,
      existingId,
      rowStatus,
      warnings,
      errors,
      excluded:         isDuplicate && !isNotInOptRestore,  // restore rows auto-included
      includeAnyway:    false,
    }
  })
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status, excluded, isDuplicate, isNotInOptRestore }) {
  if (isNotInOptRestore) return <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Restore</span>
  if (excluded && isDuplicate) return <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">Duplicate</span>
  if (excluded) return <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Excluded</span>
  const map = {
    green:  ['bg-green-100 text-green-800',  'Ready'],
    yellow: ['bg-yellow-100 text-yellow-800','Review'],
    red:    ['bg-red-100 text-red-800',       'No Agent'],
  }
  const [cls, label] = map[status] ?? ['bg-gray-100 text-gray-700', status]
  return <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
}

function PreviewRow({ row, personnel, onUpdate, onAgentSelected, idx }) {
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
    onAgentSelected?.(p, row.rawAgent)
  }

  const noteCount = row.warnings.length + row.errors.length

  return (
    <div className={`border-b last:border-0 px-3 py-2 text-sm ${bgCls}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="w-16 flex-shrink-0">
          <StatusBadge status={row.rowStatus} excluded={row.excluded} isDuplicate={row.isDuplicate} isNotInOptRestore={row.isNotInOptRestore} />
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
                    className="px-2 py-1 hover:bg-blue-50 cursor-pointer text-gray-800"
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
  const [phase,        setPhase]        = useState('upload')   // upload | preview | confirm | importing | result
  const [rows,         setRows]         = useState([])
  const [parseError,   setParseError]   = useState('')
  const [result,       setResult]       = useState(null)
  const [filterStatus, setFilterStatus] = useState('all')
  const [defaultAgentSearch, setDefaultAgentSearch] = useState('')
  const [showDefaultAgentList, setShowDefaultAgentList] = useState(false)
  const [optNamePrompt, setOptNamePrompt] = useState(null) // { sfg_id, proposed }
  const fileRef = useRef()

  const redCount = rows.filter(r => r.rowStatus === 'red').length

  const defaultAgentResults = defaultAgentSearch.length > 1
    ? personnel.filter(p => {
        const name = (p.preferred_name || p.opt_name || '').toLowerCase()
        return name.includes(defaultAgentSearch.toLowerCase()) ||
               (p.sfg_id ?? '').toLowerCase().includes(defaultAgentSearch.toLowerCase())
      }).slice(0, 8)
    : []

  function applyDefaultAgent(p) {
    const name = (p.preferred_name || p.opt_name || '').trim()
    // Collect the raw agent names from affected rows
    const rawNames = [...new Set(
      rows.filter(r => r.rowStatus === 'red' && r.rawAgent).map(r => r.rawAgent.trim())
    )]
    setRows(prev => prev.map(r =>
      r.rowStatus === 'red'
        ? { ...r, sfg_id: p.sfg_id, agentName: name, rowStatus: r.warnings?.length > 0 ? 'yellow' : 'green', errors: [] }
        : r
    ))
    setDefaultAgentSearch('')
    setShowDefaultAgentList(false)
    // Offer to update opt_name if the CSV name differs from what's on file
    if (rawNames.length === 1 && rawNames[0].toLowerCase() !== (p.opt_name || '').trim().toLowerCase()) {
      setOptNamePrompt({ sfg_id: p.sfg_id, proposed: rawNames[0] })
    }
  }

  function handleRowAgentSelected(p, rawAgent) {
    // Called from PreviewRow when an agent is manually selected for a single row
    if (rawAgent && rawAgent.trim().toLowerCase() !== (p.opt_name || '').trim().toLowerCase()) {
      setOptNamePrompt({ sfg_id: p.sfg_id, proposed: rawAgent.trim() })
    }
  }

  async function confirmOptNameUpdate() {
    if (!optNamePrompt) return
    try {
      const res  = await fetch('/api/personnel', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sfg_id: optNamePrompt.sfg_id, updates: { opt_name: optNamePrompt.proposed } }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        console.error('[opt_name update]', data?.error ?? res.status)
        // Still dismiss the prompt — the import itself succeeded
      }
    } catch (err) {
      console.error('[opt_name update]', err)
    }
    setOptNamePrompt(null)
  }

  function finishParsing(jsonRows) {
    if (!jsonRows?.length) { setParseError('No data rows found in file.'); return }
    const detectedCols = Object.keys(jsonRows[0] ?? {})
    const processed = processRows(jsonRows, personnel, existingPolicies)
    const allRed = processed.every(r => r.rowStatus === 'red')
    if (allRed && processed.length > 0) {
      setParseError(`Agent column not found. Columns detected: ${detectedCols.join(', ')}`)
    }
    setRows(processed)
    setPhase('preview')
  }

  function handleFile(file) {
    if (!file) return
    setParseError('')

    const ext = file.name.split('.').pop().toLowerCase()

    // Excel files — use SheetJS
    if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') {
      const reader = new FileReader()
      reader.onload = e => {
        try {
          const wb   = XLSX.read(e.target.result, { type: 'array', cellDates: true })
          const ws   = wb.Sheets[wb.SheetNames[0]]
          const json = XLSX.utils.sheet_to_json(ws, { defval: '' })
          finishParsing(json)
        } catch (err) {
          setParseError(`Failed to read Excel file: ${err.message}`)
        }
      }
      reader.readAsArrayBuffer(file)
      return
    }

    // CSV files — use PapaParse
    Papa.parse(file, {
      header:          true,
      skipEmptyLines:  true,
      transformHeader: h => h.replace(/^﻿/, '').trim(),  // strip Excel BOM + whitespace
      complete(res) { finishParsing(res.data) },
      error(err)    { setParseError(err.message) },
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
    : filterStatus === 'duplicate'
    ? rows.filter(r => r.isDuplicate)
    : rows.filter(r => r.rowStatus === filterStatus)

  const counts = {
    green:     rows.filter(r => r.rowStatus === 'green'  && !r.excluded).length,
    yellow:    rows.filter(r => r.rowStatus === 'yellow' && !r.excluded).length,
    red:       rows.filter(r => r.rowStatus === 'red'    && !r.excluded).length,
    duplicate: rows.filter(r => r.isDuplicate && !r.isNotInOptRestore).length,
    restore:   rows.filter(r => r.isNotInOptRestore).length,
    excluded:  rows.filter(r => r.excluded && !r.isDuplicate).length,
  }

  // Rows eligible to import: included, not red (unless agent was assigned)
  const toImport = rows.filter(r => !r.excluded && r.rowStatus !== 'red')

  async function doImport() {
    setPhase('importing')
    // Rows excluded client-side (duplicates + manually excluded) never reach the
    // server, so we have to track them here and fold them into the result.
    const clientExcluded = rows.filter(r => r.excluded).length

    // Separate restore rows (not_in_opt updates) from regular inserts
    const toInsert  = toImport.filter(r => !r.isNotInOptRestore)
    const toRestore = toImport.filter(r =>  r.isNotInOptRestore)

    const payload = toInsert.map(r => ({
      sfg_id:          r.sfg_id,
      applicant:       r.applicant,
      carrier:         r.carrier,
      policy_name:     r.policy_name,
      policy_number:   r.policy_number   || null,
      face_amount:     r.face_amount,
      submitted_apv:   r.submitted_apv,
      issued_apv:      r.issued_apv,
      status:          r.status          || null,
      submit_date:     r.submit_date     || null,
      issue_date:      r.issue_date      || null,
      submit_week:     r.submit_week     || null,
      submit_week_num: r.submit_week_num ?? null,
      includeAnyway:   r.includeAnyway   ?? false,
      agentName:       r.agentName,
    }))

    const restores = toRestore.map(r => ({
      id:            r.existingId,
      submitted_apv: r.submitted_apv,
    }))

    try {
      const res  = await fetch('/api/policies?type=import', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ rows: payload, restores }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `Server error ${res.status}`)
      setResult({
        inserted: data.inserted  ?? 0,
        restored: data.restored  ?? 0,
        skipped:  (data.skipped  ?? 0) + clientExcluded,
        errors:   Array.isArray(data.errors) ? data.errors : [],
      })
      setPhase('result')
    } catch (err) {
      setResult({ inserted: 0, restored: 0, skipped: clientExcluded, errors: [{ error: err.message }] })
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
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">

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
                Upload a CSV or Excel file (.xlsx) with policy data. Required columns: <strong>Applicant</strong>, <strong>Carrier</strong>, <strong>Policy Name</strong>, <strong>Submit Date</strong>.
                Optional: Agent, SFG ID, Policy Number, Face Amount, Submitted APV, Issue Date, Status.
              </p>

              <div
                className="border-2 border-dashed border-gray-300 rounded-lg p-16 text-center cursor-pointer hover:border-blue-400 transition-colors"
                onDragOver={e => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
              >
                <p className="text-gray-400 text-sm">Drag &amp; drop a CSV or Excel file here, or <span className="text-blue-600 underline">click to browse</span></p>
                <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.xlsm" className="hidden" onChange={e => handleFile(e.target.files[0])} />
              </div>

              {parseError && <p className="text-red-600 text-sm">{parseError}</p>}
            </div>
          )}

          {/* ── Preview phase ── */}
          {phase === 'preview' && (
            <div className="space-y-3">
              {/* Parse warning (e.g. unrecognised agent column) */}
              {parseError && (
                <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 text-sm">
                  ⚠ {parseError}
                </p>
              )}

              {/* Summary chips */}
              <div className="flex gap-3 flex-wrap">
                <span className="px-3 py-1 rounded-full bg-green-100 text-green-800 text-sm font-medium">{counts.green} ready</span>
                <span className="px-3 py-1 rounded-full bg-yellow-100 text-yellow-800 text-sm font-medium">{counts.yellow} need review</span>
                <span className="px-3 py-1 rounded-full bg-red-100 text-red-800 text-sm font-medium">{counts.red} no agent</span>
                {counts.duplicate > 0 && <span className="px-3 py-1 rounded-full bg-orange-100 text-orange-700 text-sm font-medium">{counts.duplicate} duplicate{counts.duplicate !== 1 ? 's' : ''}</span>}
                {counts.restore > 0  && <span className="px-3 py-1 rounded-full bg-blue-100 text-blue-700 text-sm font-medium">{counts.restore} to restore</span>}
                {counts.excluded > 0  && <span className="px-3 py-1 rounded-full bg-gray-100 text-gray-600 text-sm font-medium">{counts.excluded} excluded</span>}
              </div>

              {/* Filter tabs */}
              <div className="flex gap-2 text-sm flex-wrap">
                {[
                  ['all',       `All (${rows.length})`],
                  ['green',     'Ready'],
                  ['yellow',    'Review'],
                  ['red',       'No Agent'],
                  ...(counts.duplicate > 0 ? [['duplicate', `Duplicates (${counts.duplicate})`]] : []),
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

              {/* Default agent assignment (shown when red rows exist) */}
              {redCount > 0 && (
                <div className="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm">
                  <span className="text-red-700 font-medium whitespace-nowrap">
                    {redCount} row{redCount !== 1 ? 's' : ''} missing agent —
                  </span>
                  <div className="relative flex-1 max-w-xs">
                    <input
                      type="text"
                      placeholder="Assign all to agent…"
                      value={defaultAgentSearch}
                      onChange={e => { setDefaultAgentSearch(e.target.value); setShowDefaultAgentList(true) }}
                      onFocus={() => setShowDefaultAgentList(true)}
                      onBlur={() => setTimeout(() => setShowDefaultAgentList(false), 150)}
                      className="w-full border border-red-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-400"
                    />
                    {showDefaultAgentList && defaultAgentResults.length > 0 && (
                      <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded shadow-lg max-h-48 overflow-y-auto">
                        {defaultAgentResults.map(p => (
                          <button
                            key={p.sfg_id}
                            onMouseDown={() => applyDefaultAgent(p)}
                            className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm text-gray-800"
                          >
                            <span className="font-medium">{p.preferred_name || p.opt_name}</span>
                            <span className="text-gray-400 ml-2 text-xs">{p.sfg_id}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

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
                        onAgentSelected={handleRowAgentSelected}
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
                  <span className="font-semibold text-green-700">{toImport.filter(r => !r.isNotInOptRestore).length}</span>
                </div>
                {toImport.filter(r => r.isNotInOptRestore).length > 0 && (
                  <div className="flex justify-between border-b pb-2">
                    <span className="text-gray-600">Not-in-Opt policies to restore</span>
                    <span className="font-semibold text-blue-700">{toImport.filter(r => r.isNotInOptRestore).length}</span>
                  </div>
                )}
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
              <div className={`border rounded-lg p-5 space-y-3 text-sm ${result.errors.length ? 'bg-yellow-50 border-yellow-200' : 'bg-green-50 border-green-200'}`}>
                <p className="font-semibold text-base text-gray-900">{result.errors.length ? 'Import completed with errors' : 'Import complete ✓'}</p>
                <div className="flex justify-between">
                  <span className="text-gray-600">Rows inserted</span>
                  <span className="font-semibold text-green-700">{result.inserted}</span>
                </div>
                {(result.restored ?? 0) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Not-in-Opt restored</span>
                    <span className="font-semibold text-blue-700">{result.restored}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-600">Skipped (duplicates)</span>
                  <span className="font-semibold text-gray-700">{result.skipped}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Errors</span>
                  <span className={`font-semibold ${result.errors.length ? 'text-red-600' : 'text-gray-700'}`}>{result.errors.length}</span>
                </div>
              </div>

              {result.errors.length > 0 && (
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

        {/* Opt Name update confirmation dialog */}
        {optNamePrompt && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30 rounded-xl">
            <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
              <h3 className="text-base font-semibold text-gray-800">Update Opt Name?</h3>
              <p className="text-sm text-gray-600">
                The CSV shows <strong>"{optNamePrompt.proposed}"</strong> for this agent.
                Would you like to update their Opt Name on file to match?
                This will help future imports auto-match correctly.
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setOptNamePrompt(null)}
                  className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  No, keep current
                </button>
                <button
                  onClick={confirmOptNameUpdate}
                  className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700"
                >
                  Yes, update
                </button>
              </div>
            </div>
          </div>
        )}

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
