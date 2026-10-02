# SBLI
Portal URL / login page: https://www.sbliagent.com/agentauth/login.aspx?ReturnUrl=%2fagent%2f
MFA: none. Timeout: none observed / long enough for a run (Andrew, 2026-10-01). Can run unattended.
Hierarchy visibility: full — views are "For Kristina Kay Watts" with downline.
Browser: Kristina's Chrome profile (Browser 2).

## Navigation
Two server-rendered HTML tables, one page each ("Page 1 of 1"). No export needed; parse the DOM.
Each page shows "Data Current as of MM/DD/YYYY hh:mm" — record it; it is the base for
Days To Lapse.

1. **Terminations** (final statuses):
   https://www.sbliagent.com/agent/policylist.aspx?s=Terminations
   (short form avoids the stale `t=` row-count parameter; same 43 rows verified 2026-10-01)
   Columns: Policy Number, Servicing Agent, Insured Name, Status, Face Amount, Billing Mode,
   Annual Premium, Plan Type, Status Change Date. Rolling window ≈ last 12 months.
   - With the short URL the pager reads "Page 1 of 0" (quirk). Accept "Page 1 of 0|1"; any
     higher page count → flag (pagination not yet handled).
2. **Reminder Notices** (pending lapse): https://www.sbliagent.com/agent/tasklist_re.aspx?a=5338859438
   Columns: Policy Number, Servicing Agent, Insured Name, Owner Name, Payor Name,
   Premium Due Date, Premium Due, Days To Lapse (zero-padded, e.g. `000014`), Agency,
   Issue Date, Interested Party, Face Amount.

Ignore: Closed/Cancelled (pre-issue closures), Issued and Not Paid (essentially never used),
Lapsed Notices (the letters themselves; same data as Terminations), Upcoming Anniversaries.

Tool limit: Chrome JS results are capped at ~1,000 chars. Store parsed rows on `window` and
read them back in chunks.

## Status mapping
| Carrier wording | Our value | Notes |
|---|---|---|
| Terminations: `Lapsed` | `Lapsed` | Status Change Date |
| Terminations: `Surrender` | `Cancelled` | Status Change Date |
| On Reminder Notices | `Lapse pending` | date = Data Current date + Days To Lapse |
| Pending in DB, not on Reminder Notices, not on Terminations | recovered → NULL | |

## Date sources
| Our need | Carrier field | Explicit or derived | Confirmed? |
|---|---|---|---|
| Termination date | Status Change Date (Terminations) | explicit | Yes |
| Lapse-pending date | Data Current as of + Days To Lapse | explicit (carrier projection) | Yes |

Days To Lapse usually works out to Premium Due Date + 40 days; older notices run longer
(+50/+54 seen). Always use the carrier's count, never the +40 shortcut.

## Policy number display
`999999999` (9 digits). Same as stored; exact match works.

## Split policies
None seen yet.

## Quirks & gotchas
- Reminder Notices can list a premium that isn't due yet (due date in the future). That's the
  next notice after a missed premium was paid; the projected date moves forward. Update it.
- Terminations wording can differ from what was recorded earlier (4 policies were `Cancelled`
  in the DB but `Lapsed` at SBLI). Andrew: match the carrier, statuses and dates both, even
  on final statuses (2026-10-01).

## Carrier-specific flag rules
- Policy on Terminations or Reminder Notices with no DB row → Flag "not in DB".
- Not-at-carrier checks don't apply: these views only list exceptions.

## Confidence: high
First run applied 2026-10-01 (16 changes).
