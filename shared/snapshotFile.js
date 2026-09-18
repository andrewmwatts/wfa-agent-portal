/**
 * Snapshot upload files — format detection and parsing.
 *
 * Step 1 and Final Review accept two different exports through one uploader and
 * work out which one they were handed from the CONTENT (header row), never the
 * extension:
 *
 *   agent_totals — the Snapshot workbook: a "SnapShot by Agent" sheet with one row
 *                  per agent + carrier and a single placed-APV figure. Agent names
 *                  are Opt names, so they match the roster exactly.
 *
 *   policy_lines — a "Placed Policies" export (CSV or sheet): one row per policy
 *                  transaction with agent, policy #, client, annualized premium,
 *                  carrier, and Production / Reversal. Agent names here are NOT in
 *                  a fixed format, so they are resolved later against the roster
 *                  with the policy numbers as the primary evidence
 *                  (see shared/snapshotReconcile.js).
 *
 * Input is a list of sheets as plain 2-D arrays, so the same code runs in the
 * browser (after SheetJS / PapaParse read the file) and on the server. Keep this
 * file dependency-free — the React app and the API both import it.
 */

// ── Carrier names ────────────────────────────────────────────────────────────

// Snapshot-specific carrier normalization (a report's label for a carrier).
export const SNAPSHOT_ALIASES = {
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

export function normalizeSnapshotCarrier(raw) {
  if (!raw) return raw
  return SNAPSHOT_ALIASES[raw.trim().toLowerCase()] ?? raw.trim()
}

// ── Formats ──────────────────────────────────────────────────────────────────

export const FORMAT_AGENT_TOTALS = 'agent_totals'
export const FORMAT_POLICY_LINES = 'policy_lines'

const UNRECOGNIZED =
  'This file isn\'t a format the importer knows. Expected either the Snapshot workbook ' +
  '(a "SnapShot by Agent" sheet) or a Placed Policies export with Agent, Policy #, ' +
  'Annualized Premium and Carrier columns.'

// ── Dates ────────────────────────────────────────────────────────────────────

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function ym(year, month) {
  if (!(month >= 1 && month <= 12) || !(year >= 2000 && year <= 2100)) return null
  return `${year}-${String(month).padStart(2, '0')}`
}

/**
 * A business date / month cell → 'YYYY-MM', or null when unreadable.
 * Handles "Aug-26", "August 2026", "2026-08(-31)", "8/31/2026", "8/2026" and Excel
 * serials (a sheet cell formatted mmm-yy arrives as a number).
 */
export function parseBusinessMonth(value) {
  if (value == null || value === '') return null

  if (typeof value === 'number') {
    if (value < 20000 || value > 80000) return null
    const d = new Date(Math.round((value - 25569) * 86400000))   // Excel epoch → UTC
    return ym(d.getUTCFullYear(), d.getUTCMonth() + 1)
  }

  const s = String(value).trim()
  let m = s.match(/^([A-Za-z]{3,9})\.?[\s\-/,]+(\d{2}|\d{4})$/)               // Aug-26 · August 2026
  if (m) {
    const mi = MONTH_NAMES.indexOf(m[1].slice(0, 3).toLowerCase())
    if (mi >= 0) return ym(m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]), mi + 1)
  }
  m = s.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?/)                              // 2026-08 · 2026-08-31
  if (m) return ym(Number(m[1]), Number(m[2]))
  m = s.match(/^(\d{1,2})\/(?:\d{1,2}\/)?(\d{2}|\d{4})$/)                     // 8/2026 · 8/31/2026 · 8/31/26
  if (m) return ym(m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]), Number(m[1]))
  return null
}

// ── Cell helpers ─────────────────────────────────────────────────────────────

function clean(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim()
}

/** "$1,234.50" · "(123.45)" · 1234.5 → number, or null when not numeric. */
function parseMoney(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  let s = String(v ?? '').trim()
  if (!s) return null
  const negative = /^\(.*\)$/.test(s) || s.startsWith('-')
  s = s.replace(/[$,()\s-]/g, '')
  if (!s || isNaN(Number(s))) return null
  return negative ? -Math.abs(Number(s)) : Number(s)
}

const norm = h => String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

// ── Policy-lines format ──────────────────────────────────────────────────────

const POLICY_HEADERS = {
  agent:   ['agent', 'agent name', 'writing agent'],
  policy:  ['policy #', 'policy#', 'policy number', 'policy no', 'policy no.'],
  client:  ['client', 'client name', 'insured', 'insured name', 'applicant'],
  apv:     ['annualized premium', 'annual premium', 'apv', 'annualized premium (apv)'],
  carrier: ['carrier', 'company'],
  product: ['product', 'product name', 'plan'],
  txn:     ['transaction type', 'transaction', 'txn type'],
  date:    ['business date', 'business month'],
}

