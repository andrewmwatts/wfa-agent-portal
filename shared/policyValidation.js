/**
 * Cross-field validation shared by every policy edit surface.
 *
 * A policy's `status` and `issue_date` should never disagree: "Issued" is
 * what an issue_date is for, so one implies the other. When they drift apart
 * (usually because a policy gets marked Issued before the date is entered,
 * or an issue_date survives a status correction) the same policy silently
 * counts — or doesn't — in different places depending on which page's
 * fallback logic happens to run into it. See Monthly Metrics vs Dashboard
 * issued-APV drift, August 2026.
 */

/**
 * @param {string | null | undefined} status
 * @param {string | null | undefined} issueDate
 * @returns {string | null} an error message to block save with, or null if consistent
 */
export function validateIssuedDateConsistency(status, issueDate) {
  const isIssued = (status ?? '').trim().toLowerCase() === 'issued'
  const hasDate  = !!(issueDate && String(issueDate).trim())

  if (isIssued && !hasDate) {
    return 'Status is "Issued" but no Issue Date is set. Enter an Issue Date, or change the Status.'
  }
  if (!isIssued && hasDate) {
    const label = status?.trim() ? `"${status.trim()}"` : '(blank)'
    return `Issue Date is set, but Status is ${label} instead of "Issued". Clear the Issue Date, or change the Status to "Issued".`
  }
  return null
}
