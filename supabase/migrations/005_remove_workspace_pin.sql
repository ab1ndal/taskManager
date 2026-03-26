-- Phase 1: Remove PIN-based workspace join system
-- Replaces the approach introduced in 004_workspace_pin.sql

-- Drop the unique index first (required before dropping the column)
DROP INDEX IF EXISTS workspaces_join_pin_key;

-- Drop the join_pin column
ALTER TABLE workspaces DROP COLUMN IF EXISTS join_pin;

-- Drop the old insert policy that was added alongside join_pin
-- (it allowed any authenticated user to create workspaces — recreated below with same semantics, clean name)
DROP POLICY IF EXISTS "workspaces_insert" ON workspaces;

-- Re-add insert policy: authenticated users can create workspaces (no PIN required)
CREATE POLICY "workspaces_insert" ON workspaces
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- workspace_members_insert_self already exists from 004 — do NOT recreate it
-- (it's still needed for both create-then-join-self and the new joinWorkspaceByDirectory flow)
