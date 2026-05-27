import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

const POLICY_COLS = [
  'id', 'sfg_id', 'applicant', 'carrier', 'policy_name', 'policy_number',
  'face_amount', 'submitted_apv', 'issued_apv', 'status',
  'submit_date', 'submit_week', 'submit_week_num', 'issue_date', 'last_update',
  'application_notes', 'conservation_status', 'conservation_date',
  'snapshot_chargeback_month', 'snapshot_chargeback_apv',
].join(', ')

// Paginated fetch with optional sfg_id filter — never transfers rows we don't need
async function fetchPolicies(supabase, sfgIds) {
  const PAGE = 1000
  const results = []
  let from = 0
  while (true) {
    let q = supabase.from('policies').select(POLICY_COLS).order('id')
    if (sfgIds?.length) q = q.in('sfg_id', sfgIds.map(id => id.toUpperCase()))
    const { data, error } = await q.range(from, from + PAGE - 1)
    if (error) throw error
    results.push(...(data ?? []))
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return results
}

// Paginated fetch for any table (kept for personnel)
async function fetchAll(supabase, table, columns) {
  const PAGE = 1000
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

// Only these conservation statuses appear in the pending lapse table
const LAPSE_CONSV_STATUSES = new Set(['lapse pending', 'first premium not paid'])

function parseDate(str) {
  if (!str) return null
  // Parse YYYY-MM-DD as local midnight to avoid UTC→local day shift
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
  const d = parseDate(dateStr)
  if (!d) return null
  return Math.round((d - Date.now()) / 86400000)
}

// Returns true if the date string falls within [start, end)
function inPeriod(dateStr, start, end) {
  const d = parseDate(dateStr)
  if (!d) return false
  return d >= start && (!end || d < end)
}

// Format stored "YYYY-MM-01" chargeback month back to "Month YYYY"
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

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const raw = req.query.sfg_ids ?? req.query.sfg_id ?? ''
  const requestedIds = raw
    ? raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    : []

  try {
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    const [allRows, people] = await Promise.all([
      fetchPolicies(supabase, requestedIds.length ? requestedIds : null),
      fetchAll(supabase, 'personnel', 'sfg_id, preferred_name, opt_name'),
    ])

    if (!allRows.length) return res.status(200).json({ pending: [], incomplete: [], lapse: [], metrics: null })

    // Build sfg_id → { name, email } lookup from live personnel data
    const personLookup = {}
    for (const p of people) {
      const id = p.sfg_id?.toLowerCase()
      if (id) personLookup[id] = {
        name: p.preferred_name?.trim() || p.opt_name?.trim() || '',
      }
    }

    // Compute earliest submit per agent to identify new writers dynamically
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

    // Projection factor: extrapolate current MTD to end of month
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const daysElapsed = Math.max(now.getDate(), 1)
    const projFactor  = daysInMonth / daysElapsed

    const pending    = []
    const incomplete = []
    const lapse      = []

    // ── Metric accumulators ──────────────────────────────────────────────────
    let submMonth = 0, submWeek = 0, submLW = 0
    let issMonth  = 0

    const totalWriters = { month: new Set(), week: new Set(), lw: new Set() }
    const newWriters   = { month: new Set(), week: new Set(), lw: new Set() }

    // Detail lists for drill-down (current month only)
    const submMonthItems    = []
    const totalWritersItems = new Map()  // sfgLower → {sfg_id, agent}
    const newWritersItems   = new Map()

    for (const p of allRows) {
      const sfgId = p.sfg_id?.trim()
      if (!sfgId) continue

      const sfgLower    = sfgId.toLowerCase()
      const status      = (p.status ?? '').trim()
      const issueDate   = p.issue_date         ?? ''
      const submitDate  = p.submit_date        ?? ''
      const submitWeek  = p.submit_week        ?? ''
      const consvStatus = (p.conservation_status ?? '').trim()
      const submApv     = parseAmt(p.submitted_apv)
      const issApv      = parseAmt(p.issued_apv)
      const person      = personLookup[sfgLower] ?? {}
      const agentName   = person.name || ''
      const agentEmail  = ''
      // New writer = this agent's earliest-ever submission falls within the period being checked
      const earliest    = earliestSubmit[sfgLower]

      const submitKey = submitWeek   // submit_week is the only metric reference date

      const base = {
        id:          p.id,
        sfg_id:      sfgId,
        agent:       agentName,
        agent_email: agentEmail,
        applicant:   (p.applicant   ?? '').trim(),
        carrier:     (p.carrier     ?? '').trim(),
        policy:      (p.policy_name ?? '').trim(),
        policy_no:   (p.policy_number ?? '').trim(),
        face_amt:    p.face_amount != null ? String(p.face_amount) : '',
        issued_apv:  p.issued_apv  != null ? String(p.issued_apv)  : '',
        subm_apv:    p.submitted_apv != null ? String(p.submitted_apv) : '',
        last_update: p.last_update ?? '',
      }

      // ── Writers — any row that falls in the period counts, regardless of APV ─
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

      // ── Submitted APV — only accumulate when APV is present ─────────────
      if (submApv > 0) {
        if (inPeriod(submitKey, monthStart, monthEnd)) {
          submMonth += submApv
          submMonthItems.push({
            sfg_id:      sfgId,
            agent:       agentName,
            applicant:   (p.applicant ?? '').trim(),
            carrier:     (p.carrier   ?? '').trim(),
            subm_apv:    String(p.submitted_apv),
            submit_week: submitWeek,
            submit_date: submitDate,
          })
        }
        if (inPeriod(submitKey, weekStart))           submWeek += submApv
        if (inPeriod(submitKey, lwStart, weekStart))  submLW   += submApv
      }

      // ── Issued APV — keyed on Issue Date, monthly only ──────────────────
      if (issApv > 0 && inPeriod(issueDate, monthStart, monthEnd)) {
        issMonth += issApv
      }

      // ── Pending application (Pending, Incomplete, or no status yet) ────────
      const statusLower = status.toLowerCase()
      if (!status || statusLower === 'pending') {
        pending.push({
          ...base,
          status,
          submit_date: submitDate,
          open_req:    (p.application_notes ?? '').trim(),
        })
      }

      // ── Incomplete application ───────────────────────────────────────────
      if (statusLower === 'incomplete') {
        incomplete.push({
          ...base,
          status,
          submit_date: submitDate,
          open_req:    (p.application_notes ?? '').trim(),
        })
      }

      // ── Pending lapse ────────────────────────────────────────────────────
      if (LAPSE_CONSV_STATUSES.has(consvStatus.toLowerCase())) {
        const consvDate = p.conservation_date ?? ''
        lapse.push({
          ...base,
          policy_type:         (p.policy_name  ?? '').trim(),
          policy_no:           (p.policy_number ?? '').trim(),
          issue_date:          issueDate,
          face_amt:            p.face_amount != null ? String(p.face_amount) : '',
          issued_apv:          p.issued_apv   != null ? String(p.issued_apv)  : '',
          cb_month:            formatCbMonth(p.snapshot_chargeback_month),
          cb_apv:              p.snapshot_chargeback_apv != null ? String(p.snapshot_chargeback_apv) : '',
          conservation_status: consvStatus,
          conservation_date:   consvDate,
          days_to_lapse:       daysDiff(consvDate),
        })
      }
    }

    // Sort: oldest last_update first
    const byLastUpdate = (a, b) => {
      const da = parseDate(a.last_update)
      const db = parseDate(b.last_update)
      if (!da && !db) return 0
      if (!da) return 1
      if (!db) return -1
      return da - db
    }
    pending.sort(byLastUpdate)
    incomplete.sort(byLastUpdate)
    lapse.sort((a, b) => (a.days_to_lapse ?? 999) - (b.days_to_lapse ?? 999))

    const pendingSubmAPV = pending.reduce((s, r) => s + parseAmt(r.subm_apv), 0)
    const openReqSubmAPV = incomplete.reduce((s, r) => s + parseAmt(r.subm_apv), 0)
    const lapseIssuedAPV = lapse.reduce((s, r) => s + parseAmt(r.issued_apv), 0)
    const lapseCount     = lapse.length

    const metrics = {
      submMonth, submWeek, submLW,
      issMonth,
      newWritersMonth: newWriters.month.size,
      newWritersWeek:  newWriters.week.size,
      newWritersLW:    newWriters.lw.size,
      totalWritersMonth: totalWriters.month.size,
      totalWritersWeek:  totalWriters.week.size,
      totalWritersLW:    totalWriters.lw.size,
      // Projections (month-end extrapolation)
      projSubmMonth:       Math.round(submMonth             * projFactor),
      projIssMonth:        Math.round(issMonth              * projFactor),
      projNewWritersMonth: Math.round(newWriters.month.size * projFactor),
      // Business counts / APV
      pendingSubmAPV,
      openReqSubmAPV,
      lapseIssuedAPV,
      lapseCount,
    }

    const detail = {
      submMonthItems:    submMonthItems.sort((a, b) => a.agent.localeCompare(b.agent)),
      totalWritersItems: [...totalWritersItems.values()].sort((a, b) => a.agent.localeCompare(b.agent)),
      newWritersItems:   [...newWritersItems.values()].sort((a, b) => a.agent.localeCompare(b.agent)),
    }

    return res.status(200).json({ pending, incomplete, lapse, metrics, detail })
  } catch (err) {
    console.error('[apps-policies]', err)
    return res.status(500).json({ error: 'Failed to read apps and policies data' })
  }
}
