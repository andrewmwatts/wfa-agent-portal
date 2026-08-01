/**
 * "What day is it right now" utilities, pinned to a fixed reference timezone
 * rather than the process's own timezone.
 *
 * Vercel serverless functions run with the system clock set to UTC, so a bare
 * `new Date()` on the server reads as several hours ahead of any US timezone —
 * e.g. "this month" was flipping over to the 1st around 5-7pm local time on
 * the last day of the month, well before local midnight.
 *
 * These metrics are shared across agents in different timezones, so there's
 * no single "the user's" local time to key off of — and doing so per-viewer
 * would mean the same data reads as a different month for different people
 * looking at the same dashboard at the same moment. Instead this is pinned to
 * Hawaii-Aleutian time (UTC-10, no DST): the latest US timezone, so its
 * midnight lands in the 2-6am range for every other US timezone. In practice
 * the calendar day always matches what people perceive as "today" by the
 * time anyone's actually looking at the dashboard.
 */

const BUSINESS_TZ = 'Pacific/Honolulu'

/**
 * Returns { year, month, day } for "today" in the business's timezone.
 * `month` is 0-indexed to match Date.getMonth().
 */
export function todayInBusinessTZ() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const get = t => Number(parts.find(p => p.type === t).value)
  return { year: get('year'), month: get('month') - 1, day: get('day') }
}

/**
 * A local Date object (midnight, process-timezone constructor) representing
 * "today" in the business's timezone. Safe to use with plain Y/M/D date math
 * (setDate, getDay, etc.) and to compare against dates parsed the same way
 * (`new Date(year, month, day)`), since both sides of the comparison end up
 * constructed in the same (arbitrary) process timezone.
 */
export function nowInBusinessTZ() {
  const { year, month, day } = todayInBusinessTZ()
  return new Date(year, month, day)
}
