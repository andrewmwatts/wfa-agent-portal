/**
 * Commission level utilities — shared between API and frontend.
 *
 * Three independent tracks:
 *   contract   — numeric percentage levels (80–130); an agent progresses upward
 *   leadership — TL → KL → AO; earned through team production
 *   prestige   — TP / EP; display-only, no functional effect
 *
 * Source of truth is the agent_promotions table (is_qualified = true rows).
 */

const CONTRACT_RANK = {
  '80': 1, '85': 2, '90': 3, '95': 4, '100': 5,
  '105': 6, '110': 7, '115': 8, '120': 9, '125': 10, '130': 11,
}

const LEADERSHIP_RANK = { 'TL': 1, 'KL': 2, 'AO': 3 }

const PRESTIGE_LEVELS = new Set(['TP', 'EP'])

/**
 * Returns the highest achieved level on each track for a single agent.
 *
 * @param {Array} agentPromos — agent_promotions rows for one agent (all rows, any is_qualified value)
 * @returns {{
 *   contract:   { level: string, qualified_date: string } | null,
 *   leadership: { level: string, qualified_date: string } | null,
 *   prestige:   string[],
 * }}
 */
export function getCurrentLevel(agentPromos) {
  let contract   = null
  let leadership = null
  const prestige = []

  for (const ap of agentPromos ?? []) {
    if (!ap.is_qualified) continue
    const { level, qualified_date } = ap

    if (CONTRACT_RANK[level] != null) {
      if (!contract || CONTRACT_RANK[level] > CONTRACT_RANK[contract.level]) {
        contract = { level, qualified_date: qualified_date ?? null }
      }
    } else if (LEADERSHIP_RANK[level] != null) {
      if (!leadership || LEADERSHIP_RANK[level] > LEADERSHIP_RANK[leadership.level]) {
        leadership = { level, qualified_date: qualified_date ?? null }
      }
    } else if (PRESTIGE_LEVELS.has(level)) {
      if (!prestige.includes(level)) prestige.push(level)
    }
  }

  return { contract, leadership, prestige }
}

/**
 * Builds a map of sfg_id (uppercased) → getCurrentLevel() result
 * from a flat array of agent_promotions rows across all agents.
 *
 * @param {Array} allPromos — full agent_promotions result set
 * @returns {Record<string, ReturnType<getCurrentLevel>>}
 */
export function buildLevelMap(allPromos) {
  const byAgent = {}
  for (const ap of allPromos ?? []) {
    const id = ap.sfg_id?.toUpperCase()
    if (!id) continue
    ;(byAgent[id] ??= []).push(ap)
  }
  const map = {}
  for (const [id, rows] of Object.entries(byAgent)) {
    map[id] = getCurrentLevel(rows)
  }
  return map
}

/**
 * Returns a short display string for an agent's current levels.
 * e.g. "100% · TL", "85%", "AO", "130% · KL · EP"
 *
 * @param {ReturnType<getCurrentLevel>} levels
 */
export function formatLevels({ contract, leadership, prestige } = {}) {
  const parts = []
  if (contract)         parts.push(`${contract.level}%`)
  if (leadership)       parts.push(leadership.level)
  if (prestige?.length) parts.push(...prestige)
  return parts.join(' · ') || '—'
}

/**
 * Returns the next contract level above the given level string,
 * or null if already at maximum.
 *
 * @param {string | null} currentLevel  e.g. '95'
 */
export function nextContractLevel(currentLevel) {
  const ORDER = Object.keys(CONTRACT_RANK).sort((a, b) => CONTRACT_RANK[a] - CONTRACT_RANK[b])
  if (!currentLevel) return ORDER[0]  // '80'
  const idx = ORDER.indexOf(String(currentLevel))
  return idx === -1 || idx === ORDER.length - 1 ? null : ORDER[idx + 1]
}

/**
 * Returns the next leadership level above the given title, or null if AO.
 *
 * @param {string | null} currentLeadership  e.g. 'TL'
 */
export function nextLeadershipLevel(currentLeadership) {
  const ORDER = ['TL', 'KL', 'AO']
  if (!currentLeadership) return 'TL'
  const idx = ORDER.indexOf(currentLeadership)
  return idx === -1 || idx === ORDER.length - 1 ? null : ORDER[idx + 1]
}
