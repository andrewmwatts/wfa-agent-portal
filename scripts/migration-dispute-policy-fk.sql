-- snapshot_disputes.policy_id → policies.id currently has no ON DELETE action,
-- so Postgres blocks deleting any policy a dispute references:
--
--   update or delete on table "policies" violates foreign key constraint
--   "snapshot_disputes_policy_id_fkey" on table "snapshot_disputes"
--
-- which surfaces in the portal as a generic "Failed to delete policy". It also
-- blocks merging duplicated split policies, since that deletes the duplicate row.
--
-- SET NULL rather than CASCADE: a dispute is an audit record of a reconciliation
-- action and keeps its agent, amount, notes and outcome when the policy goes
-- away — it just loses the policy link. Step 2 already renders a dispute with no
-- linked policy. CASCADE would silently erase dispute history on policy cleanup.

ALTER TABLE public.snapshot_disputes
  DROP CONSTRAINT IF EXISTS snapshot_disputes_policy_id_fkey;

ALTER TABLE public.snapshot_disputes
  ADD CONSTRAINT snapshot_disputes_policy_id_fkey
  FOREIGN KEY (policy_id) REFERENCES public.policies(id) ON DELETE SET NULL;
