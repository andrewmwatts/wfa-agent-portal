-- Multi-owner Snapshot cycles
--
-- A cycle used to be "the reconciliation for month M", one per month, implicitly
-- covering the entire master agency. It now becomes "one owner's reconciliation
-- run for month M, covering the baseshops they selected", so an agency owner can
-- work their own agency while their upline works the rest of the same month.
--
-- Agency owners partition the hierarchy (every agent sits in exactly one owner's
-- baseshop), so a cycle's scope is a set of owner sfg_ids and two cycles overlap
-- only when they name a common owner. Overlap is deliberately allowed and warned
-- about in the app rather than blocked here -- an owner may legitimately hand a
-- leg back to their upline mid-month.
--
-- Legacy rows: the cycles that already exist predate this and covered everything.
-- They are left with a NULL owner_sfg_id and no scope rows, which the app reads
-- as "unscoped -- show whatever the viewer is entitled to see". All of them are
-- already closed, so nothing will be added to them.

begin;

-- 1. Whose cycle this is. created_by (already present, text -> personnel.sfg_id)
--    records who physically ran it, which differs whenever a super_admin or a
--    delegate runs a cycle on an owner's behalf.
alter table public.snapshot_cycles
  add column if not exists owner_sfg_id text references public.personnel(sfg_id);

comment on column public.snapshot_cycles.owner_sfg_id is
  'Agency owner this cycle belongs to. NULL on legacy pre-scoping cycles.';
comment on column public.snapshot_cycles.created_by is
  'sfg_id of whoever actually ran the cycle -- may differ from owner_sfg_id.';

-- 2. More than one cycle per month is now legitimate, so the unique constraint
--    on month has to go. Found by shape rather than by name so this works
--    regardless of what the constraint ended up being called.
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class     rel on rel.oid = con.conrelid
      join pg_namespace ns  on ns.oid  = rel.relnamespace
     where ns.nspname   = 'public'
       and rel.relname  = 'snapshot_cycles'
       and con.contype  = 'u'
       and (select array_agg(att.attname::text order by att.attname::text)
              from unnest(con.conkey) k
              join pg_attribute att
                on att.attrelid = con.conrelid and att.attnum = k)
           = array['month']::text[]
  loop
    raise notice 'dropping unique constraint % on snapshot_cycles(month)', c.conname;
    execute format('alter table public.snapshot_cycles drop constraint %I', c.conname);
  end loop;
end $$;

-- Keep month lookups fast now that it is no longer uniquely indexed.
create index if not exists snapshot_cycles_month_idx
  on public.snapshot_cycles (month);

-- 3. Which baseshops a cycle covers. One row per selected owner; the agents are
--    derived from the hierarchy at read time rather than materialised here, so a
--    roster change does not have to be mirrored into this table.
create table if not exists public.snapshot_cycle_scopes (
  id           uuid primary key default gen_random_uuid(),
  cycle_id     uuid not null references public.snapshot_cycles(id) on delete cascade,
  owner_sfg_id text not null references public.personnel(sfg_id),
  created_at   timestamptz not null default now(),
  -- Guards against selecting the same baseshop twice in one cycle. Intentionally
  -- NOT unique on (month, owner) -- cross-cycle overlap is warned, not blocked.
  unique (cycle_id, owner_sfg_id)
);

create index if not exists snapshot_cycle_scopes_cycle_idx
  on public.snapshot_cycle_scopes (cycle_id);
create index if not exists snapshot_cycle_scopes_owner_idx
  on public.snapshot_cycle_scopes (owner_sfg_id);

-- Every API route reaches this through the service-role key and authorises in
-- application code, matching policy_splits: RLS on, no policy, no direct access.
alter table public.snapshot_cycle_scopes enable row level security;

commit;

-- ── Optional backfill ────────────────────────────────────────────────────────
-- Only needed if you want the three historical cycles attributed rather than
-- left as legacy/unscoped. Set the owner, then give them the full owner list.
--
-- update public.snapshot_cycles
--    set owner_sfg_id = 'SFG0049415'   -- Kristina Watts
--  where owner_sfg_id is null;
--
-- insert into public.snapshot_cycle_scopes (cycle_id, owner_sfg_id)
-- select c.id, o.sfg_id
--   from public.snapshot_cycles c
--   cross join (values ('SFG0049415'), ('SFG0061018'),
--                      ('SFG0065802'), ('SFG0093708')) as o(sfg_id)
--  where c.owner_sfg_id is not null
-- on conflict (cycle_id, owner_sfg_id) do nothing;

-- ── Verification ─────────────────────────────────────────────────────────────
-- Expect: no unique constraint or index left on snapshot_cycles(month).
--
-- select con.conname, con.contype
--   from pg_constraint con
--   join pg_class rel on rel.oid = con.conrelid
--  where rel.relname = 'snapshot_cycles' and con.contype = 'u';
--
-- select indexname, indexdef from pg_indexes
--  where tablename = 'snapshot_cycles';
