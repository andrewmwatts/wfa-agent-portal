# Americo
Portal URL / login page: https://account.americoagent.com/?returnUrl=https%3a%2f%2fportal.americoagent.com%2f
Data page: https://portal.americoagent.com/policies/search
MFA: none. Timeout: none observed / long enough for a run (Andrew, 2026-10-01). Can run unattended.
Hierarchy visibility: full — header reads "viewing data for (SFGLUW-335) (with Downline)".
Browser: Kristina's Chrome profile (Browser 2).

## Navigation
1. Open the Search page. Do not touch "Act As Self" or the view-as-agent controls.
2. Assume the page is in its **initial state**. Verify via the page global `criteriaDW`:
   `PolicyStatusCodeFilter`, `ProductFilter`, `Insured_PolicyFilter`, `StartDate`, `EndDate`
   all empty and `IncludeDownline === true`. If not → **stop and flag for Andrew** (don't
   clear filters unasked).
3. Load every row in one call (read-only, server paging):
   ```js
   const ds = jQuery('[data-role=grid]').data('kendoGrid').dataSource
   await ds.query({ page: 1, pageSize: Math.max(ds.total(), 1000) + 100 })
   ```
   Then assert `ds.data().length === ds.total()`; if not → flag (don't trust a partial list).
   This replaces Andrew's manual filter + sort steps and has no page-count limit.
4. Row fields: `PolicyNumber`, `PolicyStatus`, `PolicyStatusCode`, `StatusDate`,
   `ReceivedDate`, `EffectiveDate`, `TerminatedDate`, `AgentNumber`, `AgentStatCode`.
   No paid-to/bill date in the grid.
5. Tool limit: Chrome JS results are capped at ~1,000 chars. Do the matching in the page
   (inject the DB's checkable numbers) and read back only differing rows, in chunks.

Andrew's manual method (for reference): Policy Status filter (top of page, not the grid
header) → expand Completed → Lapsed + Surrendered; sort Terminated Date desc for changes since
last check. Then switch filter to Lapse Pending and read Status Date.

## Status mapping
| Carrier wording (code) | Our value | Notes |
|---|---|---|
| Active (inforce) (1), Free Look (50) | in force → pending statuses recover to NULL | |
| Lapse Pending (42) | `Lapse pending` | date = Status Date + 45 |
| Lapsed (4) | `Lapsed` | Terminated Date |
| Surrendered (6) | `Cancelled` | Terminated Date (Andrew) |
| Death Claim Paid (11) | `Death` | **Status Date** (Andrew) |
| Carrier declined to issue (27), DNQ (109) | Snapshot rule → `Declined, On Snapshot` / status `Declined` | Terminated Date |
| HO Withdrew (59) | Snapshot rule → `Withdrawn, On Snapshot` / status `Withdrawn` | Terminated Date |
| No Premium - Incomplete (1007) | Only if DB base status is `Issued` (otherwise leave as is). On Snapshot: Status Date + 45 still in the future → `First Premium Not Paid` (date = Status Date + 45); already passed → `Not Taken, On Snapshot` (date = Terminated Date). Not on Snapshot → propose status `Incomplete` (approval). | Andrew |
| Incomplete (23) | Only if DB base status is `Issued`: `Not Taken, On Snapshot`, date = **Status Date**, `chargeback_exempt = true` (Andrew) | otherwise leave as is |
| Extended Term (18), Terminated - Extended Term Insurance (1011), Reduced Paid Up (20) | no change (ignore) | Andrew: likely not chargebacks; revisit if evidence appears |
| Cancelled (7, 65), Canceled (39) | TBD | none currently on a checkable DB policy |
| Applied For (21), Pending Outstanding Requirements (54) | n/a (pre-issue) | |

## Date sources
| Our need | Carrier field | Explicit or derived | Confirmed? |
|---|---|---|---|
| Termination date (Lapsed, Cancelled, Death, Declined/Withdrawn) | Terminated Date | explicit | Yes (Lapsed/Surrendered) |
| Lapse-pending projected date | Status Date (= missed payment) + 45 | derived | Yes |
| FPNP projected date | Status Date + 45 | derived | Yes |
| Death date | Status Date | explicit | Yes |

## Policy number display
`AA99999999` — identical to stored format; exact match works.

## Split policies
One number, one row per agent (2 cases seen; both rows agree). DB holds one row + `policy_splits`.

## Quirks & gotchas
- Status wording has two Cancelled codes (7, 65) plus a "Canceled" (39) — map by code, not text.
- Grid includes many policies that never reached our DB (mostly declines/incompletes):
  891 carrier rows vs 441 DB rows. "Not in DB" flags should be limited (see below).
- The page keeps whatever filter a human last applied; the criteria check in Navigation
  step 2 catches that.

## Carrier-specific rules
- **Chargeback exemption override:** for FPNP / `Not Taken, On Snapshot` from code 1007, set
  `chargeback_exempt = true` when the carrier Status Date is before 2026-07-01 (Andrew).
- **"Not in DB":** ignore unmatched carrier rows unless the status is Active (inforce) (code 1).
  Most are instant declines never logged internally. Known exceptions are listed below by
  policy number (Andrew: track by number, keep everything in this card).

### Known "not in DB" exceptions (ignore)
| Policy number | Reason |
|---|---|
| AM03656810 | Agent left WFA; still in carrier hierarchy |
| AM03649687 | Agent left WFA; still in carrier hierarchy |
| AM03627571 | Agent left WFA; still in carrier hierarchy |
| AM03625584 | Agent left WFA; still in carrier hierarchy |
| AM03360489 | Agent left WFA; still in carrier hierarchy |

Any other Active row not in the DB → **Flag** for Andrew's review; he adds it here if it's
another departed-agent case.
- **"Not at carrier":** ignore. The portal occasionally drops policies (Andrew).

## Confidence: high
First run applied 2026-10-01 (29 changes; report in `conservation-checks/reports/`).