function findPolicyHeader(rows) {
  const scan = Math.min(rows.length, 25)
  for (let i = 0; i < scan; i++) {
    const cols = {}
    ;(rows[i] ?? []).forEach((cell, j) => {
      const h = norm(cell)
      for (const [key, names] of Object.entries(POLICY_HEADERS)) {
        if (cols[key] === undefined && names.includes(h)) cols[key] = j
      }
    })
    if (cols.agent !== undefined && cols.policy !== undefined &&
        cols.apv !== undefined && cols.carrier !== undefined) {
      return { headerIdx: i, cols }
    }
  }
  return null
}

function parsePolicyLines(rows, { headerIdx, cols }) {
  const cell = (row, key) => (cols[key] === undefined ? '' : row[cols[key]])
  const policies = []

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] ?? []
    const agent = clean(cell(row, 'agent'))
    if (!agent || /^(grand )?total$/i.test(agent)) continue

    const apv = parseMoney(cell(row, 'apv'))
    if (apv === null || apv === 0) continue        // blank / $0 lines carry nothing to compare

    let txn = clean(cell(row, 'txn')).toLowerCase() || (apv < 0 ? 'reversal' : 'production')
    let amount = apv
    if (txn === 'reversal' && amount > 0) amount = -amount   // reversals are always money going back

    const rawNumber = cell(row, 'policy')
    policies.push({
      agent_name:     agent,
      policy_number:  typeof rawNumber === 'number' ? String(rawNumber) : clean(rawNumber),
      client:         clean(cell(row, 'client')),
      apv:            amount,
      carrier:        normalizeSnapshotCarrier(clean(cell(row, 'carrier'))),
      product:        clean(cell(row, 'product')),
      txn_type:       txn,
      business_month: parseBusinessMonth(cell(row, 'date')),
    })
  }

  const months = [...new Set(policies.map(p => p.business_month).filter(Boolean))].sort()
  return {
    format:   FORMAT_POLICY_LINES,
    policies,
    meta: {
      lines:     policies.length,
      agents:    new Set(policies.map(p => p.agent_name.toLowerCase())).size,
      reversals: policies.filter(p => p.apv < 0).length,
      months,
    },
  }
}

// ── Agent-totals format (the Snapshot workbook) ──────────────────────────────

function parseAgentTotals(rows) {
  let headerIdx = -1
  for (let i = 0; i < rows.length; i++) {
    const a = norm(rows[i]?.[0])
    const b = norm(rows[i]?.[1])
    if (a === 'agent' && b.includes('up-line')) { headerIdx = i; break }
  }
  if (headerIdx === -1) {
    // Fallback: look for a row where col A says "Agent"
    for (let i = 0; i < rows.length; i++) {
      if (norm(rows[i]?.[0]) === 'agent') { headerIdx = i; break }
    }
  }
  if (headerIdx === -1) return null

  const headers    = rows[headerIdx].map(norm)
  const agentCol   = headers.indexOf('agent')
  const carrierCol = headers.findIndex(h => h.includes('carrier') || h.includes('company'))
  const apvCol     = headers.findIndex(h => h.includes('placed') || h.includes('apv') || h.includes('premium') || h.includes('amount'))

  const agents = []
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row         = rows[i] ?? []
    const agentName   = String(row[agentCol >= 0 ? agentCol : 0] ?? '').trim()
    const carrierName = String(row[carrierCol >= 0 ? carrierCol : 2] ?? '').trim()
    const rawApv      = row[apvCol >= 0 ? apvCol : 3]
    const snapshotApv = parseFloat(String(rawApv ?? '').replace(/[$,]/g, '')) || 0

    if (!agentName || agentName.toLowerCase() === 'total' || agentName.toLowerCase() === 'grand total') continue
    if (!carrierName || snapshotApv === 0) continue

    agents.push({
      agent_name:   agentName,
      carrier:      normalizeSnapshotCarrier(carrierName),
      snapshot_apv: snapshotApv,
    })
  }
  return { format: FORMAT_AGENT_TOTALS, agents, meta: {} }
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Works out which export `sheets` holds and parses it.
 *
 * @param {Array<{ name: string, rows: any[][] }>} sheets
 * @returns {{ format, agents?, policies?, meta } | { error: string }}
 */
export function parseSnapshotSheets(sheets) {
  const list = (sheets ?? []).filter(s => Array.isArray(s?.rows))

  // A Policy # column is what separates the two, so check for it first.
  for (const sheet of list) {
    const header = findPolicyHeader(sheet.rows)
    if (header) return parsePolicyLines(sheet.rows, header)
  }

  const agentSheet = list.find(s => s.name === 'SnapShot by Agent') ?? list[1] ?? list[0]
  if (agentSheet) {
    const parsed = parseAgentTotals(agentSheet.rows)
    if (parsed) return parsed
  }

  return { error: UNRECOGNIZED }
}
