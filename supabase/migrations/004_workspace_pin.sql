-- Add join_pin column
ALTER TABLE workspaces ADD COLUMN join_pin text;

-- Backfill existing rows
UPDATE workspaces
SET join_pin = LPAD(FLOOR(RANDOM() * 1000000)::bigint::text, 6, '0')
WHERE join_pin IS NULL;

-- Constraints
ALTER TABLE workspaces ALTER COLUMN join_pin SET NOT NULL;
CREATE UNIQUE INDEX workspaces_join_pin_key ON workspaces (join_pin);

-- Allow authenticated users to create workspaces
CREATE POLICY "workspaces_insert" ON workspaces
FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Allow authenticated users to add themselves to a workspace
-- (pin validation happens in the app layer before this insert is called)
CREATE POLICY "workspace_members_insert_self" ON workspace_members
FOR INSERT WITH CHECK (auth_user_id = auth.uid());
