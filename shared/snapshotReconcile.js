/**
 * Snapshot reconciliation for policy-level exports ("Placed Policies").
 *
 * Two jobs, both pure so the API and any test harness can run them on plain data:
 *
 *  1. resolveFileAgents — turn the file's agent names into sfg_ids. The names are
 *     NOT in a fixed format (nicknames, dropped middle names, double and hyphenated
 *     surnames) so they cannot be parsed mechanically. The POLICY NUMBERS are the
 *     strongest evidence: a row whose number belongs to a tracker policy credited
 *     to agent X says who wrote it. Name similarity is scored against BOTH the Opt
 *     name and the preferred name, and the two signals are combined. Client names
 *     are irregular ("S  CUMMINGS", "A  S CHARLES", "ZEAH") so they are only used to
 *     discriminate and to amplify a note — never to decide who an agent is.
 *
 *  2. adjudicateBuckets — compare the file to the tracker per agent + carrier, and
 *     explain any difference at the POLICY level: which policy, and why (not issued
 *     in the tracker, issue date outside the window, credited to someone else, APV
 *     differs, chargeback not logged, split not recorded, …).
 *
 * What the tracker figure means depends on where the ledger is in the workflow:
 *
 *   draft (Step 1)  — "issued in the window". Chargebacks are treated as NOT yet
 *                     logged, so every Reversal line is flagged "Log chargeback"
 *                     and names the policy it belongs to. Logging them is one of
 *                     the edits this pass exists to prompt.
 *   final (Step 3)  — "issued in the window, minus chargebacks logged for the
 *                     window" — the same definition Promotions and Monthly Agent
 *                     Totals use — so a logged chargeback ties out to its Reversal
 *                     line and anything left over is genuinely unaligned.
 */

import { participants, creditedAmount } from './policySplit.js'
import { normalizeCarrier } from './carriers.js'
import { normalizeSnapshotCarrier } from './snapshotFile.js'

const normId = id => String(id ?? '').trim().toUpperCase()

// ── Policy numbers & carriers ────────────────────────────────────────────────

/**
 * Comparison key for a policy number: upper-case alphanumerics with leading zeros
 * removed. The export drops leading zeros ("114676860" for the tracker's
 * "0114676860"), and a bare "0" is how it says "no policy number". '' = none.
 */
export function normalizePolicyNumber(raw) {
  const s = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '')
  return /\d/.test(s) ? s : ''
}

/**
 * Spellings of a file policy number to look for in the tracker, which stores the
 * zero-padded form for some carriers. Numbers that can't travel safely in a
 * PostgREST IN() list are skipped (they simply won't be found by number).
 */
export function policyNumberVariants(raw) {
  const s = String(raw ?? '').trim().toUpperCase()
  if (!normalizePolicyNumber(s) || /[,()"']/.test(s)) return []
  const out = new Set([s])
  const stripped = s.replace(/^0+/, '')
  if (stripped) out.add(stripped)
  if (/^\d/.test(stripped)) { out.add('0' + stripped); out.add('00' + stripped) }
  return [...out]
}

/** One key per carrier no matter how a report or the tracker spells it. */
export function bucketCarrier(raw) {
  return normalizeCarrier(normalizeSnapshotCarrier(raw ?? '')) || ''
}

// ── Name similarity ──────────────────────────────────────────────────────────

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv'])

function words(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
    .filter(w => w && !SUFFIXES.has(w))
}

function lev(a, b) {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > 2) return 3
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const up = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = up
    }
  }
  return row[b.length]
}

