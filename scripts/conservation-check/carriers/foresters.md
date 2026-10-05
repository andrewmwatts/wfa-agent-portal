# Foresters / Foresters DFL
Portal: https://certdetmobile.foresters.com/Auth → Certificate List (`/m/certificates`)
API base: https://certdetmobileapi.foresters.com/api/ (Angular 18 app)
MFA: per session; the session times out (FRAMEWORK §5: first in the run order, Andrew present).
Hierarchy visibility: full (header "Watts, Kristina ,749650").
Browser: Kristina's Chrome profile (deviceId ac4e38f3…).

## Navigation
1. **Certificate List** (status ground truth). Material table built from div rows: read
   `[role=row]` → `[role=cell]`. Cells: [Certificate Number, Documents, Insured Name,
   Certificate Status, Product Category, Plan Description, App Signed Date, Certificate
   Effective Date, Paid to Date, Producer Number, Producer Name].
   - 25 rows per page, fixed. **Every page is a server call (~6 s)**, ~32 pages, ~3 min. Loop:
     click "Next page", wait until the first certificate number changes and the spinner is
     gone. Run it as a background async job on `window` and poll; a single awaited call times
     out at 45 s.
   - Header shows "x - y of N total"; assert unique (certificate, producer) rows ≈ N.
   - Export to CSV is allowed (Andrew) if paging becomes impractical.
2. **Documents API** (explicit dates). Auth header: `Authorization: 'Bearer ' +
   localStorage.authtoken`. Call `fetch` **without** `credentials: 'include'` (CORS).
   - List: `GET filenexus/GetList/{cert}` → `[{DocumentType, DocumentID}]`.
   - File: `GET filenexus/GetDocument/{cert}/{DocumentType with spaces and punctuation
     removed}/{DocumentID}` → PDF. Parse in-page with pdf.js (cdnjs).
   - "Notice of Pending Lapse Letter": "…not lapse your certificate if we receive … by
     **<date>**" → the lapse date.
   - "Lapse Notice": dated within ±2 days of the pending "by" date.
   - Other types: Returned Payment Letter, Billing Notice, Reinstatement Quote, Annual
     Statement, Certificate Issue Statement.
   - Never return the token or full URLs in tool output (it gets blocked).
3. **Certificate detail / transactions API** (for adding a missing policy):
   - `GET Certificate/GetCertDetail/{cert}`: InsuredFirstName/LastName, PlanDescription,
     CertificateEffDate, BaseModalPremium + BasePaymentMode, CoverageList (Base →
     CoverageAmount = face), ProducerDetailsList (writing producer, Share).
   - `GET CashTransValues/GetTransactionValues/{cert}/{producerNo 749650}/{fromISO}/{toISO}`
     → PaymentHistoryList [EffectiveDate, ProcessedDate, TransactionAmount]. Issue date =
     the earliest ProcessedDate ("Posted Date"; Andrew). Submit date = App Signed Date (grid).
   - Plan name mapping: "Strong Foundation -30 Year Term" → `Strong Foundation (30)`;
     "Advantage Plus II Whole Life …" → `Advantage Plus II Non DFL`. Issued APV = monthly × 12; leave submitted APV blank; set `not_in_opt = true` (Andrew).

## Status mapping
| Carrier status | Our value | Date |
|---|---|---|
| Active, Active - Preferred Draft Date | in force (ignore); pending recovers → NULL | — |
| Lapse Pending | `Lapse pending` | latest Pending Lapse notice "by" date; no notice yet → Paid to Date + 75 (Andrew) |
| Lapse Pending past its "by" date | keep `Lapse pending` | today + 7 (FRAMEWORK §4) |
| Lapsed | `Lapsed` | Pending notice "by" date; else the Lapse Notice letter date |
| Surrendered | `Cancelled` | Paid to Date (no letter exists; Andrew) |
| Rescinded | `Cancelled`, date NULL, `chargeback_exempt = true` (first seen 2026-10-03) | — |
| First Premium Pending | Snapshot rule. Not on Snapshot (approved 2026-10-03): status → `Incomplete`, `issue_date` → NULL, `application_notes` = "Issued, not paid (payment reversed)" | — |
| Declined, Not Taken, HO/Producer Withdrawn, Not Proceeded With, Canceled | Snapshot rule if the DB has the policy as Issued | TBD |
| Pending, Approved, Issued, Placed, Future Effective Date, Invalid | pre-issue; ignore | — |

Backlog finals from the first run: `chargeback_exempt = true`.

## Date sources
| Our need | Carrier field | Explicit or derived | Confirmed? |
|---|---|---|---|
| Lapse pending | Pending Lapse notice "by" date | explicit | Yes |
| Lapse pending, no notice yet | Paid to Date + 75 | derived | Yes |
| Lapsed | notice "by" date / Lapse Notice date | explicit | Yes |
| Cancelled (surrender) | Paid to Date | derived | Yes |

## Policy number display
`9999999` (7 digits; one `4875977`-style legacy number). Same as stored. One stored number has
a leading space (a Not taken policy; harmless).

## Split policies
One row per producer (15 seen). All agreed with each other and with `policy_splits`.

## Known exceptions
| Certificate | Situation |
|---|---|
| 9742625, 9742605, 9735605, 9735603, 9728824, 9717136, 9717141, 9708241, 9708242, 9701124, 9700795, 9700794, 9699166, 9699185, 9697365, 9697364 | Not in DB: agent joined WFA after issue (Scorza) |
| 9442161 | Not in DB: issued before the agent joined WFA (Henderson) |
| 9831692 | In DB, not at carrier: departed agent |
| 4875977 | Not in DB: issued 2012, before the agency existed; written by an outside producer |


Any other Active row not in the DB → Flag.

## Confidence: high
First run applied 2026-10-03 (21 conservation changes + 2 approved base-status corrections).
