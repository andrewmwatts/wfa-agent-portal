/**
 * Tracker-side data for reconciling a policy-level Snapshot file.
 *
 * Three overlapping sets are loaded and merged by policy id:
 *   • policies ISSUED in the window            — what the tracker expects Snapshot to show;
 *   • policies with a chargeback LOGGED for the window — the tracker's reversals
 *     (a chargeback usually belongs to a policy issued months earlier);
 *   • policies matching a POLICY NUMBER in the file, whatever their status or date —
 *     so a line the tracker holds as Pending, issued next month, or credited to a
 *     different agent can be explained rather than reported as simply "missing".
 *
 * Split rows are attached to every policy so callers can credit each participant
 * their share (shared/policySplit.js).
 */

import { attachSplits } from '../shared/policySplit.js'
import { policyNumberVariants } from '../shared/snapshotReconcile.js'

export const TRACKER_COLUMNS =
  'id, policy_number, applicant, carrier, status, issue_date, submit_date, issued_apv, split_reset, ' +
  'policy_notes, sfg_id, not_in_opt, snapshot_chargeback_month, snapshot_chargeback_apv, ' +
  'conservation_status, conservation_date'

const PAGE = 1000

async function fetchAll(buildQuery) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return rows
}

/**
 * @param supabase
 * @param {object}   args
 * @param {string[]} args.fileNumbers  policy numbers exactly as they appear in the file
 * @param {{from:string,to:string}} args.window
 * @param {Array}    args.splitRows    every policy_splits row (loadAllSplits)
 * @returns {Promise<Array>} policies with `splits` attached
 */
export async function fetchTrackerPolicies(supabase, { fileNumbers, window, splitRows }) {
  const variants = [...new Set((fileNumbers ?? []).flatMap(policyNumberVariants))]

  const [issued, chargebacks, byNumber] = await Promise.all([
    fetchAll(() => supabase.from('policies').select(TRACKER_COLUMNS)
      .ilike('status', 'issued')
      .gte('issue_date', window.from).lte('issue_date', window.to)
      .order('id')),
    fetchAll(() => supabase.from('policies').select(TRACKER_COLUMNS)
      .not('snapshot_chargeback_month', 'is', null)
      .gte('snapshot_chargeback_month', window.from).lte('snapshot_chargeback_month', window.to)
      .order('id')),
    (async () => {
      const out = []
      const CHUNK = 100   // keep each IN() list well under PostgREST's URL length limit
      for (let i = 0; i < variants.length; i += CHUNK) {
        const { data, error } = await supabase.from('policies').select(TRACKER_COLUMNS)
          .in('policy_number', variants.slice(i, i + CHUNK))
        if (error) throw error
        out.push(...(data ?? []))
      }
      return out
    })(),
  ])

  const byId = new Map()
  for (const p of [...issued, ...chargebacks, ...byNumber]) byId.set(p.id, p)
  return attachSplits([...byId.values()], splitRows)
}
