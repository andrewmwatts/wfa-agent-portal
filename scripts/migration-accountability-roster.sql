-- accountability_rosters: per-user call roster, persisted across sessions

CREATE TABLE IF NOT EXISTS accountability_rosters (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sfg_id text        NOT NULL,
  agent_sfg_id text        NOT NULL,
  added_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_sfg_id, agent_sfg_id)
);

-- Index for fast per-owner roster fetches
CREATE INDEX IF NOT EXISTS idx_accountability_rosters_owner
  ON accountability_rosters (owner_sfg_id);

-- RLS: each user can only read/write their own roster rows
ALTER TABLE accountability_rosters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manages own roster"
ON accountability_rosters
FOR ALL
TO authenticated
USING (
  owner_sfg_id = (
    SELECT sfg_id FROM personnel WHERE auth_uid = auth.uid()
  )
)
WITH CHECK (
  owner_sfg_id = (
    SELECT sfg_id FROM personnel WHERE auth_uid = auth.uid()
  )
);
