# Mutual of Omaha (MOO)
Portal: https://producer2.mutualofomaha.com (React; GraphQL at `/my-business/graphql`)
MFA: per session; **Andrew logs in**. Session lasts ~1–4 h (FRAMEWORK §5, run order #4).
Hierarchy visibility: full ("Sales Professional Access"). Banner: policies sold under a Special
Agent contract aren't visible to the writing Special Agent.
Browser: Kristina's Chrome profile (deviceId ac4e38f3…).

## Navigation
1. **Conservation Events**: https://producer2.mutualofomaha.com/my-business/conservation-events/
   - Events from the last 30 days only. Cards, ~25 shown; click "Show More" until it's gone,
     then split `document.body.innerText` on "View Details".
   - Per card: event type (Lapse Notice, Cancellation, Reinstatement, Update, Billing, Pending,
     Nonrenewal, Statement), subtype (Potential Lapse [Health 1st/2nd/Final Notice | Flexible UL],
     Policy Lapsed, Terminated by Customer Request, Policy Cancelled[/Surrendered], Pending Policy
     Declined, Potential Cancellation - New Business, Reinstatement for Life Policy,
     Returned Mail…), Event Date, Paid to Date (sometimes blank), product, Policy#.
   - Quick-stats header counts; "Download Options" export (not yet used).
2. **Policy Management** (current status + paid-to): https://producer2.mutualofomaha.com/my-business/policy-management/
   - Search by Policy Number: set the input value with the native setter and dispatch
     `input`, then click "Search". Results show under "Search Results" or "Inactive Policies".
     ~1 s per lookup.
   - Card: Status (Inforce, Lapsed - Non payment, Issued, Placed, Declined, Status Pending…),
     Paid to Date, product, Policy#, Annualized Premium, Writing Producer.
   - The search-type select (`#policy-management-search-select`) also allows clientName,
     clientSSN, producerName, producerNumber, producerNpn. Use clientName to find a policy number.
   - Total count ~1,231 submitted + an Inactive section; full-list reconciliation not yet built
     (Download Options is a candidate).
3. **Policy detail notices** (View Details): notices like "As of 10/05/2026, the Paid to Date
   was 09/14/2026" give the paid-to date when the card shows none.

Run: look up every DB-pending policy plus every checkable policy with an event in the last
30 days.

## Status mapping
| MOO | Our value | Date |
|---|---|---|
| Inforce, paid-to ≥ today | in force; pending/FPNP recovers → NULL | — |
| Inforce, paid-to behind, **with a lapse notice or already pending** | `Lapse pending` | paid-to + 60; already passed → today + 7 (MOO often doesn't lapse on time) |
| Inforce, paid-to slightly behind, no lapse notice | no change (monthly payers run a few days late) | — |
| Paid-to blank | read the latest notice's "As of …, the Paid to Date was …"; nothing → assume issue + 1 month | |
| Lapsed - Non payment + "Policy Lapsed" event | `Lapsed` | event date |
| Lapsed - Non payment + "Terminated by Customer Request" | `Cancelled` | event date |
| Policy Cancelled / Cancelled-Surrendered | `Cancelled` | event date |
| Issued / Placed (never paid), not on Snapshot | approved 2026-10-07: status → `Incomplete`, `issue_date` → NULL, notes "Issued, not paid" | — |
| Issued, first premium paid then a later premium bounced | `Lapse pending` (not FPNP) | paid-to + 60 |
| Contradictions (e.g. Lapsed right after a Reinstatement, paid-to in future, detail page says Inforce) | leave as is; recheck next run | — |

Ignore: saved policies keep their lapse alerts after payment (the paid-to date decides);
Returned Mail; Billing.

## Product naming
"Guaranteed ADvantage" (GA) in the DB = MOO's "Limited Accident" product. Critical Advantage ≈
"Lump Sum CA / Spec Disease Indemnity".

## Policy number display
`999999-99` (most), `BU9999999`, a few `999999999`. Same as stored.

## Known exceptions
| Policy | Situation |
|---|---|
| BU6805255 | Not in DB: departed agent (DeBesse) |
| 237395-96 | In DB, not visible at MOO (Andrew's own 2022 policy; outside the hierarchy view) |

## Data hygiene (2026-10-07)
- Done: 603930-41 duplicate merged (kept the $285.24 row that matches MOO); Sherima Lopez GA
  number filled (561089-41).
- Done 2026-10-07 (Andrew): 481132-41 kept the 3/1 issue date row; 457385-41 deleted the
  Issued row, kept Not taken; James Jackson IV Critical Advantage → 688345-41, issued APV $454.56;
  Melanie Canales GA (no matching MOO policy) → Withdrawn, issue date and number cleared.
- Andrew Watts Critical Advantage (2022): number found by Andrew, 237395-96 (set 2026-10-07).

## Confidence: medium
First run applied 2026-10-07 (38 changes) plus hygiene fixes. Open: full-list reconciliation
(not-in-DB / not-at-carrier); recheck BU6486166 (Lapsed vs Inforce) next run.
