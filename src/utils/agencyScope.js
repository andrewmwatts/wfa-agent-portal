/**
 * agencyScope.js
 * Shared helpers for master/baseshop scope filtering used across multiple pages.
 *
 * isOwnerRecord — canonical definition: person has at least AO milestone slots 1 and 2 filled.
 * getBaseshopIds — returns the Set of sfg_ids (lowercase) that belong to a given owner's
 *   baseshop, stopping descent at any sub-owner boundary.
 * buildOwnersList — returns [self?, ...sortedSubOwners] for the scope dropdown.
 */

export function isOwnerRecord(p) {
  const ao = p.named_milestones?.AO ?? []
  return !!(ao[0] && ao[1] && ao[2])
}

export function getBaseshopIds(ownerSfgId, allPersonnel) {
  const ownerIds   = new Set(allPersonnel.filter(isOwnerRecord).map(p => p.sfg_id.toLowerCase()))
  const childrenOf = {}
  for (const p of allPersonnel) {
    const up = p.upline_sfg_id?.trim().toLowerCase()
    if (!up) continue
    ;(childrenOf[up] ??= []).push(p.sfg_id.toLowerCase())
  }
  const root   = ownerSfgId.toLowerCase()
  const result = new Set()
  function traverse(id) {
    result.add(id)
    for (const child of (childrenOf[id] ?? [])) {
      if (ownerIds.has(child) && child !== root) continue
      traverse(child)
    }
  }
  traverse(root)
  return result
}

/**
 * Build the ordered list of owners for the scope dropdown.
 * The viewer (selfId) is always first so they can quickly select their own baseshop.
 * Sub-owners follow in alphabetical order.
 */
export function buildOwnersList(masterPersonnel, selfId) {
  const normSelf = selfId?.toLowerCase()
  const self      = masterPersonnel.find(p => p.sfg_id?.toLowerCase() === normSelf)
  const subOwners = masterPersonnel
    .filter(p => p.sfg_id?.toLowerCase() !== normSelf && isOwnerRecord(p))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  return self ? [self, ...subOwners] : subOwners
}
