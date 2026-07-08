/**
 * One-time backfill: compute submit_week and submit_week_num for policies
 * where submit_week IS NULL but submit_date IS NOT NULL.
 *
 * Logic mirrors BulkImportModal.jsx exactly:
 *   submit_week     = next Friday on or after submit_date
 *   submit_week_num = which Friday of that month (1–5)
 *
 * Usage:
 *   VITE_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-submit-week.mjs
 *   Add --dry-run to preview without writing.
 */

import { createClient } from '@supabase/supabase-js'

const DRY_RUN = process.argv.includes('--dry-run')

const supabaseUrl = process.env.VITE_SUPABASE_URL
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceKey)

function calcSubmitWeek(submitDateISO) {
  const [y, m, d] = submitDateISO.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const dow = date.getDay()                          // 0=Sun … 5=Fri … 6=Sat
  const daysAhead = dow === 5 ? 0 : ((5 - dow + 7) % 7 || 7)
  date.setDate(date.getDate() + daysAhead)
  const yr  = date.getFullYear()
  const mo  = String(date.getMonth() + 1).padStart(2, '0')
  const dy  = String(date.getDate()).padStart(2, '0')
  return `${yr}-${mo}-${dy}`
}

function calcSubmitWeekNum(submitWeekISO) {
  const [y, m, d] = submitWeekISO.split('-').map(Number)
  const friday = new Date(y, m - 1, d)
  const firstOfMonth = new Date(y, m - 1, 1)
  let firstFriday = new Date(firstOfMonth)
  while (firstFriday.getDay() !== 5) firstFriday.setDate(firstFriday.getDate() + 1)
  let count  = 0
  let cursor = new Date(firstFriday)
  while (cursor <= friday) {
    count++
    cursor.setDate(cursor.getDate() + 7)
  }
  return count || null
}

async function run() {
  console.log(DRY_RUN ? '[DRY RUN — no writes]\n' : '')

  // Fetch all policies missing submit_week but having a submit_date
  let allRows = []
  let from = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await supabase
      .from('policies')
      .select('id, submit_date, submit_week')
      .is('submit_week', null)
      .not('submit_date', 'is', null)
      .range(from, from + PAGE - 1)
    if (error) { console.error('Fetch error:', error.message); process.exit(1) }
    if (!data?.length) break
    allRows = allRows.concat(data)
    if (data.length < PAGE) break
    from += PAGE
  }

  console.log(`Found ${allRows.length} policies with null submit_week and a submit_date.\n`)
  if (!allRows.length) { console.log('Nothing to do.'); return }

  let updated = 0, failed = 0
  for (const row of allRows) {
    const submitWeek    = calcSubmitWeek(row.submit_date)
    const submitWeekNum = calcSubmitWeekNum(submitWeek)
    console.log(`  ${row.id}  submit_date=${row.submit_date}  →  submit_week=${submitWeek}  (week ${submitWeekNum})`)
    if (DRY_RUN) continue

    const { error } = await supabase
      .from('policies')
      .update({ submit_week: submitWeek, submit_week_num: submitWeekNum })
      .eq('id', row.id)

    if (error) {
      console.error(`  ERROR updating ${row.id}:`, error.message)
      failed++
    } else {
      updated++
    }
  }

  if (!DRY_RUN) {
    console.log(`\nDone. Updated: ${updated}  Failed: ${failed}`)
  } else {
    console.log(`\n[Dry run complete — run without --dry-run to apply]`)
  }
}

run()