// Only the nicknames that aren't a prefix of the formal name ("Josh"/"Joshua" and
// "Chris"/"Christopher" are caught by the prefix rule). The roster's preferred
// names already carry most nicknames, so this is a best-effort aid.
const NICKNAME_GROUPS = [
  ['robert', 'bob', 'rob', 'bobby'], ['william', 'bill', 'will', 'billy'],
  ['richard', 'rick', 'rich', 'dick'], ['james', 'jim', 'jimmy', 'jamie'],
  ['john', 'jack', 'johnny'], ['michael', 'mike', 'mikey'], ['thomas', 'tom', 'tommy'],
  ['anthony', 'tony'], ['elizabeth', 'liz', 'beth', 'betty', 'lizzy'],
  ['katherine', 'kathryn', 'catherine', 'kate', 'katie', 'kathy', 'cathy', 'kat'],
  ['margaret', 'maggie', 'peggy', 'meg'], ['theresa', 'teresa', 'terri', 'terry', 'tess'],
  ['deborah', 'debra', 'debbie', 'deb'], ['susan', 'sue', 'susie'],
  ['patricia', 'pat', 'patty', 'trish'], ['jennifer', 'jen', 'jenny'],
  ['stephen', 'steven', 'steve'], ['rebecca', 'becky'], ['victoria', 'vicky', 'tori'],
  ['nicole', 'nikki'], ['jacqueline', 'jackie'], ['christine', 'christy', 'tina'],
]
const NICKNAMES = new Map()
NICKNAME_GROUPS.forEach((group, i) => group.forEach(w => {
  if (!NICKNAMES.has(w)) NICKNAMES.set(w, new Set())
  NICKNAMES.get(w).add(i)
}))

function firstCompat(a, b) {
  if (a === b) return 1
  if (a.length === 1 || b.length === 1) return a[0] === b[0] ? 0.5 : 0
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (short.length >= 3 && long.startsWith(short)) return 0.9
  const ga = NICKNAMES.get(a), gb = NICKNAMES.get(b)
  if (ga && gb) for (const g of ga) if (gb.has(g)) return 0.85
  return 0
}

function lastCompat(F, V) {
  const lf = F[F.length - 1], lv = V[V.length - 1]
  if (lf === lv) return 1
  // One side's surname is a piece of the other's compound surname ("White Williams").
  if (V.slice(1).includes(lf) || F.slice(1).includes(lv)) return 0.85
  if (lf.length >= 5 && lv.length >= 5 && lev(lf, lv) <= 1) return 0.8
  return 0
}

/** How well word list F (the file's name) matches V (one roster spelling), 0–1. */
function scoreVariant(F, V) {
  const direct = scoreOrdered(F, V)
  if (F.length < 2 || direct >= 0.9) return direct
  // "Davis, Theresa" — a last-first export. Slightly less sure than the natural order.
  return Math.max(direct, scoreOrdered([...F.slice(1), F[0]], V) - 0.03)
}

function scoreOrdered(F, V) {
  if (!F.length || !V.length) return 0
  if (F.length === V.length && F.every((w, i) => w === V[i])) return 1
  if ([...F].sort().join(' ') === [...V].sort().join(' ')) return 0.97   // "Last First" order

  if (F.length === 1 || V.length === 1) {
    // A lone word only says which family; it can't identify a person.
    const one = F.length === 1 ? F[0] : V[0]
    return (F.length === 1 ? V : F).includes(one) ? 0.35 : 0
  }

  const f = firstCompat(F[0], V[0])
  const l = lastCompat(F, V)
  if (f === 0 && l === 0) return 0
  if (l === 0) return f >= 0.85 ? 0.3 : 0.2
  if (f === 0) return l >= 0.85 ? 0.35 : 0.25

  const q = x => (x >= 1 ? 2 : x >= 0.8 ? 1 : 0)
  const tier = q(f) + q(l)
  let score = tier === 4 ? 0.9 : tier === 3 ? 0.85 : tier === 2 ? 0.8 : 0.45

  // Middle names may be dropped on either side, but two DIFFERENT ones is a red flag.
  const fm = F.slice(1, -1), vm = V.slice(1, -1)
  if (fm.length && vm.length &&
      !fm.some(a => vm.some(b => a === b || ((a.length === 1 || b.length === 1) && a[0] === b[0])))) {
    score -= 0.1
  }
  return score
}

/**
 * How well a file agent name matches a roster person — the best of their Opt name
 * and preferred name. 1 = identical, ~0.9 = same first + last (middle name and
 * nickname differences), lower = partial.
 */
export function nameScore(fileName, person) {
  const F = words(fileName)
  let best = 0
  for (const v of [person?.opt_name, person?.preferred_name]) {
    const V = words(v)
    if (V.length) best = Math.max(best, scoreVariant(F, V))
  }
  return best
}

/**
 * Client-name similarity, 0–1. The file's client is often only a last name or an
 * initial + last name; it is compared with the tracker's applicant on the surname
 * and (when given) the first initial.
 */
