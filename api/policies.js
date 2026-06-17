import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import { normalizeCarrier } from '../shared/carriers.js'
import { requireAuth, authorizeScope, getAllowedSfgIds, requireSuperAdmin } from './_auth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

/**
 * Policies API  (consolidated: policies + add-policy + update-policy +
 *                policy-crosswalk + apps-policies + import-policies)
 *
 *   GET  /api/policies?sfg_ids=X         → list policies
 *   GET  /api/policies?type=apps&...     → apps/pending-business dashboard
 *   GET  /api/policies?type=crosswalk    → policy crosswalk table
 *   POST /api/policies                   → add single policy
 *   POST /api/policies?type=import       → bulk import policies
 *   PUT  /api/policies                   → update policy fields
 */

// ── Shared helpers ────────────────────────────────────────────────────────────

const POLICY_COLS = [
  'id', 'sfg_id', 'applicant', 'carrier', 'policy_name', 'policy_number',
  'face_amount', 'submitted_apv', 'issued_apv', 'status',
  'submit_date', 'submit_week', 'submit_week_num', 'issue_date', 'last_update',
  'application_notes', 'policy_notes', 'not_in_opt', 'split_reset', 'chargeback_exempt',
  'conservation_status', 'conservation_date',
  'snapshot_chargeback_month', 'snapshot_chargeback_apv',
].join(', ')

// applyFilter is an optional function (q => q) for caller-specific WHERE clauses
async function fetchPolicies(supabase, sfgIds, applyFilter = null) {
  const PAGE = 10000
  const results = []
  let from = 0
  while (true) {
    let q = supabase.from('policies').select(POLICY_COLS).order('id')
    if (sfgIds?.length) q = q.in('sfg_id', sfgIds.map(id => id.toUpperCase()))
    if (applyFilter)    q = applyFilter(q)
    const { data, error } = await q.range(from, from + PAGE - 1)
    if (error) throw error
    results.push(...(data ?? []))
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return results
}

// ── Carrier-metrics cache ─────────────────────────────────────────────────────
let carrierMetricsCache = null
let carrierMetricsCacheTs = 0
const CARRIER_METRICS_TTL = 60 * 60 * 1000 // 1 hour

// ── Resolve master-agency SFG IDs from a root sfg_id ─────────────────────────
// Lightweight alternative to calling /api/personnel — skips promotions/milestones
// and just builds the tree. Used so type=apps can be fired in parallel with
// the full personnel call instead of waiting for it.
// Results are cached for 1 hour per root — the team tree changes rarely and
// this eliminates a full personnel table scan on every apps request.
const masterIdsCache = new Map()
const MASTER_IDS_TTL = 60 * 60 * 1000

async function resolveMasterIds(supabase, rootSfgId) {
  const key = rootSfgId.trim().toLowerCase()
  const hit = masterIdsCache.get(key)
  if (hit && hit.exp > Date.now()) return hit.ids

  const { data } = await supabase
    .from('personnel')
    .select('sfg_id, upline_sfg_id')
  const childrenOf = {}
  for (const p of data ?? []) {
    const up = p.upline_sfg_id?.trim().toLowerCase()
    if (!up) continue
    ;(childrenOf[up] ??= []).push(p.sfg_id.toLowerCase())
  }
  const ids = new Set()
  function traverse(id) {
    ids.add(id.toUpperCase())
    for (const child of childrenOf[id] ?? []) traverse(child)
  }
  traverse(key)
  const result = [...ids]
  masterIdsCache.set(key, { ids: result, exp: Date.now() + MASTER_IDS_TTL })
  return result
}

async function fetchAll(supabase, table, columns) {
  const PAGE = 10000
  const results = []
  let from = 0
  while (true) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + PAGE - 1)
    if (error) throw error
    results.push(...(data ?? []))
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return results
}

function formatCbMonth(dateStr) {
  if (!dateStr) return ''
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-\d{2}/)
  if (!m) return String(dateStr)
  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December']
  const monthIdx = parseInt(m[2]) - 1
  if (monthIdx < 0 || monthIdx > 11) return String(dateStr)
  return `${MONTHS[monthIdx]} ${parseInt(m[1])}`
}

function parseNum(val) {
  if (val === '' || val == null) return null
  const n = parseFloat(String(val).replace(/[$,]/g, ''))
  return isNaN(n) ? null : n
}

