# Conservation Checks — Cross-Carrier Lessons

No client names or policy numbers in this file.

## Pre-discovery baseline (2026-10-01)

### Decisions (Andrew, 2026-10-01)
- `, On Snapshot` values keep the comma (matches DB + portal dropdown).
- Routine recomputes `chargeback_exempt` with `computeChargebackExempt()` (shared/chargebackExempt.js, also used by the UI) on every
  conservation write.
- Issue months before the first Snapshot cycle (2026-05) count as on Snapshot.
- Discovery files live in `scripts/conservation-check/`; reports outside the repo.

### Volume (issued, conservation status NULL / Lapse pending / FPNP)
MOO ~1,260 · LGA ~375 · Foresters ~350 · Banner ~315 · Americo ~290 · SBLI ~285 ·
AmAm ~240 · F&G ~130 · TransAmerica ~115 · UHL ~95 · AIG ~85.
Policy-by-policy lookup is not viable for MOO, Banner/LGA, Foresters — need exception views
or exports there.

### Stored policy-number patterns (A = letter, 9 = digit)
| Carrier | Patterns |
|---|---|
| Americo | `AA99999999` |
| SBLI | `999999999` |
| AmAm | `9999999999`; a few `999999999A` |
| Occidental | `9999999999` |
| F&G | `AA999999` |
| Foresters / DFL | `9999999` |
| UHL | `A999999` |
| American General | `9999999999` |
| Banner / LGA | `9999999999` (one LGA `999999999`) |
| MOO | `999999-99` (most), `AA9999999`, a few `999999999` |
| TransAmerica | `AAA999999`, `AAAA999999`, `9999999999` |

### Data hygiene to fix before production
- 3 stored numbers carry a leading space/tab (Banner 2, Foresters 1) — exact match fails.
- ~~Stray status values~~ fixed 2026-10-01 (`Lapse Pending`→`Lapse pending` ×3; `Not taken`
  →`Not Taken, On Snapshot` ×1; status `not taken`→`Not taken` ×1).
- 12 duplicate carrier+number groups (legacy split workaround / other).
- Several `Lapse pending` rows already have a projected date in the past (e.g. late Aug) —
  review each with Andrew on that carrier's first run (don't auto-close).

### Existing projection patterns in the data (to confirm per carrier)
- Banner: projected dates mostly fall on the issue-day-of-month, ~2–5 months out.
- MOO FPNP: ~7 weeks after issue.

### Method
- For each carrier, Andrew first describes his manual lapse process; adapt it to what
  browser access allows.
- Chrome-extension JS results are truncated at ~1,000 chars. Inject the DB's policy numbers
  into the page, match there, and read back only the differences, in chunks.
- Carrier hierarchies can include agents who have left WFA: their business is still
  visible but no longer tracked. Keep a per-carrier exceptions list (by policy number) and
  flag new ones.
- The first run on a carrier catches a backlog going back years (Americo: 2023 changes never
  recorded). Expect a large first-run diff.
- A carrier's page can be left in a filtered state by a human. Verify the initial state before
  reading, and stop if it isn't (Americo: `criteriaDW`).
- Write-time guard: update only where `status = 'Issued'` and the conservation status still
  equals what was read, so a concurrent manual edit is never overwritten.
