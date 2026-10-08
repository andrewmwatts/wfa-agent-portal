-- Activity Tracking: "No Shows" metric on the daily log.
ALTER TABLE public.activity_logs
  ADD COLUMN IF NOT EXISTS no_shows integer NOT NULL DEFAULT 0;

-- 90-Day Plan, section 3 (Commitment): hours/days per week and weekly lead spend.
ALTER TABLE public.ninety_day_plans
  ADD COLUMN IF NOT EXISTS commitment_hours text,
  ADD COLUMN IF NOT EXISTS commitment_lead_spend text;
