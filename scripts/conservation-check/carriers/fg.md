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
4. **New Business** (unpaid issues). Go straight to the details page in its wider "Recent
   Activity" view:
   https://saleslink.fglife.com/NewBusiness/NewBusinessDetails?associatedAgentNumber=000522814&lineOfBusiness=Both&IsRecentActivity=True
   (`IsRecentActivity=False` = "Current Inventory", a smaller subset; the Overview page
   `/NewBusiness/NewBusinessSummary` only has counts and View links.)
   - Kendo grid `#GridPolicyStatus`, all rows client-side (94 on 2026-10-08):
     `$('#GridPolicyStatus').data('kendoGrid').dataSource.data().toJSON()`. Fields:
     PolicyNumber, InsNm, NoOfOpenReq, **Status**, WrtAgtNm, WritingAgentNumber, FaceAmt,
     AnnualPremium, PrdNm. **No status date** (LastUpdDt is always empty).
   - Statuses: Pending (pre-issue), Open Requirement, Waiting For Buy Date, **Pending Delivery
     Requirement** (issued, something outstanding before delivery; often the first premium), Issued/Paid, Closed/Cancelled.
   - **Don't click the "+" in the first column**: it adds the policy to the Policy Watch List
     (a change on F&G's side).
   - **Policy detail** (Policy Information + Requirements + Notes): clicking the policy number
     swaps the list for a detail panel without changing the URL. Return with "Back to Policy
     List" (the browser Back button leaves the page). Scripted, read-only:
     `ShowPolicyDetails(null, 'QT002752', false, '000522814')` (the page's own function; it
     POSTs `/NewBusiness/PolicyInfo` and renders into `.policyDetail`), wait ~3 s, then read
     the kendo grids inside `.policyDetail`: `#gridRequirementInfo` (RequirementDescription,
     DateOrdered, DateReceived (null = open), Category) and `#gridNoteInfo` (DateCreation,
     Notes). Status, Issue Date, Last Updated and Days in Current Status are in the panel text.
     `HidePolicyDetail()` returns to the list. ~5 s per policy; run a few per call (45 s limit).
   - **"Pending Delivery Requirement : Conditionally Issued" is not always an unpaid first
     premium** (Andrew): it can be any requirement for delivery. Read the open requirements
     and notes. Signs of an unpaid first premium: open "Additional Premium Required", notes
     "A RETURN ITEM WAS RECEIVED FOR INSUFFICIENT FUNDS…", "Initial premium is being hand
     drafted". A long "Days in Current Status" (e.g. 59) also means the first payment never
     landed, even if the only bounce note is for a later draft (Andrew, LX567866). Either way
     it gets `First Premium Not Paid`.
   - **Issue date:** keep the DB's date when it's the planned first-draft date. A policy can
     issue earlier (Issue Date in F&G) but only goes into force on the draft date; that's the
     date we store (Andrew, 2026-10-08). Don't "correct" it to F&G's Issue Date.
   A policy stays here, not in Book of Business, until its first premium is paid. The F&G rep
   said that takes at most ~90 days.
   **Run step (Andrew, 2026-10-08):** any DB `Issued` policy missing from Book of Business →
   look it up here and compare its status with the DB. A policy can silently fall back to a
   problem state after we've recorded it as issued.

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
| New Business Issued/Paid | in force (matches DB Issued) | — |
| New Business Closed/Cancelled, DB Issued | Snapshot rule (Not Taken); date from Andrew/F&G | |
| New Business Pending Delivery Requirement, detail shows the first premium unpaid (issued in our DB) | `First Premium Not Paid` (on Snapshot; else base-status correction for approval) | **issue date + 90** (provisional, from the F&G rep; refine as data comes in). Already passed → today + 7 |
| In New Business, Not Taken | `Not Taken, On Snapshot` | the not-taken date (from F&G) |

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
- Resolved 2026-10-08 (Andrew called F&G): the 5 policies missing from Book of Business were
  stuck in New Business because their first payment never went through. 2 Not Taken, 3
  First Premium Not Paid (dated issue + 90; one already past → today + 7).

## Confidence: medium-high
First run applied 2026-10-03 (5 changes), plus the 5 New Business policies 2026-10-08.
New Business mapped 2026-10-08. Open: MFA/timeout; dating Pending Delivery Requirement
policies (no date anywhere yet).
