// Client Qualification Form (CQF) — structure, prefill, and small helpers.
//
// Saved shape (leads.cqf, jsonb):
//   {
//     why: '',
//     client: { first_name, last_name, dob, age, ft, inch, weight, smoker, occupation },
//     spouse: { name, dob, age, ft, inch, weight, smoker, occupation },
//     conditions: { client: { hbp: { on: true, a: ['', '', ''] } }, spouse: { … } },
//     other_conditions: { client: '', spouse: '' },
//     medications: { client: '', spouse: '' },
//     beneficiary_name, beneficiary_relationship, children, children_ages,
//     coverage_wanted, monthly_budget, existing_coverage
//   }
// Carrier prep lives in its own column (leads.carrier_prep):
//   { available: '', options: [{ carrier, product, detail } × 3], notes: '' }

import { ageFromDob, hasValue } from './leadHelpers'

// Tapping a condition opens its follow-up questions (all optional). Edit the wording here.
export const CONDITIONS = [
  { key: 'hbp',      label: 'High Blood Pressure', qs: ['Is it controlled? On which medications?', 'When was it diagnosed?', 'Any hospital stays or complications from it?'] },
  { key: 'heart',    label: 'Heart Attack',        qs: ['When did it happen?', 'Stents, bypass, or other procedures?', 'Current heart meds / last cardiologist visit?'] },
  { key: 'stroke',   label: 'Stroke',              qs: ['When — full stroke or TIA?', 'Any lasting effects?', 'On blood thinners? Last follow-up?'] },
  { key: 'cancer',   label: 'Cancer',              qs: ['What type, and when diagnosed?', 'Treatment finished? When?', 'Any recurrence — last clean scan?'] },
  { key: 'diabetes', label: 'Diabetes',            qs: ['Type 1 or 2? When diagnosed?', 'Insulin or oral meds? Which?', 'Last A1C? Any nerve, kidney, or eye issues?'] },
  { key: 'chol',     label: 'High Cholesterol',    qs: ['On medication? Which?', 'When was it diagnosed?', 'Latest numbers, if they know them?'] },
  { key: 'dui',      label: 'DUI / Substance Abuse', qs: ['What happened, and when?', 'Treatment or recovery program? Completed?', 'Any use or incident in the last 2–5 years?'] },
  { key: 'surgery',  label: 'Surgeries or Diseases', qs: ['What was it, and when?', 'Any complications or ongoing treatment?', 'On meds or restrictions now?'] },
  { key: 'accident', label: 'Accidents (past 10 yrs)', qs: ['What happened, and when?', 'Any lasting injury or disability?', 'Any ongoing treatment or meds?'] },
]

export const RELATIONSHIPS = ['Spouse', 'Son / Daughter', 'Parent', 'Brother / Sister', 'Other relative', 'Friend', 'Other']

export const EMPTY_PREP = { available: '', options: [{}, {}, {}], notes: '' }

function splitName(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first: '', last: '' }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

// What the lead card already knows, used wherever the CQF has no saved answer yet.
export function cqfPrefill(lead) {
  const { first, last } = splitName(lead.name)
  const age = ageFromDob(lead.dob) ?? (hasValue(lead.age) ? Number(lead.age) : '')
  const out = {
    client: {
      first_name: first,
      last_name:  last,
      dob:        lead.dob ?? '',
      age,
      smoker:     lead.smoker === true,
      occupation: lead.employment ?? '',
    },
    spouse: { name: lead.spouse_name ?? '' },
    beneficiary_name: lead.beneficiary ?? '',
    coverage_wanted:  lead.coverage ?? '',
    children:         lead.has_children ?? '',
    children_ages:    lead.children_age_range ?? '',
  }
  return out
}

// Saved answers win over prefill, key by key. '' counts as an answer (a cleared field stays cleared).
export function mergeCqf(prefill, saved) {
  if (saved === undefined || saved === null) return prefill
  if (prefill === undefined) return saved
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v)
  if (isObj(prefill) && isObj(saved)) {
    const out = { ...prefill }
    for (const k of Object.keys(saved)) out[k] = mergeCqf(prefill[k], saved[k])
    return out
  }
  return saved
}

export function setIn(obj, path, value) {
  const [head, ...rest] = path
  const base = typeof head === 'number' ? [...(Array.isArray(obj) ? obj : [])] : { ...(obj ?? {}) }
  base[head] = rest.length ? setIn(obj?.[head], rest, value) : value
  return base
}

export function countConditions(cqf, who = 'client') {
  return Object.values(cqf?.conditions?.[who] ?? {}).filter(c => c?.on).length
}