function parseDate(val) {
  if (!val || String(val).trim() === '') return null
  return String(val).trim()
}

// ── update-policy coercion helpers ───────────────────────────────────────────

const NUMERIC_COLS  = new Set(['submitted_apv', 'issued_apv', 'face_amount', 'snapshot_chargeback_apv'])
const BOOLEAN_COLS  = new Set(['not_in_opt', 'split_reset', 'chargeback_exempt', 'first_time'])
const DATE_COLS     = new Set(['submit_date', 'submit_week', 'issue_date', 'last_update', 'conservation_date', 'snapshot_chargeback_month'])
const CB_MONTH_NAMES = {
  january:1, february:2, march:3, april:4, may:5, june:6,
  july:7, august:8, september:9, october:10, november:11, december:12,
}

function coerce(col, val) {
  if (BOOLEAN_COLS.has(col)) {
    if (typeof val === 'boolean') return val          // already boolean — fast path
    const v = String(val ?? '').trim().toLowerCase()
    return ['true', '1', 'yes', 'x'].includes(v)
  }
  if (col === 'snapshot_chargeback_month') {
    if (!val || String(val).trim() === '') return null
    const s = String(val).trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
    const lower = s.toLowerCase()
    for (const [name, num] of Object.entries(CB_MONTH_NAMES)) {
      if (lower.includes(name)) {
        const yearMatch = s.match(/(\d{4})/)
        if (yearMatch) return `${yearMatch[1]}-${String(num).padStart(2, '0')}-01`
      }
    }
    return null
  }
  if (col === 'sfg_id') return String(val ?? '').trim().toUpperCase() || null
  if (DATE_COLS.has(col)) return (val === '' || val == null) ? null : val
  if (NUMERIC_COLS.has(col)) {
    if (val === '' || val == null) return null
    const n = parseFloat(String(val).replace(/[$,]/g, ''))
    return isNaN(n) ? null : n
  }
  return (val === '' || val == null) ? null : String(val)
}

// ── apps-policies helpers ─────────────────────────────────────────────────────

const LAPSE_CONSV_STATUSES = new Set(['lapse pending', 'first premium not paid'])

function parseDateLocal(str) {
  if (!str) return null
  const iso = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]))
  const d = new Date(str)
  return isNaN(d.getTime()) ? null : d
}

function parseAmt(val) {
  if (val === null || val === undefined || val === '') return 0
  if (typeof val === 'number') return val
  return parseFloat(String(val).replace(/[$,]/g, '')) || 0
}

function daysDiff(dateStr) {
  const d = parseDateLocal(dateStr)
  if (!d) return null
  return Math.round((d - Date.now()) / 86400000)
}

