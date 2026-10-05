# American Amicable / Occidental (AmAm)
Root (agent e-file): https://www.americanamicable.com/cgi/agtefile/agtefile.exe?t=start
MFA: **every login** (the "MFA is coming" banner is stale; MFA is live). Session is stable once
in. Andrew must be present for login; then it can run unattended (FRAMEWORK §5 order #3).
Hierarchy visibility: full (manager view).
Browser: Kristina's Chrome profile (deviceId ac4e38f3…; the "Browser 1/2" labels swap between
sessions, so go by deviceId).

## Navigation
Start from the root page; links carry per-session tokens (`a=…`). The direct client-list URL
seemed stable across a reload, but the root page is the safe entry point.

1. **Client List** (status ground truth): root → "Client List" → View All.
   - One page, all policies, grouped by writing agent. Legend box shows a count per status and
     a Total Count; assert parsed rows === Total Count.
   - Row cells: [marker, Status, Policy, Name, DOB, Policy Date, Pdto/Rcvd]. **Pdto/Rcvd is
     cell 6** (cell 4 is DOB; don't confuse them).
2. **Online Policy Correspondence (last 30 days)**: root → "Online Policy Correspondence".
   Columns: Agent, Policy (number + insured), Date, Description (letter title). Use it to date
   status changes inside the window.
3. **Policy Correspondence (full history)**: root → "Policy Correspondence" → View. Pop-up
   list of daily batch PDFs (`agtefile.exe?t=display&a=…`), back to 2022 (~480 docs). Letters
   start "Re: Policy #<number>"; no titles. To search them: load pdf.js from cdnjs into the
   page (`import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs')`),
   fetch only the PDFs dated **paid-to − 30 → paid-to + 61 days** for the policies in question (a cancellation while current is dated before the paid-to date), extract
   text, find `Policy #<number>`, and classify by keywords. ~1 doc/sec.
   - The PDFs contain **letters only**: cancellation/surrender confirmations ("As requested, we
     have canceled…"), grace-period and returned-draft warnings. **Lapse notices are not in
     them** (verified 2026-10-02 against a known LAPSE NOTICE SENT date).
   - So for a Terminated policy: a cancellation letter in the window → `Cancelled` on the
     letter date; no cancellation letter (with or without grace / returned-draft warnings) →
     `Lapsed`.

Tool limits: Chrome JS results are capped at ~1,000 chars, and outputs that contain URL tokens
are blocked; never return hrefs. Accumulate on `window`, read back in chunks.

## Status mapping (Client List is the arbiter; correspondence dates it)
| Carrier status | Our value | Date |
|---|---|---|
| Active | in force; pending recovers → NULL | — |
| Act-Past due, Act-Ret Item | `Lapse pending` | Pdto + 60 days |
| Terminated, with LAPSE NOTICE SENT | `Lapsed` | document date |
| Terminated, with CASH SURRENDER / TERMINATE (incl. "No Cash Value") / NOT TAKEN / NTO / CANCELED | `Cancelled` | document date |
| Terminated, outside the 30-day list | search full-history PDFs (above): cancellation letter → `Cancelled` on letter date; none → `Lapsed` on **Pdto + 60** (Andrew). If Pdto + 60 is still in the future, it can't be a lapse → `Cancelled` on Pdto (Andrew, 2026-10-02). Backlog (first run): `chargeback_exempt = true` | letter date / Pdto |
| Death Claim | `Death` | Pdto (backlog); `chargeback_exempt = true` |
| Inf not taken, Not taken, Withdrawn, Declined, Iss not paid | Snapshot rule | TBD when first seen on an issued DB policy |

Ignore: "SEND POL.CANCEL REQ" (client asked to cancel; stays in force until paperwork is done),
bank-draft-returned letters on policies the Client List shows as Active (payment caught up, or
the system hasn't caught up yet; the status decides).

## Date sources
| Our need | Carrier field | Explicit or derived | Confirmed? |
|---|---|---|---|
| Lapse pending | Pdto/Rcvd + 60 | derived | Yes |
| Lapsed / Cancelled | correspondence document date | explicit | Yes |
| Lapsed, no lapse letter (PDF search) | Pdto + 60 | derived | Yes |
| Deaths (backlog) | Pdto/Rcvd | derived | Yes |

## Policy number display
`9999999999` (10 digits, leading zeros) and a few `999999999A` (e.g. trailing `U`). Same as
stored. The Correspondence list shows numbers with leading zeros too.

## Known "not in DB" exceptions (ignore)
| Policy number | Reason |
|---|---|
| 0114744550 | Departed agent; still in carrier hierarchy |
| 0111647260 | Agent joined WFA after issue; policies moved with her |
| 0056674810 | Agent joined WFA after issue; policies moved with her |

Any other Active / Act-* row not in the DB → Flag.

## Confidence: high
First run applied 2026-10-02 (23 changes).
