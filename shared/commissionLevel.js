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
 * Latest business month ('YYYY-MM') a promotion counted toward — the max of its
 * qualifying-month markers, falling back to qualified_date, else null (an
 * undated/backfilled row whose timing predates tracking).
 *
 * @param {object} ap — one agent_promotions row
 */
export function promoCompletionMonth(ap) {
  const months = [ap.month_1, ap.month_2, ap.month_3, ap.slingshot_month]
    .filter(Boolean)
    .map(m => String(m).slice(0, 7))
  if (months.length) return months.reduce((a, b) => (a > b ? a : b))
  if (ap.qualified_date) return String(ap.qualified_date).slice(0, 7)
  return null
}

/**
 * Point-in-time levels: the highest contract & leadership levels an agent HELD
 * during business month `monthStr` ('YYYY-MM'). A promotion counts only once it
 * had already completed — its final qualifying month is strictly before
 * `monthStr`. A promotion whose final qualifying month IS `monthStr` is still in
 * progress that month (the agent was targeting it, not yet holding it), so it is
 * excluded. Undated rows (no month markers, no qualified_date) are treated as
 * held since before tracking began.
 *
 * @param {Array}  agentPromos — agent_promotions rows for one agent
 * @param {string} monthStr    — 'YYYY-MM'
 * @returns {{ contract: {level: string}|null, leadership: {level: string}|null }}
 */
export function levelAsOfMonth(agentPromos, monthStr) {
  let contract   = null
  let leadership = null
  for (const ap of agentPromos ?? []) {
    if (!ap.is_qualified) continue
    const done = promoCompletionMonth(ap)
    if (done && done >= monthStr) continue   // completed in/after this month → not yet held
    const { level } = ap
    if (CONTRACT_RANK[level] != null) {
      if (!contract || CONTRACT_RANK[level] > CONTRACT_RANK[contract.level]) contract = { level }
    } else if (LEADERSHIP_RANK[level] != null) {
      if (!leadership || LEADERSHIP_RANK[level] > LEADERSHIP_RANK[leadership.level]) leadership = { level }
    }
  }
  return { contract, leadership }
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
 * Returns the contract level immediately below the given level string,
 * or null if already at the minimum (or the level is unrecognized).
 *
 * @param {string | null} currentLevel  e.g. '95'
 */
export function previousContractLevel(currentLevel) {
  const ORDER = Object.keys(CONTRACT_RANK).sort((a, b) => CONTRACT_RANK[a] - CONTRACT_RANK[b])
  if (!currentLevel) return null
  const idx = ORDER.indexOf(String(currentLevel))
  return idx <= 0 ? null : ORDER[idx - 1]
}

/**
 * Numeric rank for a contract level string (higher = more senior), or null
 * if the value isn't a recognized contract level (e.g. a leadership title).
 *
 * @param {string | null} level
 */
export function contractLevelRank(level) {
  return CONTRACT_RANK[String(level)] ?? null
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
