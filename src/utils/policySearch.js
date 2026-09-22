/**
 * Matching a policy against a Quick Search query.
 *
 * Someone hunting one policy has either the client's name or the policy number in
 * hand, so both are searched. The number is also compared with its punctuation
 * stripped from both sides: Mutual of Omaha writes "646591-41" and American Amicable
 * pads to "0114676860", and neither is what gets typed or read aloud.
 *
 * Accepts either field name — pages fed by /api/policies carry `policy_no`, while
 * rows straight from the policies table carry `policy_number`.
 */

const squash = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

export function policyNumberOf(policy) {
  return policy?.policy_no ?? policy?.policy_number ?? ''
}

export function matchesPolicy(policy, query) {
  const q = String(query ?? '').trim().toLowerCase()
  if (!q) return false
  if (policy?.applicant?.toLowerCase().includes(q)) return true

  const num = String(policyNumberOf(policy)).toLowerCase()
  if (!num) return false
  if (num.includes(q)) return true

  // Leading zeros are the carrier's, not the agent's: "114676860" finds "0114676860".
  const sq = squash(q)
  return !!sq && squash(num).replace(/^0+/, '').includes(sq.replace(/^0+/, ''))
}
