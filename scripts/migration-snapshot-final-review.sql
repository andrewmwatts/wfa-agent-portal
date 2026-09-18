-- Final Review: a second reconciliation pass between Disputes and Promotions
--
-- The Snapshot workflow gains a step:
--
--   1 Reconciliation  reconcile the DRAFT ledger; discrepancies become disputes or edits
--   2 Disputes        work the disputes with the carrier / Symmetry
--   3 Final Review    NEW -- reconcile the FINAL ledger, after the internal edits and the
--                     external disputes, to confirm the numbers align before Promotions
--   4 Promotions      (was step 3)
--
-- Final Review's results are kept apart from Step 1's on purpose. Disputes reference
-- snapshot_reconciliations rows (reconciliation_id), so a second pass written into that
-- same table would replace the very rows the disputes hang off, along with the
-- resolutions recorded on them.
--
-- Nothing has to be migrated: every existing cycle is closed at step 3 (Promotions under
-- the old numbering). The app opens a closed cycle on its last step and lets every step
-- be read, so those cycles keep landing on Promotions, and their Final Review is simply
-- empty.
--
-- Until this has been run the app still works: Step 1, Disputes and Promotions are
-- unaffected, and Final Review shows a notice pointing here instead of running.
-- Safe to run more than once.

begin;

-- 1. Same shape as Step 1's table. LIKE copies the columns, defaults, NOT NULL, CHECK
--    constraints and indexes -- but never foreign keys, so the cycle link is put back
--    below. Copying the shape rather than spelling the columns out keeps the two tables
--    identical without having to know every column of the original.
create table if not exists public.snapshot_final_reconciliations
  (like public.snapshot_reconciliations including all);

-- 2. Rows go when their cycle does, as they do for Step 1.
do $$
begin
  alter table public.snapshot_final_reconciliations
    add constraint snapshot_final_reconciliations_cycle_id_fkey
    foreign key (cycle_id) references public.snapshot_cycles(id) on delete cascade;
exception when duplicate_object then
  null;   -- already there
end $$;

-- 3. Every API route reaches this through the service-role key and authorises in
--    application code, matching the other snapshot tables: RLS on, no policy, no direct
--    access.
alter table public.snapshot_final_reconciliations enable row level security;

-- 4. snapshot_cycles.step now runs to 4. If the column carries a CHECK that stops at 3,
--    the "Proceed to Promotions" click would fail, so any check that mentions step is
--    replaced by one that allows 1-4. Found by shape rather than by name, as in the
--    cycle-scope migration. Does nothing if there is no such check.
do $$
declare
  c       record;
  dropped boolean := false;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class     rel on rel.oid = con.conrelid
      join pg_namespace ns  on ns.oid  = rel.relnamespace
     where ns.nspname  = 'public'
       and rel.relname = 'snapshot_cycles'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%step%'
  loop
    raise notice 'replacing check constraint % on snapshot_cycles', c.conname;
    execute format('alter table public.snapshot_cycles drop constraint %I', c.conname);
    dropped := true;
  end loop;

  if dropped then
    alter table public.snapshot_cycles
      add constraint snapshot_cycles_step_check check (step between 1 and 4);
  end if;
end $$;

commit;

-- ── Verification ─────────────────────────────────────────────────────────────
-- Expect: the new table has the same columns as the old one.
--
-- select column_name, data_type
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'snapshot_final_reconciliations'
--  order by ordinal_position;
--
-- Expect: a foreign key to snapshot_cycles, and no check on snapshot_cycles that stops at 3.
--
-- select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--  where conrelid in ('public.snapshot_final_reconciliations'::regclass,
--                     'public.snapshot_cycles'::regclass)
--    and contype in ('f', 'c');
