// Guarded conservation write helper for runs (FRAMEWORK §1, §7).
//   import { applier } from './scripts/conservation-check/lib/apply.mjs'
//   const { set, log, save } = applier(['Banner','LGA'], '# Banner')
//   await set(num, fromStatusOrNull, newStatusOrNull, isoDateOrNull, why, cbxOverride?)
//   save(reportPath)  // appends the carrier section to the run report
// Writes only when the row is Issued and its current conservation_status equals `from`.
// Must run from the repo root.
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import fs from 'fs'
import { computeChargebackExempt } from '../../../shared/chargebackExempt.js'

config({ path: '.vercel/.env.development.local', quiet: true })
config({ path: '.env.local', quiet: true })
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

export function applier(carriers, header) {
  const log = ['', header]
  async function set(n, from, cs, cd, why, cbxOverride) {
    const { data: r, error: e1 } = await sb.from('policies')
      .select('id, issue_date, carrier, conservation_status, conservation_date')
      .in('carrier', carriers).eq('policy_number', n).eq('status', 'Issued')
    if (e1 || r.length !== 1 || (r[0].conservation_status || null) !== from) {
      log.push(`${n}: SKIP (state changed or not unique) ${e1 ? e1.message : JSON.stringify(r)}`); return
    }
    const upd = cs
      ? { conservation_status: cs, conservation_date: cd, chargeback_exempt: cbxOverride ?? computeChargebackExempt(cs, cd, r[0].issue_date, r[0].carrier) }
      : { conservation_status: null, conservation_date: null }
    let q = sb.from('policies').update(upd).eq('id', r[0].id)
    q = from ? q.eq('conservation_status', from) : q.is('conservation_status', null)
    const { error } = await q
    log.push(`${n}: ${from || 'NULL'} ${r[0].conservation_date || ''} -> ${cs || 'NULL'} ${cd || ''}` +
      `${upd.chargeback_exempt !== undefined ? ' cbx=' + upd.chargeback_exempt : ''} | ${why} ${error ? 'ERROR ' + error.message : 'OK'}`)
  }
  return {
    set, log,
    save(path) { console.log(log.join('\n')); fs.appendFileSync(path, log.join('\n') + '\n') },
  }
}

export function markChecked(carrier, date) {
  const f = 'scripts/conservation-check/state/last-checked.json'
  const j = JSON.parse(fs.readFileSync(f, 'utf8')); j[carrier] = date
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n')
}
