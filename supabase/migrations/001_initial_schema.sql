create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('household','work')),
  created_at timestamptz not null default now()
);

create table workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  auth_user_id uuid not null,
  display_name text not null,
  role text,
  created_at timestamptz not null default now(),
  unique (workspace_id, auth_user_id),
  unique (workspace_id, display_name)
);

create table task_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  title text not null,
  description text,
  frequency text not null check (frequency in ('daily','weekly','biweekly','monthly')),
  interval_count int not null default 1,
  next_run_at timestamptz not null,
  is_active boolean not null default true,
  default_due_offset_hours int,
  created_at timestamptz not null default now()
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  parent_task_id uuid references tasks(id) on delete cascade,
  rule_id uuid references task_rules(id) on delete set null,

  title text not null,
  description text,

  due_at timestamptz,
  completed_at timestamptz,

  created_by_member_id uuid references workspace_members(id) on delete set null,
  created_at timestamptz not null default now()
);

create index tasks_workspace_parent_idx
on tasks (workspace_id, parent_task_id);

create table task_assignments (
  task_id uuid not null references tasks(id) on delete cascade,
  member_id uuid not null references workspace_members(id) on delete cascade,

  member_sort_key numeric not null default 1000,
  assigned_at timestamptz not null default now(),

  primary key (task_id, member_id)
);

create index task_assignments_member_order_idx
on task_assignments (member_id, member_sort_key);

create index task_assignments_task_idx
on task_assignments (task_id);

create table task_updates (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  member_id uuid not null references workspace_members(id) on delete cascade,
  created_at timestamptz not null default now(),
  update_text text not null
);

create index task_updates_task_created_idx
on task_updates (task_id, created_at);