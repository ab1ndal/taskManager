-- Enable RLS on all tables
ALTER TABLE workspaces        ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_assignments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_updates      ENABLE ROW LEVEL SECURITY;

-- workspaces: visible if user has a member row
CREATE POLICY "workspaces_select" ON workspaces
FOR SELECT USING (
  id IN (
    SELECT workspace_id FROM workspace_members
    WHERE auth_user_id = auth.uid()
  )
);

-- workspace_members: visible within shared workspaces
CREATE POLICY "workspace_members_select" ON workspace_members
FOR SELECT USING (
  workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE auth_user_id = auth.uid()
  )
);

-- tasks: visible/mutable if user has a task_assignment row
CREATE POLICY "tasks_select" ON tasks
FOR SELECT USING (
  id IN (
    SELECT ta.task_id FROM task_assignments ta
    JOIN workspace_members wm ON wm.id = ta.member_id
    WHERE wm.auth_user_id = auth.uid()
  )
);

CREATE POLICY "tasks_update" ON tasks
FOR UPDATE USING (
  id IN (
    SELECT ta.task_id FROM task_assignments ta
    JOIN workspace_members wm ON wm.id = ta.member_id
    WHERE wm.auth_user_id = auth.uid()
  )
);

CREATE POLICY "tasks_delete" ON tasks
FOR DELETE USING (
  id IN (
    SELECT ta.task_id FROM task_assignments ta
    JOIN workspace_members wm ON wm.id = ta.member_id
    WHERE wm.auth_user_id = auth.uid()
  )
);

-- tasks insert: user must be a workspace member
CREATE POLICY "tasks_insert" ON tasks
FOR INSERT WITH CHECK (
  workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE auth_user_id = auth.uid()
  )
);

-- task_assignments: see ALL assignments for tasks you are assigned to
-- (broader than spec — required for assignee_count > 1 shared detection)
CREATE POLICY "task_assignments_select" ON task_assignments
FOR SELECT USING (
  task_id IN (
    SELECT ta.task_id FROM task_assignments ta
    JOIN workspace_members wm ON wm.id = ta.member_id
    WHERE wm.auth_user_id = auth.uid()
  )
);

-- task_assignments insert/delete: user must be a member of the task's workspace
CREATE POLICY "task_assignments_insert" ON task_assignments
FOR INSERT WITH CHECK (
  member_id IN (
    SELECT wm2.id
    FROM workspace_members wm2
    JOIN tasks t ON t.workspace_id = wm2.workspace_id
    JOIN workspace_members wm ON wm.workspace_id = wm2.workspace_id
    WHERE wm.auth_user_id = auth.uid()
    AND t.id = task_id
  )
);

CREATE POLICY "task_assignments_delete" ON task_assignments
FOR DELETE USING (
  member_id IN (
    SELECT wm2.id
    FROM workspace_members wm2
    JOIN tasks t ON t.workspace_id = wm2.workspace_id
    JOIN workspace_members wm ON wm.workspace_id = wm2.workspace_id
    WHERE wm.auth_user_id = auth.uid()
    AND t.id = task_id
  )
);

-- task_updates: tied to task visibility
CREATE POLICY "task_updates_select" ON task_updates
FOR SELECT USING (
  task_id IN (
    SELECT ta.task_id FROM task_assignments ta
    JOIN workspace_members wm ON wm.id = ta.member_id
    WHERE wm.auth_user_id = auth.uid()
  )
);

CREATE POLICY "task_updates_insert" ON task_updates
FOR INSERT WITH CHECK (
  task_id IN (
    SELECT ta.task_id FROM task_assignments ta
    JOIN workspace_members wm ON wm.id = ta.member_id
    WHERE wm.auth_user_id = auth.uid()
  )
);