export function clientSimilarity(fileClient, applicant) {
  const F = words(fileClient), A = words(applicant)
  if (!F.length || !A.length) return 0
  const surnames = F.filter(w => w.length > 1)
  if (!surnames.length) return 0.2
  const hit = w => A.some(a => a === w || (w.length >= 4 && lev(a, w) <= 1))
  const hits = surnames.filter(hit).length
  if (hits === 0) return 0
  if (hits < surnames.length) return 0.4
  if (F[0].length === 1) return A.some(a => a[0] === F[0]) ? 1 : 0.5
  return 0.8
}

// ── Agent identity ───────────────────────────────────────────────────────────

/** Groups resolved-or-not file lines under one entry per distinct agent name. */
export function groupLinesByAgent(lines) {
  const byKey = new Map()
  for (const l of lines ?? []) {
    const key = words(l.agent_name).join(' ')
    if (!key) continue
    if (!byKey.has(key)) byKey.set(key, { key, name: l.agent_name, lines: [] })
    byKey.get(key).lines.push(l)
  }
  return [...byKey.values()]
}

const displayName = p => p?.preferred_name?.trim() || p?.opt_name?.trim() || ''

/**
 * Resolves each distinct file agent to a roster person.
 *
 * Evidence, per candidate person:
 *   • name similarity against Opt and preferred name (0–1);
 *   • policy-number votes — rows whose number belongs to a tracker policy the
 *     person is credited on. A number that several file agents share (a split)
 *     only shows the group, not the individual, so it counts for far less.
 * A person is chosen when their combined score is clear on its own and beats the
 * runner-up; otherwise the agent is returned unresolved with ranked suggestions.
 *
 * @param {object}   args
 * @param {Array}    args.agents      groupLinesByAgent() output
 * @param {Array}    args.people      roster: { sfg_id, opt_name, preferred_name, status }
 * @param {Map}      args.dbByNum     normalized policy number → tracker policies (with splits)
 * @param {Set|null} args.scopeIds    uppercase sfg_ids in scope (tie-break only)
 * @param {object}   args.overrides   file agent name → sfg_id, chosen by a person
 * @returns {{ resolved: Map<string, object>, unresolved: Array }}
 */
export function resolveFileAgents({ agents, people, dbByNum, scopeIds = null, overrides = {} }) {
  const roster = (people ?? []).filter(p => p.sfg_id).map(p => ({ ...p, id: normId(p.sfg_id) }))
  const byId   = new Map(roster.map(p => [p.id, p]))

  const numberAgents = new Map()   // policy number → agent keys whose rows carry it
  for (const a of agents) {
    for (const l of a.lines) {
      const n = normalizePolicyNumber(l.policy_number)
      if (!n) continue
      if (!numberAgents.has(n)) numberAgents.set(n, new Set())
      numberAgents.get(n).add(a.key)
    }
  }

  const overrideFor = a => {
    const wanted = Object.entries(overrides ?? {}).find(([name]) => words(name).join(' ') === a.key)
    const id = wanted ? normId(wanted[1]) : null
    return id && byId.has(id) ? byId.get(id) : null
  }

  const resolved = new Map()
  const unresolved = []

  for (const a of agents) {
    const manual = overrideFor(a)
    if (manual) {
      resolved.set(a.key, { sfg_id: manual.id, basis: 'manual', name_score: nameScore(a.name, manual), votes: 0, exact: false })
      continue
    }

    // Policy-number evidence
    const votes = new Map(), shared = new Map()
    for (const l of a.lines) {
      const n = normalizePolicyNumber(l.policy_number)
      if (!n) continue
      let rows = dbByNum.get(n) ?? []
      const carrier = bucketCarrier(l.carrier)
      const sameCarrier = rows.filter(p => bucketCarrier(p.carrier) === carrier)
      if (sameCarrier.length) rows = sameCarrier
      const target = numberAgents.get(n).size > 1 ? shared : votes
      for (const id of new Set(rows.flatMap(p => participants(p)))) target.set(id, (target.get(id) ?? 0) + 1)
    }

    // Candidate people: anyone whose name is at all plausible, plus anyone the numbers point at.
    const candidates = new Map()
    for (const p of roster) {
      const name = nameScore(a.name, p)
      if (name >= 0.3) candidates.set(p.id, { p, name })
    }
    for (const id of [...votes.keys(), ...shared.keys()]) {
      if (!candidates.has(id) && byId.has(id)) candidates.set(id, { p: byId.get(id), name: nameScore(a.name, byId.get(id)) })
    }

    const ranked = [...candidates.values()].map(({ p, name }) => {
      const v = votes.get(p.id) ?? 0, s = shared.get(p.id) ?? 0
      const score = name
        + (v >= 1 ? 0.5 : 0) + (v >= 2 ? 0.25 : 0) + (s >= 1 ? 0.2 : 0)
        + (scopeIds?.has(p.id) ? 0.03 : 0) + (/^active$/i.test(p.status ?? '') ? 0.02 : 0)
      return { p, name, votes: v, shared: s, score }
    }).sort((x, y) => y.score - x.score)

    const [best, second] = ranked
    if (best && best.score >= 0.9 && (!second || best.score - second.score >= 0.12)) {
      resolved.set(a.key, {
        sfg_id:     best.p.id,
        basis:      best.votes && best.name >= 0.85 ? 'name+policy' : best.votes ? 'policy' : 'name',
        name_score: best.name,
        votes:      best.votes,
        shared:     best.shared,
        exact:      best.name >= 0.97,
      })
    } else {
      unresolved.push({
        key: a.key, name: a.name,
        candidates: ranked.slice(0, 5).map(r => ({
          sfg_id: r.p.id, name: displayName(r.p), score: Math.round(r.score * 100) / 100, policy_matches: r.votes,
        })),
      })
    }
  }

  return { resolved, unresolved }
}