function inPeriod(dateStr, start, end) {
  const d = parseDateLocal(dateStr)
  if (!d) return false
  return d >= start && (!end || d < end)
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const caller = await requireAuth(req, res)
  if (!caller) return

  const type = req.query.type  // 'apps' | 'crosswalk' | 'import' | undefined

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  // ── GET /api/policies?type=crosswalk ───────────────────────────────────────
  if (req.method === 'GET' && type === 'crosswalk') {
    try {
      const { data, error } = await supabase
        .from('policy_crosswalk')
        .select('carrier, policy_name, subtype')
        .order('carrier')
        .order('policy_name')
      if (error) throw error
      return res.status(200).json(data ?? [])
    } catch (err) {
      console.error('[policies/crosswalk]', err)
      return res.status(500).json({ error: 'Failed to load crosswalk' })
    }
  }

  // ── GET /api/policies?type=carrier-metrics ────────────────────────────────
  // Aggregate placement rates + avg issue days across ALL policies (no user filter).
  // Grouped by carrier × subtype.  Only counts terminal placement statuses:
  // issued, declined, withdrawn, not taken.
  if (req.method === 'GET' && type === 'carrier-metrics') {
    try {
      const now = Date.now()
      if (carrierMetricsCache && now - carrierMetricsCacheTs < CARRIER_METRICS_TTL) {
        return res.status(200).json(carrierMetricsCache)
      }

      // Paginated fetch — same pattern as fetchAll so we get every row
      const [policies, crosswalk] = await Promise.all([
        fetchAll(supabase, 'policies', 'carrier, policy_name, status, submit_date, issue_date'),
        fetchAll(supabase, 'policy_crosswalk', 'carrier, policy_name, subtype'),
      ])

      // Build crosswalk lookup: "carrier‖policy_name" → subtype
      const cwMap = {}
      for (const row of crosswalk) {
        const key = `${(row.carrier ?? '').trim().toLowerCase()}‖${(row.policy_name ?? '').trim().toLowerCase()}`
        cwMap[key] = row.subtype?.trim() || null
      }

      // Carrier normalization shared with the client (shared/carriers.js)
      const normCarrier = normalizeCarrier

      const PLACEMENT = new Set(['issued', 'declined', 'withdrawn', 'not taken'])

      // carrier|subtype → accumulator
      const groups = {}

      for (const p of policies) {
        const rawCarrier = (p.carrier ?? '').trim()
        if (!rawCarrier) continue
        const carrier = normCarrier(rawCarrier)

        const status = (p.status ?? '').trim().toLowerCase()
        if (!PLACEMENT.has(status)) continue

        // Crosswalk lookup uses the raw carrier name (as stored in the crosswalk table)
        const cwKey  = `${rawCarrier.toLowerCase()}‖${(p.policy_name ?? '').trim().toLowerCase()}`
        const subtype = cwMap[cwKey] ?? null
        const groupKey = `${carrier}|||${subtype ?? ''}`

        if (!groups[groupKey]) {
          groups[groupKey] = {
            carrier, subtype,
            issued: 0, declined: 0, withdrawn: 0, not_taken: 0,
            issue_days_sum: 0, issue_days_count: 0,
          }
        }

        const g = groups[groupKey]

        if (status === 'issued') {
          g.issued++
          if (p.submit_date && p.issue_date) {
            const days = Math.round(
              (new Date(p.issue_date) - new Date(p.submit_date)) / 86_400_000
            )
            if (days >= 0) { g.issue_days_sum += days; g.issue_days_count++ }
          }
        } else if (status === 'declined')  { g.declined++  }
        else if (status === 'withdrawn')   { g.withdrawn++ }
        else if (status === 'not taken')   { g.not_taken++ }
      }

      const rows = Object.values(groups).map(g => {
        const total = g.issued + g.declined + g.withdrawn + g.not_taken
        const pct   = n => total ? Math.round(n / total * 100) : null
        return {
          carrier:          g.carrier,
          subtype:          g.subtype,
          total,
          issued:           g.issued,
          declined:         g.declined,
          withdrawn:        g.withdrawn,
          not_taken:        g.not_taken,
          issued_pct:       pct(g.issued),
          declined_pct:     pct(g.declined),
          withdrawn_pct:    pct(g.withdrawn),
          not_taken_pct:    pct(g.not_taken),
          issue_days_sum:   g.issue_days_sum,
          issue_days_count: g.issue_days_count,
          avg_issue_days:   g.issue_days_count > 0
            ? Math.round(g.issue_days_sum / g.issue_days_count)
            : null,
        }
      })

      // Sort: carrier A→Z, then nulls-last subtype A→Z
      rows.sort((a, b) => {
        const cc = a.carrier.localeCompare(b.carrier)
        if (cc !== 0) return cc
        if (a.subtype === null && b.subtype !== null) return  1
        if (a.subtype !== null && b.subtype === null) return -1
        return (a.subtype ?? '').localeCompare(b.subtype ?? '')
      })

      carrierMetricsCache   = rows
      carrierMetricsCacheTs = Date.now()
      return res.status(200).json(rows)
    } catch (err) {
      console.error('[policies/carrier-metrics]', err)
      return res.status(500).json({ error: err?.message ?? 'Failed to load carrier metrics' })
    }
  }

  // ── GET /api/policies?type=apps&sfg_ids=X  (or &root=X&mode=master) ─────────
  if (req.method === 'GET' && type === 'apps') {
    const raw = req.query.sfg_ids ?? req.query.sfg_id ?? ''
    let requestedIds = raw
      ? raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
      : []

    try {
      // Authorize the requested scope before expanding any tree. With no scope at
      // all, only super_admin may pull the full unscoped set.
      const scopeIds = requestedIds.length
        ? requestedIds
        : (req.query.root?.trim() ? [req.query.root.trim()] : [])
      if (scopeIds.length) {
        if (!(await authorizeScope(req, res, caller, supabase, scopeIds))) return
      } else {
        const allowed = await getAllowedSfgIds(caller, supabase)
        if (allowed !== null) return res.status(403).json({ error: 'Forbidden' })
      }

      // root= lets callers skip a separate personnel round-trip — we resolve the
      // tree internally so the Dashboard can fire this in parallel with /api/personnel.
      if (!requestedIds.length && req.query.root?.trim()) {
        requestedIds = await resolveMasterIds(supabase, req.query.root)
      }

      // 6-month filter: keeps the pagination loop to 1 round for most teams.
      // Always includes pending/incomplete (current state) and conservation policies
      // (lapse list) regardless of age — only the date-filtered path is trimmed.
      const sixMonthsAgo = new Date()
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
      const since = sixMonthsAgo.toISOString().slice(0, 10)
      const appsFilter = q => q.or(
        `submit_date.gte.${since},issue_date.gte.${since},status.in.(pending,incomplete),conservation_status.not.is.null`
      )

      // Fetch policies + agent names in parallel.
      // Name lookup is scoped to requested agents only — no longer a full-table scan.
      const upperIds = requestedIds.map(id => id.toUpperCase())
      const [allRows, people] = await Promise.all([
        fetchPolicies(supabase, requestedIds.length ? requestedIds.map(id => id.toLowerCase()) : null, appsFilter),
        requestedIds.length
          ? supabase.from('personnel')
              .select('sfg_id, preferred_name, opt_name')
              .in('sfg_id', upperIds)
              .then(r => r.data ?? [])
          : fetchAll(supabase, 'personnel', 'sfg_id, preferred_name, opt_name'),
      ])

      if (!allRows.length) return res.status(200).json({ pending: [], incomplete: [], lapse: [], metrics: null })

      const personLookup = {}
      for (const p of people) {
        const id = p.sfg_id?.toLowerCase()
        if (id) personLookup[id] = { name: p.preferred_name?.trim() || p.opt_name?.trim() || '' }
      }

      const earliestSubmit = {}
      for (const p of allRows) {
        const id  = p.sfg_id?.trim().toLowerCase()
        const key = p.submit_week || p.submit_date
        if (!id || !key) continue
        if (!earliestSubmit[id] || key < earliestSubmit[id]) earliestSubmit[id] = key
      }

      const now        = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 1)
      const weekStart  = (() => { const d = new Date(now); d.setDate(d.getDate() - d.getDay()); d.setHours(0,0,0,0); return d })()
      const lwStart    = new Date(weekStart.getTime()); lwStart.setDate(lwStart.getDate() - 7)

      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
      const daysElapsed = Math.max(now.getDate(), 1)
      const projFactor  = daysInMonth / daysElapsed

      const pending = [], incomplete = [], lapse = []
      let submMonth = 0, submWeek = 0, submLW = 0, issMonth = 0
      const totalWriters = { month: new Set(), week: new Set(), lw: new Set() }
      const newWriters   = { month: new Set(), week: new Set(), lw: new Set() }
      const submMonthItems = []
      const issMonthItems  = []
      const totalWritersItems = new Map()
      const newWritersItems   = new Map()

      for (const p of allRows) {
        const sfgId     = p.sfg_id?.trim()
        if (!sfgId) continue
        const sfgLower   = sfgId.toLowerCase()
        const status     = (p.status ?? '').trim()
        const issueDate  = p.issue_date         ?? ''
        const submitDate = p.submit_date        ?? ''
        const submitWeek = p.submit_week        ?? ''
        const consvStatus = (p.conservation_status ?? '').trim()
        const submApv    = parseAmt(p.submitted_apv)
        const issApv     = parseAmt(p.issued_apv)
        const person     = personLookup[sfgLower] ?? {}
        const agentName  = person.name || ''
        const earliest   = earliestSubmit[sfgLower]
        const submitKey  = submitWeek

        const base = {
          id: p.id, sfg_id: sfgId, agent: agentName, agent_email: '',
          applicant:  (p.applicant    ?? '').trim(),
          carrier:    (p.carrier      ?? '').trim(),
          policy:     (p.policy_name  ?? '').trim(),
          policy_no:  (p.policy_number ?? '').trim(),
          face_amt:   p.face_amount   != null ? String(p.face_amount)    : '',
          issued_apv: p.issued_apv    != null ? String(p.issued_apv)     : '',
          subm_apv:   p.submitted_apv != null ? String(p.submitted_apv)  : '',
          last_update: p.last_update  ?? '',
        }

        if (inPeriod(submitKey, monthStart, monthEnd)) {
          totalWriters.month.add(sfgLower)
          totalWritersItems.set(sfgLower, { sfg_id: sfgId, agent: agentName })
          if (earliest && inPeriod(earliest, monthStart, monthEnd)) {
            newWriters.month.add(sfgLower)
            newWritersItems.set(sfgLower, { sfg_id: sfgId, agent: agentName })
          }
        }
        if (inPeriod(submitKey, weekStart)) {
          totalWriters.week.add(sfgLower)
          if (earliest && inPeriod(earliest, weekStart)) newWriters.week.add(sfgLower)
        }
        if (inPeriod(submitKey, lwStart, weekStart)) {
          totalWriters.lw.add(sfgLower)
          if (earliest && inPeriod(earliest, lwStart, weekStart)) newWriters.lw.add(sfgLower)
        }

        if (submApv > 0) {
          if (inPeriod(submitKey, monthStart, monthEnd)) {
            submMonth += submApv
            submMonthItems.push({
              sfg_id: sfgId, agent: agentName,
              applicant:   (p.applicant ?? '').trim(),
              carrier:     (p.carrier   ?? '').trim(),
              subm_apv:    String(p.submitted_apv),
              submit_week: submitWeek,
              submit_date: submitDate,
            })
          }
          if (inPeriod(submitKey, weekStart))          submWeek += submApv
          if (inPeriod(submitKey, lwStart, weekStart)) submLW   += submApv
        }

        if (issApv > 0 && inPeriod(issueDate, monthStart, monthEnd)) {
          issMonth += issApv
          issMonthItems.push({
            sfg_id: sfgId, agent: agentName,
            applicant:  (p.applicant ?? '').trim(),
            carrier:    (p.carrier   ?? '').trim(),
            issued_apv: String(p.issued_apv),
            issue_date: issueDate,
          })
        }

        const statusLower = status.toLowerCase()
        if (!status || statusLower === 'pending') {
          pending.push({ ...base, status, submit_date: submitDate, open_req: (p.application_notes ?? '').trim() })
        }
        if (statusLower === 'incomplete') {
          incomplete.push({ ...base, status, submit_date: submitDate, open_req: (p.application_notes ?? '').trim() })
        }
        if (LAPSE_CONSV_STATUSES.has(consvStatus.toLowerCase())) {
          const consvDate = p.conservation_date ?? ''
          lapse.push({
            ...base,
            policy_type:         (p.policy_name   ?? '').trim(),
            policy_no:           (p.policy_number ?? '').trim(),
            issue_date:          issueDate,
            face_amt:            p.face_amount  != null ? String(p.face_amount)  : '',
            issued_apv:          p.issued_apv   != null ? String(p.issued_apv)   : '',
            cb_month:            formatCbMonth(p.snapshot_chargeback_month),
            cb_apv:              p.snapshot_chargeback_apv != null ? String(p.snapshot_chargeback_apv) : '',
            conservation_status: consvStatus,
            conservation_date:   consvDate,
            days_to_lapse:       daysDiff(consvDate),
          })
        }
      }

      const byLastUpdate = (a, b) => {
        const da = parseDateLocal(a.last_update), db = parseDateLocal(b.last_update)
        if (!da && !db) return 0
        if (!da) return 1
        if (!db) return -1
        return da - db
      }
      pending.sort(byLastUpdate)
      incomplete.sort(byLastUpdate)
      lapse.sort((a, b) => (a.days_to_lapse ?? 999) - (b.days_to_lapse ?? 999))

      const metrics = {
        submMonth, submWeek, submLW, issMonth,
        newWritersMonth: newWriters.month.size, newWritersWeek: newWriters.week.size, newWritersLW: newWriters.lw.size,
        totalWritersMonth: totalWriters.month.size, totalWritersWeek: totalWriters.week.size, totalWritersLW: totalWriters.lw.size,
        projSubmMonth:       Math.round(submMonth             * projFactor),
        projIssMonth:        Math.round(issMonth              * projFactor),
        projNewWritersMonth: Math.round(newWriters.month.size * projFactor),
        pendingSubmAPV:      pending.reduce((s, r) => s + parseAmt(r.subm_apv), 0),
        openReqSubmAPV:      incomplete.reduce((s, r) => s + parseAmt(r.subm_apv), 0),
        lapseIssuedAPV:      lapse.reduce((s, r) => s + parseAmt(r.issued_apv), 0),
        lapseCount:          lapse.length,
      }

      const detail = {
        submMonthItems:    submMonthItems.sort((a, b) => a.agent.localeCompare(b.agent)),
        issMonthItems:     issMonthItems.sort((a, b) => a.agent.localeCompare(b.agent)),
        totalWritersItems: [...totalWritersItems.values()].sort((a, b) => a.agent.localeCompare(b.agent)),
        newWritersItems:   [...newWritersItems.values()].sort((a, b) => a.agent.localeCompare(b.agent)),
      }

      // PRIVATE only: this payload is scoped to the caller's authorized agents,
      // so it must not be cached at the shared edge. Browser-only short cache.
      res.setHeader('Cache-Control', 'private, max-age=30')
      return res.status(200).json({ pending, incomplete, lapse, metrics, detail })
    } catch (err) {
      console.error('[policies/apps]', err)
      return res.status(500).json({ error: 'Failed to read apps and policies data' })
    }
  }

  // ── GET /api/policies?sfg_ids=X  (list) ───────────────────────────────────
  if (req.method === 'GET') {
    const raw = req.query.sfg_ids ?? req.query.sfg_id ?? ''
    const requestedIds = raw
      ? raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
      : []

    try {
      // Authorize requested ids; with no ids (full list) only super_admin is allowed.
      if (requestedIds.length) {
        if (!(await authorizeScope(req, res, caller, supabase, requestedIds))) return
      } else {
        const allowed = await getAllowedSfgIds(caller, supabase)
        if (allowed !== null) return res.status(403).json({ error: 'Forbidden' })
      }

      // Scope the name lookup to the requested agents instead of scanning the
      // whole personnel table; fall back to all only when no ids are given.
      const upperIds = requestedIds.map(id => id.toUpperCase())
      const peopleQuery = upperIds.length
        ? supabase.from('personnel').select('sfg_id, preferred_name, opt_name').in('sfg_id', upperIds)
        : supabase.from('personnel').select('sfg_id, preferred_name, opt_name')

      const [rows, people] = await Promise.all([
        fetchPolicies(supabase, requestedIds.length ? requestedIds : null),
        peopleQuery.then(r => { if (r.error) throw r.error; return r.data ?? [] }),
      ])

      const personLookup = {}
      for (const p of people) {
        const id = p.sfg_id?.toLowerCase()
        if (id) personLookup[id] = { name: p.preferred_name?.trim() || p.opt_name?.trim() || '' }
      }

      const policies = rows.map(p => {
        const person = personLookup[(p.sfg_id ?? '').trim().toLowerCase()] ?? {}
        return {
          id:                  p.id,
          sfg_id:              p.sfg_id                         ?? '',
          agent:               person.name || '',
          agent_email:         '',
          applicant:           p.applicant                      ?? '',
          carrier:             p.carrier                        ?? '',
          policy_type:         p.policy_name                    ?? '',
          policy_no:           p.policy_number                  ?? '',
          face_amt:            p.face_amount != null ? String(p.face_amount) : '',
          subm_apv:            p.submitted_apv   ?? null,
          issued_apv:          p.issued_apv      ?? null,
          status:              p.status                         ?? '',
          submit_date:         p.submit_date                    ?? '',
          submit_week:         p.submit_week                    ?? '',
          submit_week_num:     p.submit_week_num                ?? '',
          issue_date:          p.issue_date                     ?? '',
          application_notes:   p.application_notes              ?? '',
          policy_notes:        p.policy_notes                   ?? '',
          not_in_opt:          p.not_in_opt        ?? false,
          split_reset:         p.split_reset       ?? false,
          chargeback_exempt:   p.chargeback_exempt ?? null,
          cb_month:            formatCbMonth(p.snapshot_chargeback_month),
          cb_apv:              p.snapshot_chargeback_apv != null ? String(p.snapshot_chargeback_apv) : '',
          conservation_status: p.conservation_status            ?? '',
          conservation_date:   p.conservation_date              ?? '',
          last_update:         p.last_update                    ?? '',
        }
      })

      return res.status(200).json({ policies })
    } catch (err) {
      console.error('[policies]', err)
      return res.status(500).json({ error: 'Failed to read policies data' })
    }
  }

  // ── POST /api/policies  (add single) ──────────────────────────────────────
  if (req.method === 'POST' && !type) {
    const f = req.body ?? {}
    if (!f.sfg_id || !f.applicant) {
      return res.status(400).json({ error: 'sfg_id and applicant are required' })
    }
    if (!(await authorizeScope(req, res, caller, supabase, [String(f.sfg_id).trim().toUpperCase()]))) return
    try {
      const record = {
        sfg_id:            f.sfg_id       ? String(f.sfg_id).trim()      : null,
        applicant:         f.applicant    ? String(f.applicant).trim()   : null,
        carrier:           f.carrier      ? String(f.carrier).trim()     : null,
        policy_name:       f.policy_type  ? String(f.policy_type).trim() : null,
        policy_number:     f.policy_no    ? String(f.policy_no).trim()   : null,
        face_amount:       parseNum(f.face_amt),
        submitted_apv:     parseNum(f.subm_apv),
        issued_apv:        parseNum(f.issued_apv),
        status:            f.status       ? String(f.status).trim()      : null,
        submit_date:       parseDate(f.submit_date),
        submit_week:       parseDate(f.submit_week),
        submit_week_num:   f.submit_week_num ? String(f.submit_week_num).trim() : null,
        issue_date:        parseDate(f.issue_date),
        application_notes: f.app_notes    ? String(f.app_notes).trim()   : null,
        policy_notes:      f.policy_notes ? String(f.policy_notes).trim(): null,
        not_in_opt:        ['x','true','1','yes'].includes(String(f.not_in_opt ?? '').trim().toLowerCase()),
        split_reset:       ['x','true','1','yes'].includes(String(f.split_reset ?? '').trim().toLowerCase()),
        last_update:       parseDate(f.last_update),
      }
      const { error } = await supabase.from('policies').insert(record)
      if (error) throw error
      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('[policies/add]', err)
      return res.status(500).json({ error: 'Failed to add policy' })
    }
  }

  // ── POST /api/policies?type=import  (bulk import, super_admin only) ─────────
  if (req.method === 'POST' && type === 'import') {
    if (!(await requireSuperAdmin(req, res))) return
    const { rows, restores } = req.body ?? {}
    if ((!Array.isArray(rows) || !rows.length) && (!Array.isArray(restores) || !restores.length)) {
      return res.status(400).json({ error: 'No rows provided' })
    }
    try {
      let inserted = 0, skipped = 0, restored = 0
      const errors = []

      // Batched dedup: pull the dedup-key columns for every agent in this import
      // in one query instead of an existence check per row (was N+1). Case-
      // insensitive on applicant/carrier/policy_name to mirror the old ilike.
      const dedupKey = (sfgId, applicant, submitDate, carrier, policyName) => [
        (sfgId ?? '').toUpperCase(),
        (applicant ?? '').trim().toLowerCase(),
        submitDate ?? '',
        (carrier ?? '').trim().toLowerCase(),
        (policyName ?? '').trim().toLowerCase(),
      ].join('||')

      const insertRows = Array.isArray(rows) ? rows : []
      const importIds = [...new Set(insertRows.map(r => r.sfg_id).filter(Boolean).map(id => id.toLowerCase()))]
      const seen = new Set()
      if (importIds.length) {
        const existingRows = await fetchPolicies(supabase, importIds)
        for (const e of existingRows) {
          seen.add(dedupKey(e.sfg_id, e.applicant, e.submit_date, e.carrier, e.policy_name))
        }
      }

      for (const row of insertRows) {
        if (!row.includeAnyway) {
          const key = dedupKey(row.sfg_id, row.applicant, row.submit_date, row.carrier, row.policy_name)
          if (seen.has(key)) { skipped++; continue }
        }
        const record = {
          sfg_id:          row.sfg_id?.toUpperCase() ?? row.sfg_id,
          applicant:       row.applicant,
          carrier:         row.carrier,
          policy_name:     row.policy_name,
          policy_number:   row.policy_number   ?? null,
          face_amount:     row.face_amount      ?? null,
          submitted_apv:   row.submitted_apv    ?? null,
          issued_apv:      row.issued_apv       ?? null,
          status:          null,   // status is never imported from CSV — set manually after review
          submit_date:     row.submit_date      ?? null,
          issue_date:      row.issue_date       ?? null,
          last_update:     row.submit_date      ?? null,   // use submit date so "This Month" filter aligns with submission period
          submit_week:     row.submit_week      ?? null,
          submit_week_num: row.submit_week_num  ?? null,
        }
        const { error } = await supabase.from('policies').insert(record)
        if (error) {
          errors.push({ applicant: row.applicant, agent: row.agentName, error: error.message })
        } else {
          inserted++
          // Track within-batch so later rows dedupe against just-inserted ones
          seen.add(dedupKey(record.sfg_id, record.applicant, record.submit_date, record.carrier, record.policy_name))
        }
      }
      // Handle not_in_opt restores — flip not_in_opt to false and set submitted_apv
      if (Array.isArray(restores) && restores.length) {
        for (const r of restores) {
          if (!r.id) continue
          const patch = { not_in_opt: false }
          if (r.submitted_apv != null) patch.submitted_apv = r.submitted_apv
          const { error } = await supabase.from('policies').update(patch).eq('id', r.id)
          if (error) {
            errors.push({ error: `Restore failed for policy ${r.id}: ${error.message}` })
          } else {
            restored++
          }
        }
      }

      return res.status(200).json({ inserted, skipped, restored, errors })
    } catch (err) {
      console.error('[policies/import]', err)
      return res.status(500).json({ error: 'Failed to import policies' })
    }
  }

  // ── PUT /api/policies  (update fields) ────────────────────────────────────
  if (req.method === 'PUT') {
    const { id, updates } = req.body ?? {}
    if (!id || !updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'Missing or invalid id or updates' })
    }

    // Resolve the policy's owning agent and authorize before mutating.
    {
      const { data: pol } = await supabase.from('policies').select('sfg_id').eq('id', id).maybeSingle()
      if (!pol) return res.status(404).json({ error: 'Policy not found' })
      if (!(await authorizeScope(req, res, caller, supabase, [pol.sfg_id]))) return
    }

    // Whitelist of actual table columns — prevents phantom fields (e.g. derived
    // "agent" name) from reaching Supabase and causing a 400/500.
    const ALLOWED_COLS = new Set([
      'applicant', 'carrier', 'policy_name', 'policy_number',
      'face_amount', 'submitted_apv', 'issued_apv', 'status',
      'submit_date', 'submit_week', 'submit_week_num', 'issue_date', 'last_update',
      'application_notes', 'policy_notes', 'not_in_opt', 'split_reset', 'chargeback_exempt',
      'conservation_status', 'conservation_date',
      'snapshot_chargeback_month', 'snapshot_chargeback_apv',
      'sfg_id',
    ])

    try {
      const coerced = {}
      for (const [col, val] of Object.entries(updates)) {
        if (ALLOWED_COLS.has(col)) coerced[col] = coerce(col, val)
      }
      const { error } = await supabase.from('policies').update(coerced).eq('id', id)
      if (error) throw error
      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('[policies/update]', err)
      return res.status(500).json({ error: 'Failed to update policy' })
    }
  }

  // ── DELETE /api/policies  (delete single policy by id) ───────────────────
  if (req.method === 'DELETE') {
    const { id } = req.body ?? {}
    if (!id) return res.status(400).json({ error: 'Missing policy id' })
    const { data: pol } = await supabase.from('policies').select('sfg_id').eq('id', id).maybeSingle()
    if (!pol) return res.status(404).json({ error: 'Policy not found' })
    if (!(await authorizeScope(req, res, caller, supabase, [pol.sfg_id]))) return
    try {
      const { error } = await supabase.from('policies').delete().eq('id', id)
      if (error) throw error
      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('[policies/delete]', err)
      return res.status(500).json({ error: 'Failed to delete policy' })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
