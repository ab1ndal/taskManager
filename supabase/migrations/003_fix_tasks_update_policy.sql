-- Recreate tasks_update policy with explicit WITH CHECK to prevent workspace_id changes
DROP POLICY IF EXISTS "tasks_update" ON tasks;

CREATE POLICY "tasks_update" ON tasks
FOR UPDATE
USING (
  id IN (
    SELECT ta.task_id FROM task_assignments ta
    JOIN workspace_members wm ON wm.id = ta.member_id
    WHERE wm.auth_user_id = auth.uid()
  )
)
WITH CHECK (
  id IN (
    SELECT ta.task_id FROM task_assignments ta
    JOIN workspace_members wm ON wm.id = ta.member_id
    WHERE wm.auth_user_id = auth.uid()
  )
);
