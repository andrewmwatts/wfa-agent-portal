// Shared helpers for the Leads page: campaign badges, source names, lead-local time,
// and the date/attempt formatting used by the lead list card and the lead card panel.

// ─── Campaign badge ────────────────────────────────────────────────────────────

export const TYPE_CFG = {
  'Life Insurance - Standard': { label: 'STD',  cls: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300'       },
  'Life Insurance - Premium':  { label: 'PREM', cls: 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300' },
  'Mortgage Protection':       { label: 'MP',   cls: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'    },
  'Final Expense':             { label: 'FE',   cls: 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300' },
  'Advanced':                  { label: 'ADV',  cls: 'bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300'        },
  'Recruiting':                { label: 'REC',  cls: 'bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-300' },
}
export function typeCfg(type) { return TYPE_CFG[type] ?? { label: 'LEAD', cls: 'bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-white/60' } }

// ─── Source display map ────────────────────────────────────────────────────────

export const SOURCE_DISPLAY = {
  razor_ridge: 'Razor Ridge',
  lighthouse:  'Lighthouse',
  level_up:    'Level Up',
  reset:       'FIF Reset',
  symmetry:    'Symmetry',
  external:    'External',
  referral:    'Referral',
  other:       'Other',
}
export function fmtSource(src) { return SOURCE_DISPLAY[src] || src || '—' }

// ─── Timezone helpers ──────────────────────────────────────────────────────────

const STATE_TZ = {
  AL:'CT',AK:'AK',AZ:'MT',AR:'CT',CA:'PT',CO:'MT',CT:'ET',DE:'ET',FL:'ET',GA:'ET',
  HI:'HT',ID:'MT',IL:'CT',IN:'ET',IA:'CT',KS:'CT',KY:'ET',LA:'CT',ME:'ET',MD:'ET',
  MA:'ET',MI:'ET',MN:'CT',MS:'CT',MO:'CT',MT:'MT',NE:'CT',NV:'PT',NH:'ET',NJ:'ET',
  NM:'MT',NY:'ET',NC:'ET',ND:'CT',OH:'ET',OK:'CT',OR:'PT',PA:'ET',RI:'ET',SC:'ET',
  SD:'CT',TN:'CT',TX:'CT',UT:'MT',VT:'ET',VA:'ET',WA:'PT',WV:'ET',WI:'CT',WY:'MT',DC:'ET',
}
const TZ_OFFSET = { ET:0, CT:-1, MT:-2, PT:-3, AK:-4, HT:-5 }
const TZ_LABEL  = { ET:'EST', CT:'CST', MT:'MST', PT:'PST', AK:'AKST', HT:'HST' }
const TZ_COLOR  = { ET:'text-blue-600 dark:text-blue-400', CT:'text-amber-600 dark:text-amber-400', MT:'text-orange-600 dark:text-orange-400', PT:'text-green-600 dark:text-green-400', AK:'text-violet-600 dark:text-violet-400', HT:'text-pink-600 dark:text-pink-400' }

export function getLeadTZ(state) {
  const tz = STATE_TZ[state?.toUpperCase()]
  if (!tz) return null
  const off = TZ_OFFSET[tz]
  const now = new Date()
  const estH = parseInt(now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }))
  const lh   = ((estH + off) % 24 + 24) % 24
  const lm   = now.getMinutes()
  const ampm = lh >= 12 ? 'PM' : 'AM'
  const h12  = lh % 12 || 12
  return {
    label:    TZ_LABEL[tz],
    timeStr:  `${h12}:${lm.toString().padStart(2, '0')} ${ampm}`,
    goodTime: lh >= 9 && lh < 20,
    color:    TZ_COLOR[tz],
    offset:   off,
  }
}

// ─── Values ────────────────────────────────────────────────────────────────────

// A field "has a value" unless it is null/undefined/blank. false and 0 are real values.
export function hasValue(v) {
  return !(v === null || v === undefined || (typeof v === 'string' && v.trim() === ''))
}

export function ageFromDob(dob) {
  if (!dob) return null
  const m = String(dob).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const now = new Date()
  let age = now.getFullYear() - +m[1]
  if (now.getMonth() + 1 < +m[2] || (now.getMonth() + 1 === +m[2] && now.getDate() < +m[3])) age--
  return age >= 0 && age < 130 ? age : null
}

// ─── When / attempts ───────────────────────────────────────────────────────────

// "Today 3:42 PM" · "Yesterday 9:05 AM" · "Oct 12, 4:10 PM". Falls back to '' for no value.
export function fmtWhen(value) {
  if (!value) return ''
  const d = new Date(value)
  if (isNaN(d)) return ''
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const startOf = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((startOf(new Date()) - startOf(d)) / 86400000)
  if (days === 0) return `Today ${time}`
  if (days === 1) return `Yesterday ${time}`
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`
}

// Date only, for "status changed" — "Today" / "Yesterday" / "Oct 12" / "Oct 12, 2025"
export function fmtDay(value) {
  if (!value) return ''
  const d = new Date(value)
  if (isNaN(d)) return ''
  const startOf = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((startOf(new Date()) - startOf(d)) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

export function attemptTotals(lead) {
  const calls = lead.call_attempts ?? 0
  const texts = lead.text_attempts ?? 0
  return { calls, texts, total: calls + texts }
}
