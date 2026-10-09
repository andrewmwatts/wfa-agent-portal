# TransAmerica
Login: https://secure.transamerica.com/login/sign-in/login.html
Portal: https://lifeaccess.transamerica.com/app/lifeaccess (React; slow, 10–60 s per view)
MFA: occasional; session times out (FRAMEWORK §5, run order #2).
Hierarchy visibility: full. Leave the "Select an agent" dropdown empty; the whole agency's
book loads after a delay.
Browser: Kristina's Chrome profile (deviceId ac4e38f3…). **Keep the working tab in the
foreground**: background tabs get throttled and the detail data never loads.

## Navigation
1. **Book of Business, Inforce tab**: https://lifeaccess.transamerica.com/app/lifeaccess#/display/PolicyList?type=inforce
   - Includes Active, Active - Premium Due, Lapsed, Terminated, Surrendered, Free Look
     Surrender, Initial Premium Not Paid, Paid Up - Non-forfeiture Option.
   - Columns: Status, Policy Number, Owner Name, Product Type, Issue State, Face Amount,
     Premium, **Premium Due Date** (= paid-to; can be stale), Expiry Date, VIEW.
   - 50 per page, ~4 pages: click page numbers at the bottom (synthetic key/clicks on the
     pager were unreliable; coordinate clicks worked). Assert "Showing … of N".
   - "Download List" exists (not yet used).
2. **Policy Alerts** (bell icon): `#/display/policyalerts?statusGroupFilter=All policy alerts`.
   ~30 days of alerts: Grace/Lapse Letter, Reversed premium payment, Lapse notice, Billing
   Notice, Policy removed from AutoPay, New document, pending requirement.
3. **Policy detail**: VIEW opens a new tab with an opaque ID in the URL (not the policy number).
   To reuse one tab: hook `window.open` on the list page to capture the detail URL, then
   `location.href = url; location.reload()` (a hash change alone doesn't load data). Data
   loads slowly; click a tab, wait ~10 s, and click again if it's empty.
   - **Payment** tab: Type, Frequency, Billed Premium, Premium Due, Last Payment Received,
     Last Payment Amount, **Grace Period Ends**.
   - **Correspondence** tab: rows (Date, Type). VIEW on a "Grace/Lapse Letter" calls
     `window.open(pdfUrl)`: capture the URL, `fetch` it and parse with pdf.js (cdnjs). The
     letter's dates are [letter date, lapse-by date]: "If we don't receive the full payment by
     <date> your policy will lapse".
   - **Transactions** tab: payment history (useful when Payment is blank on terminated policies).

## Status mapping
| TransAmerica | Our value | Date |
|---|---|---|
| Active - Premium Due | `Lapse pending` | Grace/Lapse letter's lapse-by date; else Grace Period Ends; if passed → today + 7 |
| Active, but an alert (Grace/Lapse letter, reversed payment, lapse notice) or the detail page shows > 14 days past due | `Lapse pending` ("hidden" pending; Andrew) | same as above |
| Active, paid current (detail Premium Due ≥ today) | in force; pending recovers → NULL | — |
| Lapsed | `Lapsed` | Paid-to + 60 (Andrew); if that's in the future, use the lapse-notice alert date |
| Terminated, Surrendered | `Cancelled` (Andrew treats them the same) | paid-to |
| Paid Up - Non-forfeiture Option (auto extended term after a lapse) | `Lapsed` | the conversion letter date |
| Initial Premium Not Paid | `First Premium Not Paid` on Snapshot; else base status `Incomplete` | |
| Free Look Surrender | Snapshot rule (not taken) | TBD |

## Policy number display
`FEX999999`, `FEXB999999`, `IULA999999`, `LFT999999`, `6602999999`. Same as stored.

## Known exceptions
| Policy | Situation |
|---|---|
| FEXB281489 | In DB, not visible anywhere at TransAmerica (Andrew searched; don't dig further) |
| FEXB359961 | Active but ~2½ months behind, with a new policy packet 9/28. Leave as is; recheck next run |

## Run notes
- Enter Life Access via Agent Home (https://secure.transamerica.com/agenthome/) → "Launch" on
  Transamerica Life Access. Going straight to lifeaccess after a session expiry lands on an
  employee login page.
- The list's Premium Due Date is often stale. On 2026-10-07, 4 policies that looked 2–3 weeks
  overdue on the list were all paid current on their detail pages. Only treat a policy as
  hidden-pending after checking the detail page.
- Searching the list works with real typing + Return (computer tool). Synthetic key events
  don't trigger it, and the list resets the search box while it's still loading.

## Confidence: medium-high
First run applied 2026-10-07 (13 changes); overdue checks finished 2026-10-08 (no further
changes). The detail pages are slow; a full run needs a foreground tab and patience.
