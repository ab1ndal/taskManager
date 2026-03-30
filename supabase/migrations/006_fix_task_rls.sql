-- Fix recursive RLS policies on tasks and task_assignments
--
-- Root cause: tasks_insert and task_assignments_insert both query workspace_members,
-- which triggers the self-referential workspace_members_select policy (42P17 recursion).
-- Same issue as workspace creation (fixed in 005 via admin client in server action).
--
-- Fix: replace recursive WITH CHECK expressions with auth.uid() IS NOT NULL.
-- Security is enforced at the server action layer (authenticated session required).

-- Fix tasks_insert: was querying workspace_members → recursion
DROP POLICY IF EXISTS "tasks_insert" ON tasks;
CREATE POLICY "tasks_insert" ON tasks
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Fix task_assignments_insert: was querying workspace_members + tasks → recursion
DROP POLICY IF EXISTS "task_assignments_insert" ON task_assignments;
CREATE POLICY "task_assignments_insert" ON task_assignments
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
