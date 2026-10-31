/**
 * recruitingSheetLead.js
 * Turns one row of Quility's "Watts Family Agency.xlsx" recruiting sheet into a
 * `leads` row. Used by api/leads-ingest.js (action upsert_recruiting_lead), which
 * a Power Automate flow calls for every row added to the sheet.
 *
 * Pure function: no Supabase, no Date.now() except the created/updated stamps
 * the caller passes in.
 *
 * The sheet has one row per job posting an applicant applied to, so the same person
 * can appear more than once. The portal keeps one lead per person; the caller skips
 * a row whose phone already belongs to a recruiting lead for the owner.
 */

const STATE_CODES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY',
  louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
  'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
}

const str = v => (v === null || v === undefined ? '' : String(v).trim())

export function phoneDigits(v) {
  const d = str(v).replace(/\D/g, '')
  return d.length === 11 && d[0] === '1' ? d.slice(1) : d
}

export function stateCode(v) {
  const s = str(v)
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase()
  return STATE_CODES[s.toLowerCase()] ?? null
}

// Excel hands dates over as serial numbers unless the flow asks for ISO 8601;
// also accepts '2026-10-28...' and 'M/D/YYYY'.
export function sheetDate(v) {
  const s = str(v)
  if (!s) return null
  if (/^\d+(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000)
    return d.toISOString().slice(0, 10)
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`
  return null
}

const titleCase = n => n.split(/\s+/).map(w => w[0].toUpperCase() + w.slice(1)).join(' ')

/**
 * row keys (all optional strings except name + phone/email):
 *   status, name, phone, email, state, apply_date, requisition, job, licensed, willing,
 *   commission_ok, tier, resume_url, agent_notes
 * `requisition` is the Quility order number (ACRN-...), unique per lead. Appcast's own
 * "req # 1234" is shared by every applicant to a posting, so callers must not send it.
 * Returns the `leads` insert payload, or null when the row has no usable name or contact.
 */
export function buildRecruitingLead(row, ownerSfgId, nowIso) {
  const name = str(row.name)
  const phone = phoneDigits(row.phone)
  const email = str(row.email).toLowerCase()
  if (!name || (!phone && !email)) return null

  const requisition = str(row.requisition)
  const resumeUrl = str(row.resume_url)
  const notes = [
    str(row.job)           && `Applied for: ${str(row.job)}`,
    str(row.licensed)      && `Currently licensed: ${str(row.licensed)}`,
    str(row.willing)       && `Willing to license: ${str(row.willing)}`,
    str(row.commission_ok) && `1099 OK: ${str(row.commission_ok)}`,
    resumeUrl              && `Resume${requisition ? ` (${requisition})` : ''}: ${resumeUrl}`,
    str(row.agent_notes)   && `Sheet note: ${str(row.agent_notes)}`,
  ].filter(Boolean).join('\n')

  const added = sheetDate(row.apply_date) ?? nowIso.slice(0, 10)
  return {
    sfg_id: ownerSfgId,
    category: 'recruiting',
    lead_type: 'recruiting',
    source: 'hq',
    parse_source: 'sharepoint_sheet',
    lead_level: str(row.tier) || null,
    is_stub: false,
    name: titleCase(name),
    phone: phone || null,
    email: email || null,
    state: stateCode(row.state),
    status: /not\s*interested|dead/i.test(str(row.status)) ? 'dead' : 'new',
    added,
    vendor_lead_id: requisition || null,
    notes: notes || null,
    created_at: nowIso,
    updated_at: nowIso,
  }
}
