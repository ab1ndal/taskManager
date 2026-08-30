-- Fix round 2 on 016: the delete guard blocks the workspaces cascade, breaking workspace deletion.
--
-- board_columns.workspace_id references workspaces(id) on delete cascade (015). Deleting a
-- workspace cascade-deletes its columns row by row, and
-- private.assert_board_column_not_last_non_terminal (016) fired on the last non-terminal one and
-- raised, aborting the whole delete. e2e/fixtures.ts:294 deletes the workspace in teardown(), and
-- seed() calls teardown() first, so this broke the entire Playwright suite at global setup.
--
-- Fix: when the parent workspace row is already gone, the whole workspace is going away and there
-- is nothing left to strand — skip the guard. A workspace that still exists must still keep its
-- last non-terminal column; that half of 016's behaviour is unchanged.

create or replace function private.assert_board_column_not_last_non_terminal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remaining int;
begin
  if old.is_done then
    return old;
  end if;

  -- A cascade from workspaces has already removed the parent row by the time the child delete runs,
  -- so an absent workspace means the whole workspace is going away and there is nothing to strand.
  -- Without this, deleting a workspace aborts on its last non-terminal column — which is what
  -- e2e/fixtures.ts teardown() does before every run.
  if not exists (select 1 from public.workspaces where id = old.workspace_id) then
    return old;
  end if;

  select count(*) into v_remaining
  from public.board_columns
  where workspace_id = old.workspace_id
    and not is_done
    and id <> old.id;

  if v_remaining = 0 then
    raise exception 'workspace % would be left with no non-terminal board column', old.workspace_id;
  end if;

  return old;
end;
$$;
