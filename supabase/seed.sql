-- =============================================================================
-- Seed data for local development and testing
-- Run via: supabase db seed  (or paste into the Supabase SQL editor)
--
-- Covers:
--   2 workspaces (household + work)
--   2 users (Alice, Bob)
--   personal tasks, shared tasks, subtasks, recurring, completed, overdue
--   task updates, per-user priority ordering
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Clean slate (order matters — child tables first)
-- -----------------------------------------------------------------------------
truncate table
  task_updates,
  task_assignments,
  tasks,
  task_rules,
  workspace_members,
  workspaces
restart identity cascade;

-- Remove seed auth users if re-running
delete from auth.users
where id in (
  'a0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000002'
);

-- =============================================================================
-- Auth users
-- =============================================================================
insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_user_meta_data,
  created_at,
  updated_at
) values
  (
    'a0000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'alice@example.com',
    '',
    now(),
    '{"name":"Alice"}'::jsonb,
    now(),
    now()
  ),
  (
    'a0000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'bob@example.com',
    '',
    now(),
    '{"name":"Bob"}'::jsonb,
    now(),
    now()
  );

-- =============================================================================
-- Workspaces
-- =============================================================================
insert into workspaces (id, name, kind) values
  ('b0000000-0000-0000-0000-000000000001', 'Home',       'household'),
  ('b0000000-0000-0000-0000-000000000002', 'Acme Corp',  'work');

-- =============================================================================
-- Workspace members
--   Alice is in both workspaces; Bob is in the household workspace only.
-- =============================================================================
insert into workspace_members (id, workspace_id, auth_user_id, display_name, role) values
  -- Household
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Alice',  'admin'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'Bob',    null),
  -- Work
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Alice',  'admin');

-- =============================================================================
-- Task rules (recurring)
-- =============================================================================
insert into task_rules (
  id,
  workspace_id,
  title,
  description,
  frequency,
  interval_count,
  next_run_at,
  is_active,
  default_due_offset_hours
) values (
  'd0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000001',
  'Weekly groceries',
  'Stock up on household essentials',
  'weekly',
  1,
  now() + interval '3 days',
  true,
  24
);

-- =============================================================================
-- Tasks
--
-- Deadline colour reference (today = 2026-03-04):
--   overdue  → due_at in the past
--   yellow   → due within 24 h
--   green    → due further out, or no deadline
--   grey     → completed_at is set
-- =============================================================================
insert into tasks (
  id,
  workspace_id,
  parent_task_id,
  rule_id,
  title,
  description,
  due_at,
  completed_at,
  created_by_member_id
) values

  -- ── Household tasks ────────────────────────────────────────────────────────

  -- T1: personal, no deadline (Alice)
  (
    'e0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    null, null,
    'Buy groceries',
    'Milk, eggs, bread, coffee',
    null, null,
    'c0000000-0000-0000-0000-000000000001'
  ),

  -- T2: shared Alice + Bob, overdue
  (
    'e0000000-0000-0000-0000-000000000002',
    'b0000000-0000-0000-0000-000000000001',
    null, null,
    'Fix the kitchen leak',
    'Water dripping under the sink — needs a plumber or new seal',
    '2026-03-01 12:00:00+00', null,
    'c0000000-0000-0000-0000-000000000001'
  ),

  -- T3: completed (Alice)
  (
    'e0000000-0000-0000-0000-000000000003',
    'b0000000-0000-0000-0000-000000000001',
    null, null,
    'Pay utility bills',
    null,
    '2026-03-03 23:59:00+00',
    '2026-03-02 10:00:00+00',
    'c0000000-0000-0000-0000-000000000001'
  ),

  -- T4: parent task with subtasks (Alice), no deadline
  (
    'e0000000-0000-0000-0000-000000000004',
    'b0000000-0000-0000-0000-000000000001',
    null, null,
    'Deep-clean living room',
    null,
    null, null,
    'c0000000-0000-0000-0000-000000000001'
  ),

  -- T4-A: subtask of T4
  (
    'e0000000-0000-0000-0000-000000000005',
    'b0000000-0000-0000-0000-000000000001',
    'e0000000-0000-0000-0000-000000000004', null,
    'Move furniture',
    null,
    null, null,
    'c0000000-0000-0000-0000-000000000001'
  ),

  -- T4-B: subtask of T4 (completed)
  (
    'e0000000-0000-0000-0000-000000000006',
    'b0000000-0000-0000-0000-000000000001',
    'e0000000-0000-0000-0000-000000000004', null,
    'Vacuum carpets',
    null,
    null,
    '2026-03-03 14:00:00+00',
    'c0000000-0000-0000-0000-000000000001'
  ),

  -- T5: recurring instance (Alice, linked to rule)
  (
    'e0000000-0000-0000-0000-000000000007',
    'b0000000-0000-0000-0000-000000000001',
    null,
    'd0000000-0000-0000-0000-000000000001',
    'Weekly groceries — 2026-03-04',
    'Generated by recurring rule',
    '2026-03-05 20:00:00+00', null,
    'c0000000-0000-0000-0000-000000000001'
  ),

  -- ── Work tasks ─────────────────────────────────────────────────────────────

  -- T6: due within 24 h (yellow)
  (
    'e0000000-0000-0000-0000-000000000008',
    'b0000000-0000-0000-0000-000000000002',
    null, null,
    'Submit Q1 report',
    'Finance needs it by end of day',
    '2026-03-04 18:00:00+00', null,
    'c0000000-0000-0000-0000-000000000003'
  ),

  -- T7: future deadline (green)
  (
    'e0000000-0000-0000-0000-000000000009',
    'b0000000-0000-0000-0000-000000000002',
    null, null,
    'Prepare sprint retrospective',
    'Gather team feedback and action items',
    '2026-03-10 10:00:00+00', null,
    'c0000000-0000-0000-0000-000000000003'
  );

