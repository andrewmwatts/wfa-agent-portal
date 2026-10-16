-- Leads: attempt tracking, "status changed" timestamp, CQF + carrier prep.
--
--   call_attempts / text_attempts  running totals, bumped by the "Log call / text attempt" buttons
--   last_attempt_at / _type        when and how the lead was last attempted
--   last_dispositioned_at          when the lead's status (disposition) last changed
--   cqf                            Client Qualification Form answers (jsonb, see CqfView.jsx)
--   carrier_prep                   agent's carrier choices + notes for the CQF (jsonb)
--
-- Run this BEFORE deploying the matching api/leads.js + Leads page changes.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS call_attempts         integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS text_attempts         integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at       timestamptz,
  ADD COLUMN IF NOT EXISTS last_attempt_type     text,
  ADD COLUMN IF NOT EXISTS last_dispositioned_at timestamptz,
  ADD COLUMN IF NOT EXISTS cqf                   jsonb,
  ADD COLUMN IF NOT EXISTS cqf_updated_at        timestamptz,
  ADD COLUMN IF NOT EXISTS carrier_prep          jsonb;

ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_last_attempt_type_check;
ALTER TABLE public.leads
  ADD CONSTRAINT leads_last_attempt_type_check
  CHECK (last_attempt_type IS NULL OR last_attempt_type IN ('call', 'text'));

-- Backfill from the existing activity log so current leads start with real numbers.
-- Every call/text entry counts as one attempt; the latest status entry is the last disposition.
WITH a AS (
  SELECT lead_id,
         count(*) FILTER (WHERE activity_type = 'call')                  AS calls,
         count(*) FILTER (WHERE activity_type = 'text')                  AS texts,
         max(created_at) FILTER (WHERE activity_type IN ('call', 'text')) AS last_attempt,
         max(created_at) FILTER (WHERE activity_type = 'status')          AS last_status
  FROM public.lead_activity
  GROUP BY lead_id
)
UPDATE public.leads l
SET call_attempts         = a.calls,
    text_attempts         = a.texts,
    last_attempt_at       = a.last_attempt,
    last_dispositioned_at = a.last_status
FROM a
WHERE a.lead_id = l.id;

UPDATE public.leads l
SET last_attempt_type = x.activity_type
FROM (
  SELECT DISTINCT ON (lead_id) lead_id, activity_type
  FROM public.lead_activity
  WHERE activity_type IN ('call', 'text')
  ORDER BY lead_id, created_at DESC
) x
WHERE x.lead_id = l.id;
