import { useEffect, useRef, useState } from 'react'
import Papa from 'papaparse'
import { useAuth } from '../context/AuthContext'

// ─── Mapping constants ─────────────────────────────────────────────────────────

const ANALOG_SYMMETRY_LEVELS = new Set([
  'A',
  'B1','B2','B3','B4','B5',
  'MI','MIA','MIB','MIC','MID','MIE','MIF','MIG','MIH',
  'CI','CIA','CIB','CIC','CID','CIE','CIF','CIG','CIH',
  'CIEA','CIEB','CIEC','CIED',
])

const STATUS_IMPORT_MAP = {
  'new lead':                  'new',
  'new':                       'new',
  'active lead':               'new',
  'contact attempted':         'attempted',
  'contact attempted2':        'attempted',
  'contact attempted3':        'attempted',
  'call again':                'callback',
  'appointment':               'appt',
  'application taken mp':      'sold',
  'application taken fe':      'sold',
  'credit received':           'bad',
  'credit denied':             'bad',
  'credit approved':           'bad',
  'language barrier':          'bad',
  'not interested':            'notint',
  'no interest':               'notint',
  'no contact (unreachable)':  'ghost',
}

function mapStatus(raw) {
  return STATUS_IMPORT_MAP[(raw || '').trim().toLowerCase()] ?? 'new'
}

function normalizeLeadType(raw) {
  const t = (raw || '').trim().toLowerCase()
  if (t === 'mortgage protection')              return 'Mortgage Protection'
  if (t === 'life' || t === 'life insurance')   return 'Life Insurance - Standard'
  if (t === 'debt free life')                   return 'Life Insurance - Standard'
  if (t === 'final expense')                    return 'Final Expense'
  if (t === 'application taken mp')             return 'Mortgage Protection'
  if (t === 'recruiting')                       return 'Recruiting'
  if (t === 'advanced')                         return 'Advanced'
  return 'Life Insurance - Standard'
}

function mapSourceTypeCategory(row) {
  const sub   = (row['LeadSubSource']  || '').trim()
  const src   = (row['LeadSource']     || '').trim()
  const alias = (row['LeadLevelAlias'] || '').trim()

  if (sub === 'RLMP')
    return { source: 'razor_ridge', lead_type: 'Mortgage Protection',        lead_level: null,          category: 'digital'    }
  if (sub === 'RLGL')
    return { source: 'razor_ridge', lead_type: 'Life Insurance - Standard',   lead_level: null,          category: 'digital'    }
  if (sub === 'LHMP')
    return { source: 'lighthouse',  lead_type: 'Mortgage Protection',        lead_level: alias || null, category: 'digital'    }
  if (sub === 'LHGL')
    return { source: 'lighthouse',  lead_type: 'Life Insurance - Standard',   lead_level: alias || null, category: 'digital'    }
  if (sub === 'LevelUp' || sub === 'Level Up Leads')
    return { source: 'level_up',    lead_type: normalizeLeadType(row['LeadType']), lead_level: null,     category: 'digital'    }
  if (src === 'FIF Reset')
    return { source: 'reset',       lead_type: 'Advanced',                   lead_level: null,          category: 'referral'   }
  if (alias === 'DEA')
    return { source: 'symmetry',    lead_type: 'Life Insurance - Standard',   lead_level: 'DEA',         category: 'digital'    }
  if (alias === 'Licensed' || alias === 'Unlicensed')
    return { source: 'symmetry',    lead_type: 'Recruiting',                 lead_level: alias,         category: 'recruiting' }
  if (alias === 'EXB' || alias === 'EXC' || alias === 'EXD')
    return { source: 'external',    lead_type: 'Mortgage Protection',        lead_level: alias,         category: 'analog'     }
  if (ANALOG_SYMMETRY_LEVELS.has(alias))
    return { source: 'symmetry',    lead_type: normalizeLeadType(row['LeadType']), lead_level: alias,    category: 'analog'     }
  if (alias === 'R')
    return { source: 'referral',    lead_type: 'Life Insurance - Standard',   lead_level: null,          category: 'referral'   }
  if (alias === 'X')
    return { source: 'referral',    lead_type: 'Life Insurance - Standard',   lead_level: null,          category: 'referral'   }

  return { source: 'other', lead_type: null, lead_level: null, category: null }
}

function toProperCase(str) {
  if (!str?.trim()) return ''
  return str.trim()
    .split(/\s+/)
    .map(word =>
      word.split('-').map(part =>
        part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
      ).join('-')
    )
    .join(' ')
}

