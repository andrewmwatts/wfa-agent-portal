-- accountability_rosters: per-owner call roster, persisted across sessions.
-- Delegates with accountability read permission can also access their principal's roster.

CREATE TABLE IF NOT EXISTS accountability_rosters (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_sfg_id text        NOT NULL,
  agent_sfg_id text        NOT NULL,
  added_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_sfg_id, agent_sfg_id)
);

CREATE INDEX IF NOT EXISTS idx_accountability_rosters_owner
  ON accountability_rosters (owner_sfg_id);

ALTER TABLE accountability_rosters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner and delegates manage roster"
ON accountability_rosters
FOR ALL
TO authenticated
USING (
  -- The owner themselves
  owner_sfg_id = (SELECT sfg_id FROM users WHERE id = auth.uid())
  OR
  -- A delegate with accountability read permission for this owner
  EXISTS (
    SELECT 1
    FROM agent_assistants aa
    JOIN assistant_permissions ap ON ap.agent_assistant_id = aa.id
    WHERE aa.agent_sfg_id     = owner_sfg_id
      AND aa.assistant_sfg_id = (SELECT sfg_id FROM users WHERE id = auth.uid())
      AND aa.is_active        = true
      AND ap.section          = 'accountability'
      AND ap.can_read         = true
  )
)
WITH CHECK (
  owner_sfg_id = (SELECT sfg_id FROM users WHERE id = auth.uid())
  OR
  EXISTS (
    SELECT 1
    FROM agent_assistants aa
    JOIN assistant_permissions ap ON ap.agent_assistant_id = aa.id
    WHERE aa.agent_sfg_id     = owner_sfg_id
      AND aa.assistant_sfg_id = (SELECT sfg_id FROM users WHERE id = auth.uid())
      AND aa.is_active        = true
      AND ap.section          = 'accountability'
      AND ap.can_read         = true
  )
);
