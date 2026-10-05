# Banner / LGA (William Penn)
Login: https://login.bannerlife.com/login (the `signin=` param is per-session)
Portal: https://partner.bannerlife.com (AngularJS; hash-routed lists)
MFA: TBD. Timeout: TBD.
Hierarchy visibility: full (Kristina's broker view; header "Kristina Watts").
Browser: Kristina's Chrome profile (deviceId ac4e38f3…).
DB carriers: `Banner` and `LGA`. The portal shows both under company "BNR"; match on number across both.

## Navigation
1. **Policies In Grace** (pending lapse): https://partner.bannerlife.com/business/PoliciesInGrace
   Table columns: [blank, Policy, Policy Status, Effective Date, Paid To Date, Product Name,
   Face Amount, Annualized Premium, Bill Form, Bill Mode, Insured…, Writing Agent Code/Name].
   ~30 rows, one page (page size 50).
2. **My Business List** (all statuses): https://partner.bannerlife.com/business/new#?type=Policy&dateRange=All&pageIndex=0&pageSize=50&sortColumn=lastActivityDate&sortDirection=1
   (the "In Force List" link redirects here). The page size is capped at 50 regardless of the
   hash. All rows load client-side: click "›" through ~24 pages (wait until the first row
   changes). Row cells: [5] Policy #, [7] Status, [3] Submitted/Effective, [2] Latest Activity,
   [4] Company. AngularJS row scope (`angular.element(tr).scope().case`) has policyNumber,
   status, date, lastActivityDate, but no paid-to date.
   Statuses: Active - Normal, Active - Restored, Terminated - Lapsed, Terminated - Other,
   Terminated - Not Taken/Declined/Incomplete/Postponed/Withdrawn Owner.
3. **Policy detail**: https://partner.bannerlife.com/business/policy/{number}/detail (a full page
   load; use the navigate tool per policy). Fields: Status, Effective Date, Product, Face
   Amount, Billing Mode, Modal Premium, **Policy Paid To**, **Last Bill Generated Date**.
   Tabs: Beneficiaries, Documents (not yet explored), Relations, Agent Hierarchy, Notes.

Tool limit: Chrome JS results are capped at ~1,000 chars.

## Status mapping
| Carrier | Our value | Date |
|---|---|---|
| In Policies In Grace | `Lapse pending` | Paid To + 2 calendar months; already passed → today + 7 |
| Active - Normal / Active - Restored, not in grace | in force; pending recovers → NULL | — |
| Terminated - Lapsed | **covers both lapses and cancellations.** Open the detail: if Paid To + 2 months has passed → `Lapsed`; else → `Cancelled` (terminated while paid up) | Lapsed: the prior projection if the policy was `Lapse pending`, else Paid To + 2 months. Cancelled: the later of Paid To and Last Bill Generated |
| Terminated - Other | `Cancelled` (includes carrier fraud terminations) | the later of Paid To and Last Bill Generated |
| Terminated - Not Taken / Declined / Incomplete / Withdrawn Owner / Postponed | Snapshot rule if the DB has the policy as Issued | TBD |
| Issued, Not Paid (detail page; not on My Business List yet) | Snapshot rule. Not on Snapshot (approved 2026-10-04): status → `Incomplete`, `issue_date` → NULL, `application_notes` = "Issued, not paid" | — |

**Banner rewrites dates on termination.** After a lapse or cancel, many date fields get reset to
the issue date, so Paid To alone can be misleading. Use the later of Paid To and Last Bill
Generated (Andrew, 2026-10-04).

## Date sources
| Our need | Carrier field | Explicit or derived | Confirmed? |
|---|---|---|---|
| Lapse pending | Paid To + 2 months | derived | Yes (matches Andrew's existing data) |
| Cancelled | max(Paid To, Last Bill Generated) | derived | Yes |
| Lapsed | prior projection, else Paid To + 2 months | derived | Yes |

## Policy number display
`5001234567` (10 digits). Same as stored.

## Data hygiene (open)
- Fixed 2026-10-04: two tab-prefixed numbers trimmed; the missing number filled
  (5001500870); the wrong number `000963922` corrected to 5000963515 (same client and date).
- Duplicate-number cleanup 2026-10-04: Banner has one record per number; the DB twins were
  double entries. Kept the row matching Banner's details, deleted the other (5 rows). Rule
  going forward: a duplicate number → Flag; Andrew's merge rule is to delete the `not_in_opt`
  row, or if both came from Opt, keep the row that matches the carrier's details.
- The loaded list size varies between reads (1,149 then 1,199 rows). Read until "›" is
  disabled and compare against "Displaying x to y of N".
- 52 checkable DB policies don't appear in My Business List: 44 recent (50015x–50016x) plus
  5001069544, 5001140499, 5001297455, 5001307118, 5001319652, 5001358926,
  5001440034. Open: are recent issues listed under another type, or is something else wrong?

## Confidence: medium
First run applied 2026-10-04 (40 changes). Open: MFA/timeout, the 52 missing policies, the
Documents tab, and the hygiene items above. Andrew is calling Banner about the lapsed/cancelled
visibility.