// ── Policy-level adjudication ────────────────────────────────────────────────

const money = n => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
const isIssued = p => /^issued$/i.test(String(p?.status ?? '').trim())

function cbApvOf(p) {
  const v = parseFloat(String(p?.snapshot_chargeback_apv ?? '').replace(/[$,]/g, ''))
  return Number.isFinite(v) && v > 0 ? v : 0
}
// Same rule the promotions context uses: the logged chargeback amount, or the whole
// issued APV when a chargeback month was set without an amount.
const cbFieldOf = p => (cbApvOf(p) > 0 ? 'snapshot_chargeback_apv' : 'issued_apv')

/** One agent's credited share of the chargeback logged on a policy. */
export function chargebackAmount(policy, sfgId) {
  return creditedAmount(policy, sfgId, cbFieldOf(policy))
}

/**
 * Compares the file with the tracker per agent + carrier.
 *
 * @param {object}   args
 * @param {Array}    args.lines    resolved file lines (every agent, in scope or not):
 *                                 { sfg_id, agent_name, policy_number, client, apv, carrier, product }
 * @param {Array}    args.tracker  tracker policies with `splits` attached — everything issued
 *                                 in the window, everything with a chargeback logged for it,
 *                                 and every policy matching a file policy number (any status/date)
 * @param {{from:string,to:string}} args.window
 * @param {(id:string)=>boolean} args.inScope   only these agents' buckets are reported
 * @param {(id:string)=>string}  args.nameOf
 * @param {boolean} args.netChargebacks  true (final ledger): subtract chargebacks already logged
 *                                       for the window; false (draft): treat them as unlogged
 * @returns {{ buckets: Array, numberFixes: Array }}
 */
