/**
 * agencyScope.js
 * Baseshop / master-agency scope helpers, shared by the frontend pages and the
 * API routes.
 *
 * Agency owners partition the hierarchy: every agent belongs to exactly one
 * owner's baseshop — their nearest AO ancestor, inclusive. Selecting a set of
 * owners therefore yields a disjoint set of agents, which is what makes a
 * Snapshot cycle's scope safe to reason about (two scopes overlap only if they
 * name a common owner).
 *
 * Owner identity comes from AO milestone months rather than users.role, so it
 * still resolves for owners who have no portal account.
 */

/**
 * Canonical owner test for personnel records carrying a named_milestones map
 * (as assembled by api/personnel.js): at least AO milestone slots 1 and 2.
 *
 * Deliberately not three slots — a slingshot AO qualifies in a single month and
 * records it in both slots, so requiring a third would fail to recognize one.
 * Under-detecting an owner is the dangerous direction: their baseshop would
 * silently fold into their upline's rather than standing on its own.
 */
export function isOwnerRecord(p) {
  const ao = p.named_milestones?.AO ?? []
  return !!(ao[0] && ao[1])
}

/**
 * Owner detection straight from agent_promotions rows, for callers that read
 * personnel without a named_milestones map — every API route except
 * /api/personnel, which is where that map gets assembled.
 *
 * Mirrors isOwnerRecord: same two-slot rule, same slingshot handling.
 * Returns a Set of UPPERCASE sfg_ids.
 */
export function ownerIdsFromPromotions(promoRows) {
  const ids = new Set()
  for (const row of promoRows ?? []) {
    if (!row?.sfg_id) continue
    if (String(row.level ?? '').toUpperCase() !== 'AO') continue
    if (row.promotion_type === 'commission') continue
    const first  = row.is_slingshot
      ? (row.slingshot_month ?? row.month_2 ?? row.month_1)
      : row.month_1
    const second = row.is_slingshot ? first : row.month_2
    if (first && second) ids.add(row.sfg_id.trim().toUpperCase())
  }
  return ids
}

/**
 * The Set of sfg_ids (lowercase) making up an owner's baseshop: their subtree,
 * stopping descent at any sub-owner boundary so a sub-owner's people stay in
 * their own shop rather than rolling up into this one.
 *
 * @param ownerSfgId    root of the baseshop
 * @param allPersonnel  every personnel record (needs sfg_id + upline_sfg_id)
 * @param ownerIds      optional precomputed owner ids (any case) — supply this
 *                      when the records carry no named_milestones, e.g. from
 *                      ownerIdsFromPromotions on the server
 */
export function getBaseshopIds(ownerSfgId, allPersonnel, ownerIds = null) {
  const owners = ownerIds
    ? new Set([...ownerIds].map(id => String(id).toLowerCase()))
    : new Set(allPersonnel.filter(isOwnerRecord).map(p => p.sfg_id.toLowerCase()))

  const childrenOf = {}
  for (const p of allPersonnel) {
    const up = p.upline_sfg_id?.trim().toLowerCase()
    if (!up) continue
    ;(childrenOf[up] ??= []).push(p.sfg_id.toLowerCase())
  }

  const root   = ownerSfgId.toLowerCase()
  const result = new Set()
  function traverse(id) {
    if (result.has(id)) return   // also guards against a cycle in the upline data
    result.add(id)
    for (const child of (childrenOf[id] ?? [])) {
      if (owners.has(child) && child !== root) continue
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
