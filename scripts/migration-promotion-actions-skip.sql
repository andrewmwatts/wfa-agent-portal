-- snapshot_promotion_actions: add support for persisted "Skip" actions on Step 3
-- of the Promotions workflow, and a `level` column so actions can be tied to a
-- specific track (contract level or leadership title) rather than just an agent.

ALTER TABLE public.snapshot_promotion_actions
  ADD COLUMN IF NOT EXISTS level text;

ALTER TABLE public.snapshot_promotion_actions
  DROP CONSTRAINT IF EXISTS snapshot_promotion_actions_action_type_check;

ALTER TABLE public.snapshot_promotion_actions
  ADD CONSTRAINT snapshot_promotion_actions_action_type_check
  CHECK (
    action_type = ANY (
      ARRAY[
        'qualifying_month'::text,
        'streak_reset'::text,
        'promotion'::text,
        'manual_promotion'::text,
        'skipped'::text
      ]
    )
  );
