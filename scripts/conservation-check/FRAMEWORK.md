# Carrier Conservation Status Checks — Framework & Discovery Plan

Owner: Andrew Watts (super_admin). Executor: Claude Code with browser control.
Goal: a weekly routine that checks WFA policies at 10 carrier portals and keeps
`policies.conservation_status` and `policies.conservation_date` current in Supabase.
These two fields feed the portal's Client Engagement page.

This file is the starting framework. Discovery sessions refine it carrier by carrier,
and the end state is a routine spec (Section 11).

---

## 1. Data model

Table: `policies`. Relevant fields:

| Field | Meaning | Routine may write? |
|---|---|---|
| `status` | Base status: `NULL`, `Pending`, `Incomplete`, `Issued`, `Not taken`, `Withdrawn`, `Declined` (exact UI casing) | Only per Section 3, with Andrew's approval |
| `issue_date` | Issue date; drives the Snapshot rule | No |
| `conservation_status` | One of the values below, or `NULL` | Yes |
| `conservation_date` | Expected conservation date; for past dates, the actual date | Yes |
| `chargeback_exempt` | Snapshot chargeback exemption | Yes — recompute with `computeChargebackExempt()` from `shared/chargebackExempt.js` (same function the UI uses) on every conservation write. On recovery clear only the two conservation fields and leave it unchanged (it is NOT NULL; matches the UI's "Remove Conservation") |

### Allowed `conservation_status` values

| Value | Type | Checked each run? | `conservation_date` |
|---|---|---|---|
| `Lapse pending` | Pending | Yes | Projected lapse date (Section 4) |
| `First Premium Not Paid` | Pending, on Snapshot | Yes | Projected not-taken date (Section 4) |
| `Lapsed` | Final | No | Termination date (Section 4) |
| `Cancelled` | Final (incl. surrender) | No | Termination date |
| `Death` | Final | No | Termination date |
| `Declined, On Snapshot` | Final, on Snapshot | No | Termination date |
| `Withdrawn, On Snapshot` | Final, on Snapshot | No | Termination date |
| `Not Taken, On Snapshot` | Final, on Snapshot | No | Termination date |

Rules:
- Final statuses are not re-checked each run. Exception: when a carrier's termination list
  shows a different final wording or date for a policy, correct it to match (Andrew,
  2026-10-01; SBLI case).
- When a pending policy recovers (the carrier shows it in force or paid), set both
  conservation fields to `NULL`.
- Use the exact casing and punctuation above (the `, On Snapshot` comma matches the portal
  dropdown and existing data), and never write a value that isn't on this list.
- Side effect to remember: Snapshot treats any `Issued` policy with a `conservation_date` as
  a chargeback (api/snapshot/run.js), which is why `chargeback_exempt` must be kept in step.
- Every final status must end up with a date, whether known, deduced, or confirmed by Andrew.

## 2. Scope

- All policies in the WFA hierarchy at the 10 core carriers.
- Each run checks policies whose `conservation_status` is `NULL`, `Lapse pending`, or
  `First Premium Not Paid`. A change worth recording is one of:
  - into or out of `Lapse pending`
  - into or out of `First Premium Not Paid`
  - into any final status
- Some carriers group several names under one portal. Treat each group as one carrier:
  AmAm / Occidental; Banner / LGA; Foresters / Foresters DFL.
- Known visibility gap: the American General login does not show the full hierarchy
  because of internal hierarchy structuring. Logins for the other agency owners are being
  obtained. Until then, policies outside the visible tree are reported as "not visible",
  not flagged as unmatched.
- Accepted gap: a `Lapsed` policy that is later reinstated won't be caught, because final
  statuses aren't re-checked.

## 3. Snapshot rule (unissued outcomes)

This rule applies when the carrier shows any of these outcomes for a policy: unpaid first
premium, not taken, declined, or withdrawn. First decide whether the policy is on Snapshot:

- **On Snapshot:** the `snapshot_cycles` row for the month of `policies.issue_date` has
  `completed_at` set (the cycle is closed).
- Issue months before the first cycle (2026-05) count as on Snapshot (Andrew, 2026-10-01).
- Cycles from 2026-08 onward carry `snapshot_cycle_scopes` (owner SFG IDs). A policy is on
  Snapshot only if a closed cycle for its issue month has the policy's agency owner in scope
  (Andrew, 2026-10-01). Cycles with no scope rows (2026-05 to 2026-07) cover everyone.

Then:

1. **On Snapshot:** leave `status` alone. It stays `Issued`. Record the outcome as a
   conservation status:
   - Unpaid first premium → `First Premium Not Paid`
   - Not taken → `Not Taken, On Snapshot`
   - Declined → `Declined, On Snapshot`
   - Withdrawn → `Withdrawn, On Snapshot`
2. **Not on Snapshot:**
   - Treat it as a base-status correction, so propose the new `status` value.
   - Leave both conservation fields `NULL`.
   - Write only after Andrew approves, in production runs too.
3. **Not on Snapshot, and the issue month has already passed** (that month's cycle is
   still open). Typical case: a policy issued in September that flips back to unpaid in
   October because the owner's bank bounced the premium payment.
   - Handle it the same way: propose the base-status correction, but do not write it
     without approval.
   - Add a note to the flag: "If this policy appears as issued business on that month's
     Snapshot report, remove it through a dispute."

## 4. Dates

### Final statuses
- Use the termination date shown in the carrier's system.
- If the carrier shows no date, deduce one:
  - If the policy had a projected `conservation_date` on record, and that date falls
    between the previous check of this carrier and today, use the projected date.
  - Otherwise, often after a surrender, propose a best-guess date with your reasoning
    and the possible window, and flag it. Andrew makes the call.
- The previous check date for each carrier is read from `state/last-checked.json`
  (Section 7). There is no `last_checked_at` column.

### Pending statuses
- Use the carrier's explicit date if one is shown.
- If not, use these defaults, which are to be confirmed with Andrew during discovery and
  then fixed in each carrier's card:
  - `Lapse pending`: paid-to date + 60 days.
  - `First Premium Not Paid`: approval date + 45 days, or the date the status changed
    + 45 days.
- Each carrier card records which carrier field supplies each input date (paid-to,
  approval, status change).

## 5. Run design (weekly)

### Order
1. **Foresters** (MFA per session; session times out): log in and process.
2. **TransAmerica** (MFA occasional; session times out): log in and process.
3. **AmAm / Occidental** (MFA on every login; session is stable): log in and process.
4. **Mutual of Omaha** (MFA per session; session lasts about 1–4 hours): log in and process.
5. **The rest, unattended:** Americo, SBLI, F&G, United Home Life, American General, Banner.

Andrew needs to be present until the last MFA login is done. Discovery should test
whether the AmAm and MOO logins can be done at the start of the run so he can leave
sooner, which works if those sessions survive sitting idle.

If a session expires or an MFA prompt shows up while Andrew is away:
- Skip that carrier.
- Record the skip in the report.
- Keep going with the remaining carriers.

### Per-carrier loop
1. Pull the carrier's data. Prefer an exception view (lapse, pending lapse, unpaid) or
   an export. Fall back to looking up policies one at a time only when you need to.
2. Match carrier records to Supabase records (Section 6).
3. Map the carrier's status wording and dates to our values, using that carrier's card,
   Section 3, and Section 4.
4. Classify each policy as **Change**, **No change**, **Approval needed** (base-status
   correction), or **Flag**.
5. Apply writes according to Section 7.
6. Write this carrier's section of the run report.

## 6. Matching

- Match on carrier + policy number **exactly as stored**. Don't strip spaces, dashes,
  or leading zeros, and don't normalize the format in any other way. Our stored numbers
  deliberately use the same format as the carrier's.
- Flag anything that doesn't match, in either direction:
  - A carrier record with no Supabase match → **Flag**: "not in DB".
  - A Supabase policy (inside the visible hierarchy) that the carrier doesn't show →
    **Flag**: "not at carrier".
- **Split policies:**
  - A carrier may show one policy number as several rows, each under a different agent.
    In our system that's one policy with the split marked.
  - Collapse those rows into one.
  - If the rows disagree on status or dates → **Flag**.
  - Any other duplicate policy number → **Flag**. Never guess.

## 7. Writes and review

- **During discovery:** write nothing. Produce a proposed-changes table and confirm
  the date projections with Andrew. He approves before anything is applied.
- **Production runs:**
  - Apply **Change** rows.
  - Never write **Approval needed** or **Flag** rows.
  - Keep no change log. The run report is the record that gets reviewed.
- **Run report, per carrier:**
  - Login result.
  - Number of policies checked.
  - Changes applied: policy number, old → new status, old → new date, the carrier's
    exact wording, and how the date was determined (explicit / deduced / default).
  - Approval-needed items.
  - Flags, each with a reason, including any inconsistencies in the carrier's data.
  - Carriers skipped, and why.
- Run reports contain client data. Store them outside the repo (gitignored path) and
  never commit them.
- **Check-date state file:** `state/last-checked.json` holds one entry per carrier,
  mapping the carrier to the date of its last successful check, e.g.
  `{ "Americo": "2026-10-03", ... }`. It contains no client data.
  - Update a carrier's entry only after that carrier finishes successfully.
  - Leave the entry alone for carriers that were skipped or failed. That way, their next
    deduction window still covers the whole period since their last real check.

## 8. Conduct on carrier sites

- Read-only. Never submit forms, make payments, change billing, send messages, or accept
  terms.
- Credentials come only from browser autofill. Never read, type, log, or store passwords
  or MFA codes.
- If an unexpected prompt appears (new terms, a security question, an account warning, a
  password reset), stop work on that carrier and flag it.
- Keep client names out of the carrier cards and `LESSONS.md`. Policy numbers may appear in a
  card's exceptions list (Andrew, 2026-10-01); nowhere else.

## 9. Discovery plan

Work through the carriers from easiest to hardest:
1. **Easy:** Americo, SBLI.
2. **More steps, but consistent:** AmAm / Occidental, F&G, Foresters, United Home Life.
3. **Fiddly, incomplete, or needing interpretation:** American General, Banner, MOO,
   TransAmerica.

In each session:
- Walk through the portal with Andrew.
- Fill in that carrier's card (Section 10).
- Go over the date sources and projections with Andrew.
- Produce a dry-run proposed-changes table and review it with Andrew.
- Add any cross-carrier lessons to `LESSONS.md`.
- Update this framework whenever a lesson changes a general rule.

## 10. Carrier card template (`scripts/conservation-check/carriers/<carrier>.md`)

```
# <Carrier>
Portal URL / login page:
MFA: none | per session (~duration) | every login; timeout behavior:
Hierarchy visibility: full | partial (explain)

## Navigation
Step-by-step path to the exception/report view (exact menu labels).
Filters to set; export available? (format, columns)

## Status mapping
| Carrier wording | Our value (conservation_status / status) | Notes |

## Date sources
| Our need | Carrier field | Explicit or derived | Rule confirmed by Andrew? |
(termination date, paid-to date, approval date, status-change date, explicit
 lapse/not-taken date)

## Policy number display
How numbers appear (pattern only, no real numbers); any display quirks.

## Split policies
How splits appear on this carrier.

## Quirks & gotchas

## Carrier-specific flag rules

## Confidence: low / medium / high, and what would raise it
```

## 11. End-of-discovery deliverable: routine spec

When all 10 carrier cards are at medium confidence or higher, build:
- A single weekly entry point that runs the carriers in the order from Section 5.
- One module per carrier, each following its card.
- Shared modules:
  - Supabase read/write, scoped to the WFA hierarchy.
  - Exact matching and split collapsing.
  - Validation against Section 1.
  - The Snapshot rule, using `snapshot_cycles.completed_at` and `issue_date`.
  - Date determination (Section 4).
  - A queue of base-status approvals.
  - The report generator.
  - Reading and updating the check-date state file.

Before any live writes, do one full dry run across all 10 carriers for Andrew to review.

## 12. Open items

1. ~~Where is the split flag stored?~~ Resolved: splits are rows in `policy_splits`
   (`policy_id`, `sfg_id`, `credit_pct`); `policies` has no flag column. A carrier's
   multi-agent rows for one number should match one `policies` row with `policy_splits`.
   12 legacy duplicate-row groups (same carrier + number) still exist — MOO 5, Banner 5,
   SBLI 1, Foresters 1 — and must be Flagged until the Phase 5 merge clears them.
2. ~~Snapshot cycle scoping by owner~~ Resolved (Section 3).
3. Data hygiene: status values cleaned 2026-10-01. Still open: 3 policy numbers with a
   leading space/tab (Banner 2, Foresters 1) won't exact-match.
4. Past-dated `Lapse pending` projections are left as-is; review each on that carrier's
   first run (Andrew, 2026-10-01).

## Files

- `scripts/conservation-check/FRAMEWORK.md` — this file
- `scripts/conservation-check/LESSONS.md` — cross-carrier lessons
- `scripts/conservation-check/carriers/<carrier>.md` — carrier cards (no client data)
- `scripts/conservation-check/state/last-checked.json` — check-date state (no client data)
- Run reports and dry-run tables (client data): `WFA website/conservation-checks/reports/`
  — outside the repo, never committed.