-- =============================================================================
-- Task assignments  (defines visibility + per-user priority)
--
-- member_sort_key: lower = higher priority (1000, 2000, 3000 …)
-- =============================================================================
insert into task_assignments (task_id, member_id, member_sort_key) values

  -- Alice's household list (priority order: T2 overdue first, then others)
  ('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 1000),  -- Fix leak
  ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 2000),  -- Groceries
  ('e0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000001', 3000),  -- Deep-clean (parent)
  ('e0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000001', 1000),  -- Subtask: move furniture
  ('e0000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-000000000001', 2000),  -- Subtask: vacuum (done)
  ('e0000000-0000-0000-0000-000000000007', 'c0000000-0000-0000-0000-000000000001', 4000),  -- Recurring groceries
  ('e0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', 5000),  -- Completed: pay bills

  -- Bob's household list (shared on T2; different priority ordering)
  ('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 1000),  -- Fix leak (shared with Alice)

  -- Alice's work list
  ('e0000000-0000-0000-0000-000000000008', 'c0000000-0000-0000-0000-000000000003', 1000),  -- Q1 report (urgent)
  ('e0000000-0000-0000-0000-000000000009', 'c0000000-0000-0000-0000-000000000003', 2000);  -- Sprint retro

-- =============================================================================
-- Task updates
-- =============================================================================
insert into task_updates (id, task_id, member_id, update_text, created_at) values
  (
    'f0000000-0000-0000-0000-000000000001',
    'e0000000-0000-0000-0000-000000000002',   -- Fix the kitchen leak
    'c0000000-0000-0000-0000-000000000001',
    'Called the plumber. They can come Thursday.',
    '2026-03-02 09:15:00+00'
  ),
  (
    'f0000000-0000-0000-0000-000000000002',
    'e0000000-0000-0000-0000-000000000002',
    'c0000000-0000-0000-0000-000000000002',
    'Bought a replacement seal from the hardware store just in case.',
    '2026-03-02 11:40:00+00'
  ),
  (
    'f0000000-0000-0000-0000-000000000003',
    'e0000000-0000-0000-0000-000000000008',   -- Q1 report
    'c0000000-0000-0000-0000-000000000003',
    'Draft done. Waiting on finance numbers from Carol.',
    '2026-03-03 16:00:00+00'
  );
