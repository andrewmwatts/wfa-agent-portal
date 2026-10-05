# Fidelity & Guaranty (F&G)
Login: https://auth.fglife.com/u/login/password (Auth0; the `state=` URL param is per-session)
Portal: https://saleslink.fglife.com
MFA: TBD. Timeout: TBD.
Access: Andrew's login with an account grant to Kristina. **Check the agent dropdown (top
right) reads `000522814-WATTS KRISTINA K[FGL]`.** If it shows WATTS ANDREW: open
https://saleslink.fglife.com/Agent/AgentSelection, pick "000522814 - WATTS, KRISTINA K [A]",
Submit (Andrew-authorized), and continue. 010522814 is Kristina's annuity number; it has no
business, so ignore it.
Hierarchy visibility: full (downline included).
Browser: Kristina's Chrome profile (deviceId ac4e38f3…).

## Navigation
1. **Pending Lapse/Lapsed** (pending + lapse confirmation): https://saleslink.fglife.com/NewBusiness/PendLapse
   Frozen-column grid: left table [Writing Agent Name, Writing Agent #, Policy Number,
   Insured's Name] and right table [Insured's Phone, Bill Type, Notice Date, **Final Lapse
   Date**, Insured DOB, Face, Effective Date, Modal Premium]; pair rows by index.
   Bill Type `LAPSE PEND` = pending. Policies that lapse stay on this page for a while with a
   lapsed Bill Type, then drop off.
2. **Book of Business** (final statuses, esp. cancellations): https://saleslink.fglife.com/BookOfBusiness/Search
   Kendo grid; one search per Policy Status (set `#ddlPolicyStatus` via the kendo widget's
   `select()`, click Search, then `ds.query({pageSize: total})`). Don't trigger the widget's
   change event, which reloaded the page once. Statuses: Active, Pending Lapse, Lapsed,
   Cancelled, Surrendered, Death Claim, Death Claim Pending, Expired, Matured.
   Columns: PolicyNumber, Owner, PolicyStatus, ProductName, PolicyEffectiveDate, Agent,
   IssuedState. **No status date.** Not Taken / unpaid new business does not appear here
   (see Search New Business Policies).
3. **Chargeback Detail** (prorated chargeback amount only): https://saleslink.fglife.com/Tap/TAPReports?tapYear=2026
   → Chargeback Detail → Excel: `/TAP/DownloadTAPChargebackDetailReport?reportFormat=Excel2013`.
   Fetch in-page and parse with SheetJS (cdnjs). **The file's declared sheet range is wrong**:
   recompute `!ref` from the actual cells or you only get 2 rows. Columns: Direct Downline
   Agent/#, Writing Agent Name/#, Policy Number, Insured Name, Transaction Type (AR-TL,
   AR-QA, SV-TL, SV-QA; meaning unknown), Process Date, Annualized Life, Annualized Annuity.
   First-year chargebacks only; one policy can have several rows.

Tool limits: Chrome JS results are capped at ~1,000 chars, and results containing URL tokens
are blocked.

## Status mapping
| Carrier | Our value | Date |
|---|---|---|
| PendLapse `LAPSE PEND` | `Lapse pending` | Final Lapse Date (≈ Notice Date + 2 months) |
| PendLapse past its Final Lapse Date, still pending | keep `Lapse pending` | **today + 7** (re-evaluated each run; tells the agent "any day now") |
| PendLapse lapsed / Book of Business `Lapsed` | `Lapsed` | Final Lapse Date if known, else the window since the last check |
| Book of Business `Cancelled`, `Surrendered` | `Cancelled` | window since the last check (no status date) |
| Book of Business `Death Claim` | `Death` | window since the last check |
| Active | in force; pending recovers → NULL | — |

Backlog finals with no way to date them (first run): set the status and
`chargeback_exempt = true`, **leave `conservation_date` NULL** (Andrew: no date beats a
speculative one).

## Chargeback amount (F&G only)
When a policy newly lapses or cancels and appears in Chargeback Detail, write the report's
amount (Annualized Life, as a positive number) to `policies.snapshot_chargeback_apv`, **only if
that field is NULL**. Snapshot reconciliation also writes that field (with
`snapshot_chargeback_month`), so never overwrite it. No other carrier gets this. A blank field
means Snapshot assumes the full issued APV. Multiple rows for one policy → Flag for Andrew
(the transaction-type semantics are unknown).

## Date sources
| Our need | Carrier field | Explicit or derived | Confirmed? |
|---|---|---|---|
| Lapse pending | Final Lapse Date | explicit | Yes |
| Overdue pending | today + 7 | derived | Yes |
| Lapsed / Cancelled / Death | none; prior projection within the last-check window, else NULL | deduced | Yes |

## Policy number display
`LX999999`, `LZ999999`, `QT999999`. Same as stored.

## Quirks & gotchas
- Final statuses recorded before this card may differ from Book of Business wording (e.g.
  one policy is Cancelled at F&G but recorded as Lapsed). Andrew kept Lapsed; don't "correct"
  it.
- 5 checkable policies didn't appear in Book of Business under any status (2026-10-03); 4
  show non-Issued statuses in New Business. Andrew is asking F&G. Flag these until resolved.

## Confidence: medium-high
First run applied 2026-10-03 (5 changes). Open: MFA/timeout; the 5 missing policies.
