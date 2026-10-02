// Chargeback-exempt auto-compute — imported by BOTH the React app (PolicyEditModal) and
// Node scripts (scripts/conservation-check). Keep this file dependency-free apart from
// other shared/ modules (no React, no Node-only APIs) so both can include it.
import { normalizeCarrier } from './carriers.js'

const CB_RULE_CARRIERS = new Set(['americo', 'banner', 'fidelity and guaranty', 'sbli'])

const CB_SNAPSHOT_STATUSES = new Set([
  'declined, on snapshot', 'not taken, on snapshot', 'withdrawn, on snapshot',
])

function monthsBetween(fromIso, toIso) {
  if (!fromIso || !toIso) return null
  const fm = String(fromIso).match(/^(\d{4})-(\d{2})/)
  const tm = String(toIso).match(/^(\d{4})-(\d{2})/)
  if (!fm || !tm) return null
  return (parseInt(tm[1]) - parseInt(fm[1])) * 12 + (parseInt(tm[2]) - parseInt(fm[2]))
}

export function computeChargebackExempt(conservation_status, conservation_date, issue_date, carrier) {
  if (!conservation_status?.trim()) return null
  const status  = conservation_status.trim().toLowerCase()
  const normCar = (normalizeCarrier(carrier ?? '') ?? '').toLowerCase()
  const inRuleSet = CB_RULE_CARRIERS.has(normCar)

  if (CB_SNAPSHOT_STATUSES.has(status)) return false

  if (inRuleSet) {
    if (status === 'cancelled') {
      const mo = monthsBetween(issue_date, conservation_date)
      if (mo !== null && mo < 12) return false
    }
    if (status === 'lapsed' || status === 'lapse pending') {
      const mo = monthsBetween(issue_date, conservation_date)
      if (mo !== null && mo < 14) return false
    }
  }

  return true
}
