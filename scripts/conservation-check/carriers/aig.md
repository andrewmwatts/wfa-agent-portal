# AIG / Corebridge (DB carrier `American General`)
Portal: https://connext.corebridgefinancial.com/life/connext-bob/app/home (Book of Business)
MFA: per login; **Andrew logs in**.
Hierarchy visibility: **split across three logins**. Each agency owner's book shows only
under that owner's login: Terri Davis, Kristina Watts, Stephanie Jonas. Run all three.
Browser: Kristina's Chrome profile (deviceId ac4e38f3…).

## Method: the API, not the screens
The screens are slow and fragile: the detail URL holds an encrypted policy number, the
search box drops typed text, and the PDF icons only respond to a physical click. Use the
portal's own API instead, through `lib/aig-browser.js` (paste it into the page):
1. Open any policy detail page under the current login (search the BOB box once).
2. `await __aigInit()`: loads that page in a hidden iframe and copies the request headers
   (~25 s). Repeat after each new login.
3. `await __aigScan([numbers])` → `window.__aig[num]` = status, paid-to, payment declines,
   last bills, and every Inforce correspondence letter with its date and kind.
   About 2–5 s per letter.

Any policy in the login's hierarchy can be read by its plain number this way, including
policies the BOB list doesn't show. **Run order:** under each login, status-scan every
checkable AIG policy in the DB (`__aigPolicy` only; ~0.5 s each, other logins' policies
return null), then `__aigScan` just that login's hits with `lettersSince` ≈ 4 months back.
Keep each tool call under 45 s: start long loops as a promise on `window` and poll.
Policies with no number in the DB: search the insured's last name in the BOB box (it also
finds New Business rows, e.g. "Placed in Force").
`policyDetailsResponse.policy` also has issueDate, coverages (face, modal and annual
premium), agents (writing agent and percent), persons, and documentList.

## Statuses seen
| AIG | Our value | Date |
|---|---|---|
| Active, Active - Free Look, Active- Free Look Period | in force; pending recovers → NULL | — |
| Lapse Pending | `Lapse pending` | grace letter "not received by" date; no letter → paid-to + 30 (Andrew) |
| Conservation Pending (lapsed, still processing) | `Lapsed` | termination letter date; else paid-to + 30 |
| Lapsed | `Lapsed` | termination letter date |
| Reduced Paid Up (converted after termination) | `Lapsed` | termination date |
| Cancelled-FreeLook | Snapshot rule (Not Taken) | |
| Death Claim Paid | `Death` | "Pending Death Claim" letter date; no letter → paid-to date (Andrew) |
| Inforce first premium bounced | base-status correction (Andrew) | |

**AIG's status updates lag.** Andrew: corroborate with letters and payment dates. Don't
open every policy, but for any policy in conservation, read its letters.

**New Business tab "Placed in Force" only means sent to issue** (Andrew). The Inforce tab
shows the real state (e.g. "Pending Issue"). Don't move a DB `Pending` policy to `Issued`
on it.

## Letter kinds (`__aigKind`)
| Kind | Use |
|---|---|
| GRACE PERIOD NOTICE | "If this premium is not received by <date>" → lapse-pending date |
| NOTICE OF TERMINATION | lapse date = letter date |
| ABC removal ("removed … from the Automatic Bank Check") + reason "Pending Death Claim" | Death date = letter date |
| ABC removal, other reasons (returned draft, account closed) | billing trouble; check paid-to |
| RETURNED DRAFT ("debit item … has been returned unpaid") | billing trouble; a grace notice follows |
| Welcome letter ("graded death benefit") | ignore (mentions "death" in boilerplate) |
| REINSTATEMENT | a real offer follows a termination, but new policies' welcome packets also match ("reinstat" boilerplate): ignore it unless a TERMINATION precedes it |

Letter date = `documentCreatedDate` (sometimes 1 day after the date printed on the letter).

## Data the list gets wrong
- The BOB Inforce tab is enough (Andrew): skip New Business.
- Detail data says "current as of": it can be days stale.

## Policy number display
`6YY0NNNNNN` / `7YY0NNNNNN` (10 digits). Same as stored.

## Known exceptions
| Policy | Situation |
|---|---|
| (none yet) | |

## Confidence: medium
First run 2026-10-08/09 across all three logins (Terri, Kristina, Stephanie). The API method
was built on the death claims and used for Stephanie's whole book (9 policies, 4 changes).
