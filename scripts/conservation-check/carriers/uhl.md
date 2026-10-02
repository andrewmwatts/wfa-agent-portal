# United Home Life (UHL)
Portal: https://agentportal.unitedhomelife.com (Angular app; slow first load, ~10 s)
MFA: TBD (session already live in Kristina's Chrome on 2026-10-01); timeout behavior: TBD
Hierarchy visibility: full, once the view filters below are set.
Browser: Kristina's Chrome profile (Browser 2).

## Navigation
Two views. Both use Angular Material dropdowns: open the combobox, then pick the option by
accessibility ref (`find`). Screenshots time out while a dropdown overlay is open, so don't
take one then.

1. **Policies in Grace report** (pending lapse; explicit date):
   https://agentportal.unitedhomelife.com/reports/policiesInGrace
   - Set **Downline Selection** = "Agent and All Downlines" (default "Agent Only"; "Active
     Downlines" would drop departed agents).
   - Columns: Policy Number, Insured Name, Insured Phone, Plan Name, Policy Issue Date,
     Premium Paid to Date, Billing Mode, **System Expiry Date**, Writing Agent's Name.
   - Items per page 200; assert "1 – n of n".
2. **Policies grid** (final statuses): https://agentportal.unitedhomelife.com/policies
   - Edit filters → **View** = "My Expanded Hierarchy" (default "Myself").
   - **Date Range** start = 1/1/2022, end = **today** (the date filter is on Date Issued;
     the default is the last 12 months, which hides older policies). Type into the
     "Start date" textbox, then Tab.
   - 100 rows per page max; walk pages with "Next page" until "x – n of n" ends at n.
   - Columns: Writing Agent Code, Policy #, Insured Name, Status, Date Issued, Face Amount,
     Paid-to-date, State, Plan Name, Payment Frequency, Payment Mode, Annual Premium,
     Writing Agent. The download button exports the same columns, filtered the same way.
   - Pre-issue rows show Policy # "N/A"; skip them.

Tool limit: Chrome JS results are capped at ~1,000 chars. Accumulate rows on `window`,
match in the page, and read back only the differences.

## Status mapping
| Carrier | Our value | Date |
|---|---|---|
| On Policies in Grace | `Lapse pending` | System Expiry Date (explicit; normally paid-to + 2 calendar months, but can be extended, e.g. 12/15) |
| Active, not in grace | in force; pending recovers → NULL | — |
| Lapsed | `Lapsed` | prior projected date if it falls in (last check, today]; else best guess → Flag |
| Terminated | `Cancelled` (Andrew) | last Paid-to-date |
| Surrendered | `Cancelled` | last Paid-to-date |
| Death Claim | `Death` | last Paid-to-date |
| Not Taken | Snapshot rule → `Not Taken, On Snapshot` | Paid-to-date (= issue date on these rows); `chargeback_exempt = true` (Andrew) |
| Declined, Incomplete | Snapshot rule | TBD when first seen on an issued DB policy |

A past paid-to date on the grid is **not** a lapse signal by itself; only the grace report
counts (e.g. one Active policy was two years behind and is not in grace).

## Date sources
| Our need | Carrier field | Explicit or derived | Confirmed? |
|---|---|---|---|
| Lapse pending | System Expiry Date (grace report) | explicit | Yes |
| Lapsed | none; prior projection within the check window | deduced | Yes |
| Cancelled / Terminated / Surrendered / Death | last Paid-to-date | derived | Yes |
| Not Taken | Paid-to-date | derived | Yes |

No status-change date exists anywhere, so frequent checks keep the deduction window narrow.

## Policy number display
`A999999` (`U…` most, `W…` some). Same as stored; exact match works.

## Split policies
None seen yet.

## Carrier-specific flag rules
- Active on the grid with no DB row → Flag (2026-10-01: the one case was a DB row missing its
  policy number, since fixed; the modal now blocks Issued without a number).
- Lapsed with no prior projection in the window → Flag with a best-guess date.

## Confidence: high
First run applied 2026-10-01 (12 changes). Open: MFA/timeout.