function parseAssignDate(raw) {
  if (!raw) return null
  const m = String(raw).trim().match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

function parseRow(row, sfgId) {
  const first = toProperCase(row['FirstName'] || '')
  const last  = toProperCase(row['LastName']  || '')
  const name  = [first, last].filter(Boolean).join(' ')
  const phone = (row['CellPhone'] || row['Phone'] || '').replace(/\D/g, '')

  if (!name || !phone) return null

  const stc    = mapSourceTypeCategory(row)
  const added  = parseAssignDate(row['AssignDate'])

  return {
    sfg_id:          sfgId,
    name,
    phone,
    email:           (row['Email'] || '').trim().toLowerCase() || null,
    city:            toProperCase(row['City']   || ''),
    state:           (row['State']  || '').trim().toUpperCase() || null,
    zip:             (row['Zip']    || '').trim() || null,
    county:          toProperCase(row['County'] || ''),
    age:             row['Age']   ? (parseInt(row['Age'],  10) || null) : null,
    dob:             row['Birthday'] ? String(row['Birthday']).slice(0, 10) : null,
    gender:          (row['Sex'] || '').trim() || null,
    income:          row['HouseholdIncome']          ? (parseInt(row['HouseholdIncome'],          10) || null) : null,
    coverage:        row['RequestedCoverageAmount']  ? (parseInt(row['RequestedCoverageAmount'],  10) || null) : null,
    notes:           (row['Comments'] || '').trim() || null,
    vendor_lead_id:  (row['LeadAssignmentID'] || '').trim() || null,
    assigned_date:   added,
    added:           added || new Date().toISOString().slice(0, 10),
    status:          mapStatus(row['LeadStatus']),
    source:          stc.source,
    lead_type:       stc.lead_type,
    lead_level:      stc.lead_level,
    category:        stc.category,
  }
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function BulkLeadImportModal({ onClose, onImported, authHeaders }) {
  const { userProfile } = useAuth()
  const sfgId = userProfile?.sfg_id ?? ''

  const [parsed,    setParsed]    = useState(null)   // { rows, skippedBlank, total }
  const [importing, setImporting] = useState(false)
  const [result,    setResult]    = useState(null)   // { inserted, skipped, errors }
  const [fileError, setFileError] = useState('')
  const fileRef = useRef(null)

  // Close on Escape
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleFile(file) {
    if (!file) return
    setFileError('')
    setParsed(null)
    setResult(null)

    Papa.parse(file, {
      header:         true,
      skipEmptyLines: true,
      complete(res) {
        const rows = []
        let skippedBlank = 0
        for (const raw of res.data) {
          const r = parseRow(raw, sfgId.toUpperCase())
          if (r) rows.push(r)
          else   skippedBlank++
        }
        setParsed({ rows, skippedBlank, total: res.data.length })
      },
      error(err) {
        setFileError('Failed to parse file: ' + err.message)
      },
    })
  }

  async function handleImport() {
    if (!parsed?.rows.length) return
    setImporting(true)
    setResult(null)

    try {
      const res = await fetch('/api/leads?action=bulk', {
        method:  'POST',
        headers: authHeaders({}),
        body:    JSON.stringify({ sfg_id: sfgId.toUpperCase(), leads: parsed.rows }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Import failed')
      setResult(data)
      if (data.inserted?.length) onImported(data.inserted)
    } catch (e) {
      setResult({ error: e.message })
    } finally {
      setImporting(false)
    }
  }

  const canImport = !!sfgId && parsed?.rows.length > 0 && !result

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white dark:bg-primary rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/10 shrink-0">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Import Leads</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors text-xl leading-none">✕</button>
        </div>

        <div className="overflow-y-auto px-6 py-5 space-y-5">

          {/* File upload */}
          <div>
            <p className="text-xs font-semibold text-gray-400 dark:text-white/40 uppercase tracking-wider mb-2">CSV File</p>
            <div
              className="border-2 border-dashed border-gray-200 dark:border-white/15 rounded-xl p-6 text-center cursor-pointer hover:border-accent/40 hover:bg-accent/5 transition-colors"
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]) }}
            >
              <p className="text-sm text-gray-500 dark:text-white/50">
                {parsed
                  ? <span className="text-accent font-medium">✓ File loaded</span>
                  : 'Click or drag a Quility CSV export here'}
              </p>
              {!parsed && (
                <p className="text-xs text-gray-400 dark:text-white/30 mt-1">Expects standard Quility export format</p>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".csv" className="hidden"
              onChange={e => handleFile(e.target.files[0])} />
            {fileError && <p className="text-xs text-red-500 mt-1">{fileError}</p>}
          </div>

          {/* Preview */}
          {parsed && !result && (
            <div className="bg-gray-50 dark:bg-white/5 rounded-xl p-4 space-y-2">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">Preview</p>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-xl font-bold text-accent">{parsed.total}</p>
                  <p className="text-xs text-gray-400 dark:text-white/40">Total rows</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-green-600 dark:text-green-400">{parsed.rows.length}</p>
                  <p className="text-xs text-gray-400 dark:text-white/40">Will import</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-gray-400">{parsed.skippedBlank}</p>
                  <p className="text-xs text-gray-400 dark:text-white/40">Skipped (no name/phone)</p>
                </div>
              </div>
              <p className="text-xs text-gray-400 dark:text-white/30 pt-1">
                Duplicates (same phone + agent) will be skipped at import time.
              </p>
            </div>
          )}

          {/* Result */}
          {result && !result.error && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700/40 rounded-xl p-4 space-y-2">
              <p className="text-sm font-semibold text-green-800 dark:text-green-300">Import complete</p>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-xl font-bold text-green-700 dark:text-green-400">{result.inserted?.length ?? 0}</p>
                  <p className="text-xs text-green-600 dark:text-green-500/70">Imported</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-gray-500 dark:text-white/40">{result.skipped ?? 0}</p>
                  <p className="text-xs text-gray-400 dark:text-white/30">Duplicates skipped</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-red-500">{result.errors ?? 0}</p>
                  <p className="text-xs text-gray-400 dark:text-white/30">Errors</p>
                </div>
              </div>
            </div>
          )}
          {result?.error && (
            <p className="text-sm text-red-500 dark:text-red-400">{result.error}</p>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-white/10 flex justify-end gap-3 shrink-0">
          <button onClick={onClose}
            className="text-sm px-4 py-2 rounded-lg border border-gray-200 dark:border-white/20 text-gray-600 dark:text-white/70 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
            {result && !result.error ? 'Done' : 'Cancel'}
          </button>
          {canImport && (
            <button onClick={handleImport} disabled={importing}
              className="text-sm px-5 py-2 rounded-lg bg-accent text-white font-semibold hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              {importing ? 'Importing…' : `Import ${parsed.rows.length.toLocaleString()} leads`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