export function adjudicateBuckets({
  lines, tracker, window, inScope = () => true, nameOf = id => id, netChargebacks = true,
}) {
  const inWin = d => { const s = String(d ?? '').slice(0, 10); return !!s && s >= window.from && s <= window.to }
  const loggedInWindow = p => !!p.snapshot_chargeback_month && inWin(p.snapshot_chargeback_month)

  // Every tracker policy by number, whatever its status or date.
  const byNum = new Map()
  for (const p of tracker) {
    const n = normalizePolicyNumber(p.policy_number)
    if (!n) continue
    if (!byNum.has(n)) byNum.set(n, [])
    byNum.get(n).push(p)
  }

  // ── Tracker side: per agent + carrier + policy ────────────────────────────
  const trk = new Map()
  for (const p of tracker) {
    const issuedIn = isIssued(p) && inWin(p.issue_date)
    // A draft ledger treats every chargeback as not yet logged, however the tracker stands.
    const cbIn     = netChargebacks && loggedInWindow(p)
    if (!issuedIn && !cbIn) continue
    const carrier = bucketCarrier(p.carrier)
    const numKey  = normalizePolicyNumber(p.policy_number) || `#${p.id}`
    for (const a of participants(p)) {
      if (!inScope(a)) continue
      const issued = issuedIn ? creditedAmount(p, a, 'issued_apv') : 0
      const cb     = cbIn ? chargebackAmount(p, a) : 0
      if (!issued && !cb) continue
      const key = `${a}||${carrier}||${numKey}`
      const e = trk.get(key) ?? { sfg: a, carrier, numKey, policies: [], issued: 0, cb: 0 }
      e.policies.push(p); e.issued += issued; e.cb += cb
      trk.set(key, e)
    }
  }

  // ── File side: per agent + carrier + policy (lines with no number are lumps) ─
  const fg = new Map(), lumps = new Map()
  const fileAgentsByNum = new Map()   // policy number → { sfg → net } across ALL file agents
  for (const l of lines) {
    const carrier = bucketCarrier(l.carrier)
    const bk = `${l.sfg_id}||${carrier}`
    const num = normalizePolicyNumber(l.policy_number)
    if (!num) { lumps.set(bk, (lumps.get(bk) ?? 0) + l.apv); continue }
    const key = `${bk}||${num}`
    const g = fg.get(key) ?? { sfg: l.sfg_id, carrier, num, rawNumber: l.policy_number, prod: 0, rev: 0, net: 0, client: '', product: '', whole: true, agent_name: l.agent_name }
    if (l.apv > 0) g.prod += l.apv; else g.rev += l.apv
    g.net += l.apv
    if (!g.client && l.client) g.client = l.client
    if (!g.product && l.product) g.product = l.product
    if (!Number.isInteger(l.apv)) g.whole = false
    fg.set(key, g)
    if (!fileAgentsByNum.has(num)) fileAgentsByNum.set(num, new Map())
    fileAgentsByNum.get(num).set(l.sfg_id, (fileAgentsByNum.get(num).get(l.sfg_id) ?? 0) + l.apv)
  }

  const bucketKeys = new Set()
  for (const g of fg.values()) if (inScope(g.sfg)) bucketKeys.add(`${g.sfg}||${g.carrier}`)
  for (const k of lumps.keys()) if (inScope(k.split('||')[0])) bucketKeys.add(k)
  for (const e of trk.values()) bucketKeys.add(`${e.sfg}||${e.carrier}`)

  const fileByBucket = new Map(), trkByBucket = new Map()
  for (const g of fg.values()) { const k = `${g.sfg}||${g.carrier}`; if (!fileByBucket.has(k)) fileByBucket.set(k, []); fileByBucket.get(k).push(g) }
  for (const e of trk.values()) { const k = `${e.sfg}||${e.carrier}`; if (!trkByBucket.has(k)) trkByBucket.set(k, []); trkByBucket.get(k).push(e) }

  // A policy several file agents share and whose shares add up to the tracker's
  // whole policy is a SPLIT — any difference is about the ratio or a missing
  // split record, not about missing production.
  function splitContext(num) {
    const fileShares = fileAgentsByNum.get(num)
    if (!fileShares || fileShares.size < 2) return null
    const rows = byNum.get(num) ?? []
    if (!rows.length) return null
    const whole = rows.find(isIssued) ?? rows[0]
    const fileTotal = [...fileShares.values()].reduce((s, v) => s + v, 0)
    const trackerTotal = Number(whole.issued_apv) || 0
    if (Math.abs(fileTotal - trackerTotal) > Math.max(1.5, Math.abs(trackerTotal) * 0.005)) return null
    const fmtShares = [...fileShares.entries()].map(([id, v]) => `${nameOf(id)} ${money(v)} (${Math.round((v / fileTotal) * 100)}%)`).join(' / ')
    const trackerShares = whole.splits?.length
      ? whole.splits.map(s => `${nameOf(normId(s.sfg_id))} ${Math.round((Number(s.credit_pct) || 0) * 100)}%`).join(' / ')
      : `no split recorded (100% ${nameOf(normId(whole.sfg_id))})`
    return { fmtShares, trackerShares, row: whole }
  }

  // The words for a Reversal line whose chargeback isn't in the (counted) tracker.
  // A draft ledger flags EVERY reversal, so it also says when one is already logged.
  function reversalNote(rev, row, sfg) {
    if (netChargebacks) {
      const other = row?.snapshot_chargeback_month
        ? ` A chargeback is logged for ${String(row.snapshot_chargeback_month).slice(0, 7)}, not this month.` : ''
      return `Snapshot reverses ${money(rev)}; no chargeback is logged in the tracker for this month.${other}`
    }
    if (row && loggedInWindow(row)) {
      return `Snapshot reverses ${money(rev)}. A ${money(chargebackAmount(row, sfg))} chargeback is already logged for this month.`
    }
    const other = row?.snapshot_chargeback_month
      ? ` (A chargeback is logged for ${String(row.snapshot_chargeback_month).slice(0, 7)}, not this month.)` : ''
    return `Snapshot reverses ${money(rev)}; log it as a chargeback for this month.${other}`
  }

  const numberFixes = []
  const buckets = []

  for (const bk of bucketKeys) {
    const [sfg, carrier] = bk.split('||')
    const fileGroups = fileByBucket.get(bk) ?? []
    const trkEntries = trkByBucket.get(bk) ?? []
    const lump       = lumps.has(bk) ? lumps.get(bk) : null

    const snapshotApv = fileGroups.reduce((s, g) => s + g.net, 0) + (lump ?? 0)
    const trackerIssued = trkEntries.reduce((s, e) => s + e.issued, 0)
    const trackerCb     = trkEntries.reduce((s, e) => s + e.cb, 0)
    const trackerNet    = trackerIssued - trackerCb

    const bucket = {
      sfg_id: sfg, carrier,
      mode: lump !== null ? 'lump' : 'policy',
      snapshot_apv: snapshotApv,
      tracker_issued: trackerIssued, tracker_chargebacks: trackerCb, tracker_net: trackerNet,
      delta: snapshotApv - trackerNet,
      items: [], matched: 0, rounding: 0, file_lines: fileGroups.length + (lump !== null ? 1 : 0),
      tracker_policies: trkEntries.flatMap(e => e.policies),
    }

    if (bucket.mode === 'lump') {
      // No policy numbers to work with (TransAmerica sends one figure per agent):
      // the caller runs the bucket-level explanation used for the old file.
      bucket.material = bucket.delta
      buckets.push(bucket)
      continue
    }

    const push = item => bucket.items.push({ match: 'full', signed: true, ...item })
    const trkByNum = new Map(trkEntries.map(e => [e.numKey, e]))
    const fileByNum = new Map(fileGroups.map(g => [g.num, g]))
    const fileOnly = [], trkOnly = []

    for (const num of new Set([...trkByNum.keys(), ...fileByNum.keys()])) {
      const g = fileByNum.get(num), e = trkByNum.get(num)
      if (g && !e) { fileOnly.push(g); continue }
      if (!g && e) { trkOnly.push(e); continue }

      // Both sides know this policy: compare it, production and reversal separately.
      // Whole-dollar figures are carrier rounding, and chargebacks are usually logged
      // in the tracker as whole dollars against the file's cents.
      const tol = (g.whole || g.rev !== 0 || e.cb > 0) ? 1.0 : 0.02
      const net = g.net - (e.issued - e.cb)
      if (Math.abs(net) <= tol) { bucket.matched++; bucket.rounding += net; continue }

      const row  = e.policies[0]
      const split = splitContext(num)
      const prodDiff = g.prod - e.issued
      const revDiff  = g.rev + e.cb
      const common = {
        policy_id: row.id, policy_number: row.policy_number, applicant: row.applicant,
        issued_apv: e.issued, tracker_apv: e.issued - e.cb, snapshot_apv: g.net,
        client: g.client, product: g.product, issue_date: row.issue_date, status: row.status,
      }

      if (Math.abs(prodDiff) > tol) {
        if (split) {
          push({ ...common, type: 'split', flag: 'Split differs', delta_contribution: prodDiff,
            note: `Snapshot splits this policy ${split.fmtShares}; tracker has ${split.trackerShares}.` })
        } else if (g.prod === 0) {
          push({ ...common, type: 'missing', flag: 'Missing from snapshot', delta_contribution: prodDiff,
            note: 'Snapshot shows only a reversal for this policy; the tracker has it issued in the window.' })
        } else {
          push({ ...common, type: 'apv_diff', flag: 'APV differs', delta_contribution: prodDiff,
            note: `Snapshot ${money(g.prod)} vs tracker ${money(e.issued)}.` })
        }
      } else bucket.rounding += prodDiff

      if (Math.abs(revDiff) > tol) {
        const cbCommon = { ...common, conservation_date: row.conservation_date, conservation_status: row.conservation_status }
        if (g.rev < 0 && e.cb === 0) {
          push({ ...cbCommon, type: 'reversal_unlogged', flag: 'Log chargeback', delta_contribution: revDiff,
            note: reversalNote(g.rev, row, sfg) })
        } else if (g.rev < 0) {
          push({ ...cbCommon, type: 'reversal_diff', flag: 'Chargeback amount differs', delta_contribution: revDiff,
            note: `Snapshot reverses ${money(g.rev)}; the tracker logged ${money(-e.cb)}.` })
        } else {
          push({ ...cbCommon, type: 'chargeback_not_in_file', flag: 'Chargeback not on Snapshot', delta_contribution: revDiff,
            note: `The tracker logged a ${money(-e.cb)} chargeback this month that Snapshot doesn't show.` })
        }
      } else bucket.rounding += revDiff
    }

    // Number in the file that isn't in the tracker for this agent (and vice versa):
    // first see whether they are the SAME policy under a mistyped number.
    const usedTrk = new Set()
    for (const g of [...fileOnly]) {
      if (g.prod <= 0) continue
      const hit = trkOnly.find(e => {
        if (usedTrk.has(e) || e.issued <= 0) return false
        const row = e.policies[0]
        const cs = clientSimilarity(g.client, row.applicant)
        const amountOk = Math.abs(g.prod - e.issued) <= (g.whole ? 1.0 : 0.02)
        return (amountOk && (cs >= 0.5 || !g.client)) || cs >= 0.9
      })
      if (!hit) continue
      usedTrk.add(hit)
      fileOnly.splice(fileOnly.indexOf(g), 1)
      const row = hit.policies[0]
      numberFixes.push({
        sfg_id: sfg, agent_name: g.agent_name, carrier, client: g.client, apv: g.prod,
        file_number: g.rawNumber, tracker_number: row.policy_number, applicant: row.applicant, policy_id: row.id,
      })
      const diff = g.net - (hit.issued - hit.cb)
      if (Math.abs(diff) <= (g.whole ? 1.0 : 0.02)) bucket.rounding += diff
      else push({
        policy_id: row.id, policy_number: row.policy_number, applicant: row.applicant,
        issued_apv: hit.issued, tracker_apv: hit.issued - hit.cb, snapshot_apv: g.net,
        type: 'apv_diff', flag: 'APV differs', delta_contribution: diff,
        note: `Snapshot ${money(g.net)} vs tracker ${money(hit.issued - hit.cb)} (tracker policy # is "${row.policy_number}", Snapshot has "${g.rawNumber}").`,
      })
    }
    for (const e of usedTrk) trkOnly.splice(trkOnly.indexOf(e), 1)

    for (const g of fileOnly) {
      const rows  = byNum.get(g.num) ?? []
      const mine  = rows.filter(p => participants(p).includes(sfg))
      const pick  = mine.find(p => bucketCarrier(p.carrier) === carrier) ?? mine[0]
      const split = splitContext(g.num)
      const base  = {
        policy_number: g.rawNumber, applicant: g.client, snapshot_apv: g.net, tracker_apv: 0,
        client: g.client, product: g.product,
      }
      const withRow = pick ? {
        ...base, policy_id: pick.id, policy_number: pick.policy_number, applicant: pick.applicant,
        issue_date: pick.issue_date, status: pick.status, issued_apv: creditedAmount(pick, sfg, 'issued_apv'),
      } : base

      if (g.prod > 0) {
        if (split) {
          push({ ...withRow, type: 'split', flag: 'Split differs', delta_contribution: g.prod,
            note: `Snapshot splits this policy ${split.fmtShares}; tracker has ${split.trackerShares}.` })
        } else if (!rows.length) {
          push({ ...base, type: 'not_in_tracker', flag: 'Not in tracker', delta_contribution: g.prod,
            note: `Snapshot has ${money(g.prod)} for policy ${g.rawNumber}${g.client ? ` (${g.client})` : ''}; no policy with that number is in the tracker.` })
        } else if (!pick) {
          const others = [...new Set(rows.flatMap(p => participants(p)))].map(nameOf).join(', ')
          push({ ...base, policy_id: rows[0].id, policy_number: rows[0].policy_number, applicant: rows[0].applicant,
            type: 'agent_mismatch', flag: 'Credited to a different agent', delta_contribution: g.prod,
            note: `Snapshot credits this policy here; the tracker credits ${others}.` })
        } else if (!isIssued(pick)) {
          push({ ...withRow, type: 'not_issued', flag: 'Not issued in tracker', delta_contribution: g.prod,
            note: `Snapshot has ${money(g.prod)}; the tracker shows this policy as ${pick.status || 'not issued'}.` })
        } else if (!inWin(pick.issue_date)) {
          push({ ...withRow, type: 'outside_window', flag: 'Issue date outside window', delta_contribution: g.prod,
            note: `Snapshot counts ${money(g.prod)} in this month; the tracker issue date is ${String(pick.issue_date).slice(0, 10)}.` })
        } else {
          push({ ...withRow, type: 'apv_diff', flag: 'Carrier differs', delta_contribution: g.prod,
            note: `Snapshot lists this under ${carrier}; the tracker has it under ${pick.carrier}.` })
        }
      }

      if (g.rev < 0) {
        if (!rows.length) {
          push({ ...base, snapshot_apv: g.rev, type: 'not_in_tracker', flag: 'Not in tracker', delta_contribution: g.rev,
            note: `Snapshot reverses ${money(g.rev)} on policy ${g.rawNumber}${g.client ? ` (${g.client})` : ''}; no policy with that number is in the tracker.` })
        } else if (!pick) {
          push({ ...base, snapshot_apv: g.rev, policy_id: rows[0].id, policy_number: rows[0].policy_number, applicant: rows[0].applicant,
            type: 'agent_mismatch', flag: 'Credited to a different agent', delta_contribution: g.rev,
            note: `Snapshot reverses ${money(g.rev)} here; the tracker credits ${[...new Set(rows.flatMap(p => participants(p)))].map(nameOf).join(', ')}.` })
        } else {
          push({ ...withRow, snapshot_apv: g.rev, conservation_date: pick.conservation_date, conservation_status: pick.conservation_status,
            type: 'reversal_unlogged', flag: 'Log chargeback', delta_contribution: g.rev,
            note: reversalNote(g.rev, pick, sfg) })
        }
      }
    }

    for (const e of trkOnly) {
      const row = e.policies[0]
      const others = fileAgentsByNum.get(e.numKey)
      const split  = splitContext(e.numKey)
      const common = {
        policy_id: row.id, policy_number: row.policy_number, applicant: row.applicant,
        issued_apv: e.issued, tracker_apv: e.issued - e.cb, snapshot_apv: 0,
        issue_date: row.issue_date, status: row.status,
      }
      if (e.issued > 0) {
        if (split) {
          push({ ...common, type: 'split', flag: 'Split differs', delta_contribution: -e.issued,
            note: `Snapshot splits this policy ${split.fmtShares}; tracker has ${split.trackerShares}.` })
        } else if (others && others.size) {
          push({ ...common, type: 'agent_mismatch', flag: 'Credited to a different agent', delta_contribution: -e.issued,
            note: `The tracker credits this policy here; Snapshot credits ${[...others.keys()].map(nameOf).join(', ')}.` })
        } else {
          push({ ...common, type: 'missing', flag: 'Missing from snapshot', delta_contribution: -e.issued,
            note: row.not_in_opt ? 'Marked "not in Opt" in the tracker.' : 'Issued in the window in the tracker; Snapshot has no line for this policy.' })
        }
      }
      if (e.cb > 0) {
        push({ ...common, type: 'chargeback_not_in_file', flag: 'Chargeback not on Snapshot', delta_contribution: e.cb,
          conservation_date: row.conservation_date, conservation_status: row.conservation_status,
          note: `The tracker logged a ${money(-e.cb)} chargeback this month that Snapshot doesn't show.` })
      }
    }

    bucket.material = bucket.items.reduce((s, i) => s + i.delta_contribution, 0)
    buckets.push(bucket)
  }

  return { buckets, numberFixes }
}
