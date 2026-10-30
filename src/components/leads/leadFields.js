// Field definitions for the lead card. Each section is rendered twice from the same
// list: read-only on the card (only fields that have a value) and, on the "Edit lead data"
// screen, as inputs for every field. `kind` picks the input; `span: 2` makes the field full width.
// Sections carry no colors of their own — the panel styles them from the agency palette.

import { SOURCE_DISPLAY } from './leadHelpers'
import { fmtPhone } from '../../utils/format'

const YES_NO  = ['Yes', 'No']
const MARITAL = ['Single', 'Married', 'Divorced', 'Widowed', 'Separated']
const GENDER  = ['Male', 'Female', 'Other']
const CAMPAIGNS = ['Life Insurance - Standard', 'Life Insurance - Premium', 'Mortgage Protection', 'Final Expense', 'Advanced']

export const LEAD_SECTIONS = [
  {
    key: 'contact', title: 'Contact',
    fields: [
      { key: 'phone',       label: 'Phone',  kind: 'tel',   link: 'tel', display: v => fmtPhone(v) },
      { key: 'email',       label: 'Email',  kind: 'email', link: 'mailto', span: 2 },
      { key: 'spouse_name', label: 'Spouse', kind: 'text' },
      { key: 'city',        label: 'City',   kind: 'text' },
      { key: 'county',      label: 'County', kind: 'text' },
      { key: 'state',       label: 'State',  kind: 'state' },
      { key: 'zip',         label: 'ZIP',    kind: 'text' },
    ],
  },
  {
    key: 'details', title: 'Lead Details',
    fields: [
      { key: 'gender',         label: 'Gender',         kind: 'select', options: GENDER.map(v => ({ value: v, label: v })) },
      { key: 'age',            label: 'Age',            kind: 'int' },
      { key: 'dob',            label: 'Date of Birth',  kind: 'date' },
      { key: 'marital_status', label: 'Marital Status', kind: 'select', options: MARITAL.map(v => ({ value: v, label: v })) },
      { key: 'coverage',       label: 'Coverage',       kind: 'text' },
      { key: 'beneficiary',    label: 'Beneficiary',    kind: 'text' },
      { key: 'employment',     label: 'Employment',     kind: 'text' },
      { key: 'income',         label: 'Income',         kind: 'text' },
      { key: 'motivation',     label: 'Motivation',     kind: 'text', span: 2 },
      { key: 'hobby',          label: 'Hobby / Security Word', kind: 'text', span: 2 },
    ],
    flags: [
      { key: 'smoker',  label: 'Smoker',             icon: '🚬' },
      { key: 'medical', label: 'Major Med History',  icon: '⚠️', tone: 'warn' },
    ],
  },
  {
    key: 'source', title: 'Lead Source',
    fields: [
      { key: 'source',        label: 'Source',   kind: 'select', options: Object.entries(SOURCE_DISPLAY).map(([value, label]) => ({ value, label })), display: v => SOURCE_DISPLAY[v] || v },
      { key: 'lead_type',     label: 'Campaign', kind: 'select', options: CAMPAIGNS.map(v => ({ value: v, label: v })) },
      { key: 'lead_level',    label: 'Lead Level', kind: 'text' },
      { key: 'assigned_date', label: 'Assigned', kind: 'date' },
      { key: 'added',         label: 'Added',    kind: 'date', readOnly: true },
    ],
  },
  {
    key: 'household', title: 'Household',
    fields: [
      { key: 'household_size',      label: 'Household Size',      kind: 'text' },
      { key: 'has_children',        label: 'Has Children',        kind: 'select', options: YES_NO.map(v => ({ value: v, label: v })) },
      { key: 'children_age_range',  label: 'Children Age Range',  kind: 'text' },
      { key: 'homeowner',           label: 'Homeowner',           kind: 'select', options: YES_NO.map(v => ({ value: v, label: v })) },
      { key: 'length_of_residence', label: 'Length of Residence', kind: 'text' },
    ],
  },
]

// ─── Recruiting leads ──────────────────────────────────────────────────────────
// Recruiting is a data manager for conversations rather than a dialer, so its card is smaller:
// who they are, how to reach them, where they came from and when the interview is.

export const REC_SOURCES = [
  { key: 'calendly',   label: 'Calendly'   },
  { key: 'stan_store', label: 'Stan Store' },
  { key: 'referral',   label: 'Referral'   },
  { key: 'hq',         label: 'HQ'         },
  { key: 'other',      label: 'Other'      },
]
export const recSourceLabel = v => REC_SOURCES.find(s => s.key === v)?.label ?? SOURCE_DISPLAY[v] ?? v

export const REC_SECTIONS = [
  {
    key: 'contact', title: 'Contact',
    fields: [
      { key: 'phone',          label: 'Phone',          kind: 'tel',   link: 'tel', display: v => fmtPhone(v) },
      { key: 'email',          label: 'Email',          kind: 'email', link: 'mailto', span: 2 },
      { key: 'preferred_name', label: 'Preferred name', kind: 'text' },
      { key: 'spouse_name',    label: 'Spouse',         kind: 'text' },
      { key: 'city',           label: 'City',           kind: 'text' },
      { key: 'county',         label: 'County',         kind: 'text' },
      { key: 'state',          label: 'State',          kind: 'state' },
      { key: 'zip',            label: 'ZIP',            kind: 'text' },
    ],
  },
  {
    key: 'recruiting', title: 'Recruiting',
    fields: [
      { key: 'source',        label: 'Source',         kind: 'select', options: REC_SOURCES.map(s => ({ value: s.key, label: s.label })), display: recSourceLabel },
      { key: 'assigned_date', label: 'Interview date', kind: 'date' },
      { key: 'added',         label: 'Added',          kind: 'date', readOnly: true },
    ],
  },
]
