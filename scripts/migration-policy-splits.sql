-- policy_splits: shared production credit on a single policy between two or more
-- agents, replacing the old workaround of duplicating the policy row per agent.
--
-- Rows exist ONLY for split policies. An unsplit policy has no rows here and
-- credits 100% to policies.sfg_id (the primary / writing agent). When a policy
-- IS split, the rows are exhaustive — the primary gets a row too, and the
-- credit_pct values across one policy_id are expected to sum to 1.0.
--
-- credit_pct is the source of truth rather than per-agent dollar amounts: an app
-- is normally split while still Pending (issued_apv null) and the carrier issues
-- it weeks later at an amount that differs from what was submitted. Stored
-- dollars would go stale the moment the bulk importer writes the issued APV;
-- percentages follow it automatically.
--
-- Removing a split = delete every row for that policy_id. The policy reverts to
-- 100% primary with its own APV columns untouched.

CREATE TABLE IF NOT EXISTS public.policy_splits (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id  uuid NOT NULL REFERENCES public.policies(id) ON DELETE CASCADE,
  sfg_id     text NOT NULL,
  credit_pct numeric(6,5) NOT NULL CHECK (credit_pct > 0 AND credit_pct <= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_id, sfg_id)
);

CREATE INDEX IF NOT EXISTS policy_splits_policy_id_idx ON public.policy_splits (policy_id);
CREATE INDEX IF NOT EXISTS policy_splits_sfg_id_idx    ON public.policy_splits (sfg_id);

-- Mirrors public.policies: all access goes through api/ with the service role
-- key, which bypasses RLS. No client reads this table directly, so RLS is on
-- with no SELECT policy — nothing reaches it with the anon or authenticated key.
ALTER TABLE public.policy_splits ENABLE ROW LEVEL SECURITY;
