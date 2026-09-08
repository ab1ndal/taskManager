/**
 * An in-memory stand-in for the Supabase client, seeded per test.
 *
 * The previous mocks were hand-assembled method chains sequenced with `mockReturnValueOnce`, so the
 * *number and order* of Supabase calls inside an action was baked into every test — adding an
 * authorization query broke them all (tasks/lessons.md L5). This fake answers by table and filter
 * instead, so tests assert on resulting state rather than on call sequence.
 *
 * It implements only the query surface these actions use: eq / in / is / not / lt / lte / or /
 * order / limit / single / maybeSingle on select, `{ count: "exact", head: true }`, and
 * insert / update / delete.
 */

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

type Op = "select" | "insert" | "update" | "delete";

/** Return a message to make the matching operation fail, or null to let it through. */
export type FailureHook = (
  table: string,
  op: Op,
  payload: Row | null
) => { message: string; code?: string } | null;

export interface FakeOptions {
  /** Rows visible to the fake, keyed by table name. Mutated in place by writes. */
  tables?: Tables;
  /** The authenticated user `auth.getUser()` reports. `null` means signed out. */
  user?: { id: string } | null;
  failOn?: FailureHook;
}

export interface Filter {
  kind: "eq" | "in" | "is" | "not-is" | "lt" | "lte" | "or";
  column: string;
  value: unknown;
  /** Only present for kind "or": the comma-separated conditions PostgREST's `.or()` takes. */
  subs?: OrCondition[];
}

/**
 * One issued select, recorded the moment it resolves — table, every filter, the order keys in call
 * order, and the limit. Exists so a test can assert a query was *shaped* a certain way (bounded,
 * ordered a particular way) rather than only asserting the data that came back, which a bug in the
 * bound (e.g. a dropped `.limit()`) does not necessarily change for a given fixture.
 */
export interface QueryLogEntry {
  table: string;
  filters: Filter[];
  orderBy: { column: string; ascending: boolean }[];
  limit: number | null;
}

/** One `column.op.value` clause out of an `.or("a.op.b,c.op.d")` expression. */
interface OrCondition {
  column: string;
  op: "is" | "eq" | "gte" | "lte";
  value: unknown;
}

/**
 * PostgREST's `.or()` expression is a comma-separated list of `column.op.value` clauses. Splitting
 * naively on every "." would also split inside an ISO timestamp's fractional seconds
 * ("...00.000Z"), so each clause is parsed with a regex that only takes the first two dots as
 * separators and leaves the rest — dots and all — as the value.
 */
function parseOrExpr(expr: string): OrCondition[] {
  return expr.split(",").map((clause) => {
    const match = /^([^.]+)\.([^.]+)\.(.*)$/.exec(clause);
    if (!match) throw new Error(`fake supabase: unparseable or() clause "${clause}"`);
    const [, column, op, rawValue] = match;
    if (op !== "is" && op !== "eq" && op !== "gte" && op !== "lte") {
      throw new Error(`fake supabase: unsupported or() operator "${op}"`);
    }
    const value = rawValue === "null" ? null : rawValue;
    return { column, op, value };
  });
}

function evalCondition(row: Row, { column, op, value }: OrCondition): boolean {
  const actual = row[column];
  if (op === "is") return actual === value || (value === null && actual === undefined);
  if (op === "eq") return actual === value;
  if (actual === undefined || actual === null) return false;
  if (op === "gte") return (actual as string | number) >= (value as string | number);
  return (actual as string | number) <= (value as string | number); // lte
}

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => {
    const actual = row[f.column];
    if (f.kind === "eq") return actual === f.value;
    if (f.kind === "is") return actual === f.value || (f.value === null && actual === undefined);
    if (f.kind === "not-is") {
      return !(actual === f.value || (f.value === null && actual === undefined));
    }
    if (f.kind === "lt") {
      return actual !== undefined && actual !== null && (actual as string | number) < (f.value as string | number);
    }
    if (f.kind === "lte") {
      return actual !== undefined && actual !== null && (actual as string | number) <= (f.value as string | number);
    }
    if (f.kind === "or") return (f.subs ?? []).some((sub) => evalCondition(row, sub));
    return Array.isArray(f.value) && f.value.includes(actual);
  });
}

class Query implements PromiseLike<{ data: Row[] | Row | null; error: { message: string; code?: string } | null; count: number | null }> {
  private filters: Filter[] = [];
  private op: Op = "select";
  private payload: Row | null = null;
  private orderBy: { column: string; ascending: boolean }[] = [];
  private limitN: number | null = null;
  private wantSingle = false;
  private wantMaybeSingle = false;
  private countMode = false;
  private returning = false;

  constructor(
    private readonly table: string,
    private readonly tables: Tables,
    private readonly failOn?: FailureHook,
    private readonly queryLog?: QueryLogEntry[]
  ) {}

  private rows(): Row[] {
    return (this.tables[this.table] ??= []);
  }

  select(_columns?: string, options?: { count?: string; head?: boolean }) {
    // `.insert(...).select()` means RETURNING, not a separate read — the op stays as the write.
    if (this.op === "select") {
      if (options?.count) this.countMode = true;
    } else {
      this.returning = true;
    }
    return this;
  }

  insert(row: Row) {
    this.op = "insert";
    this.payload = row;
    return this;
  }

  update(patch: Row) {
    this.op = "update";
    this.payload = patch;
    return this;
  }

  delete() {
    this.op = "delete";
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ kind: "in", column, value });
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push({ kind: "is", column, value });
    return this;
  }

  /** Only the `not(column, "is", value)` shape is implemented — the one this codebase calls. */
  not(column: string, operator: string, value: unknown) {
    if (operator !== "is") throw new Error(`fake supabase: unsupported not() operator "${operator}"`);
    this.filters.push({ kind: "not-is", column, value });
    return this;
  }

  /** `.or("completed_at.is.null,completed_at.gte.2026-01-01")` — the only shape this codebase calls. */
  or(expr: string) {
    this.filters.push({ kind: "or", column: "", value: null, subs: parseOrExpr(expr) });
    return this;
  }

  lt(column: string, value: unknown) {
    this.filters.push({ kind: "lt", column, value });
    return this;
  }

  lte(column: string, value: unknown) {
    this.filters.push({ kind: "lte", column, value });
    return this;
  }

  /**
   * Successive `.order()` calls compose left to right, mirroring PostgREST: the first call is the
   * primary key, each further call breaks ties left by the ones before it.
   */
  order(column: string, options?: { ascending?: boolean }) {
    this.orderBy.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  limit(n: number) {
    this.limitN = n;
    return this;
  }

  single() {
    this.wantSingle = true;
    return this;
  }

  /** Like `single()`, but an empty result is `{ data: null, error: null }` rather than PGRST116. */
  maybeSingle() {
    this.wantMaybeSingle = true;
    return this;
  }

  private run() {
    // Recorded regardless of outcome — a query is "issued" whether or not it then fails or matches
    // anything, and a bound belongs to the query's shape, not its result.
    if (this.op === "select") {
      this.queryLog?.push({
        table: this.table,
        filters: [...this.filters],
        orderBy: [...this.orderBy],
        limit: this.limitN,
      });
    }

    const failure = this.failOn?.(this.table, this.op, this.payload);
    if (failure) return { data: null, error: failure, count: null };

    if (this.op === "insert") {
      // Postgres fills the id default when the caller does not supply one.
      const row = { id: crypto.randomUUID(), ...this.payload };
      this.rows().push(row);
      return { data: this.returning ? row : null, error: null, count: null };
    }

    const selected = this.rows().filter((r) => matches(r, this.filters));

    if (this.op === "update") {
      for (const row of selected) Object.assign(row, this.payload);
      return { data: null, error: null, count: null };
    }

    if (this.op === "delete") {
      this.tables[this.table] = this.rows().filter((r) => !matches(r, this.filters));
      return { data: null, error: null, count: null };
    }

    if (this.countMode) return { data: null, error: null, count: selected.length };

    let result = [...selected];
    if (this.orderBy.length > 0) {
      const keys = this.orderBy;
      result.sort((a, b) => {
        for (const { column, ascending } of keys) {
          const x = a[column];
          const y = b[column];
          // Postgres orders text and timestamp columns too, so subtraction alone (NaN for
          // strings, i.e. no reordering at all) would let a missing ORDER BY pass unnoticed in
          // tests.
          const delta =
            typeof x === "number" && typeof y === "number"
              ? x - y
              : String(x).localeCompare(String(y));
          if (delta !== 0) return ascending ? delta : -delta;
        }
        return 0;
      });
    }
    if (this.limitN !== null) result = result.slice(0, this.limitN);

    if (this.wantSingle || this.wantMaybeSingle) {
      // PostgREST returns PGRST116 rather than an empty body when `.single()` matches no row.
      if (result.length === 0) {
        return this.wantMaybeSingle
          ? { data: null, error: null, count: null }
          : { data: null, error: { message: "no rows", code: "PGRST116" }, count: null };
      }
      return { data: result[0], error: null, count: null };
    }

    return { data: result, error: null, count: null };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  then<TResult1 = any, TResult2 = never>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

export function createFakeSupabase(options: FakeOptions = {}) {
  const tables = options.tables ?? {};
  const user = options.user === undefined ? { id: "auth-user-1" } : options.user;
  const queryLog: QueryLogEntry[] = [];

  return {
    tables,
    /** Every select issued through `from()`, in call order. See `QueryLogEntry`. */
    queryLog,
    from: (table: string) => new Query(table, tables, options.failOn, queryLog),
    rpc: async (fnName: string, params: Record<string, unknown>) => {
      if (fnName === "assign_task_member") {
        const taskId = params.p_task_id as string;
        const memberId = params.p_member_id as string;
        const rows = (tables.task_assignments ?? []) as Row[];
        const max = rows
          .filter((r) => r.member_id === memberId)
          .reduce((acc, r) => Math.max(acc, r.member_sort_key as number), 0);
        const row: Row = { task_id: taskId, member_id: memberId, member_sort_key: max + 1000 };
        rows.push(row);
        tables.task_assignments = rows;
        return { data: row, error: null };
      }
      // Mirrors migration 011: only the root task carries a workspace, so the workspace write is one
      // row, while every assignment for the task and its subtasks is replaced by the given members,
      // each new key landing at the end of that member's list.
      if (fnName === "move_task_workspace") {
        const taskId = params.p_task_id as string;
        const workspaceId = params.p_workspace_id as string;
        const memberIds = params.p_member_ids as string[];
        const taskRows = (tables.tasks ?? []) as Row[];
        const target = taskRows.find((t) => t.id === taskId);

        if (!target) return { data: null, error: { message: `task ${taskId} not found` } };
        if (target.parent_task_id) {
          return { data: null, error: { message: `task ${taskId} is a subtask` } };
        }
        if (memberIds.length === 0) {
          return { data: null, error: { message: "a task must keep at least one assignee" } };
        }

        const members = (tables.workspace_members ?? []) as Row[];
        const outsiders = memberIds.filter(
          (id) => !members.some((m) => m.id === id && m.workspace_id === workspaceId)
        );
        if (outsiders.length > 0) {
          return {
            data: null,
            error: { message: `members do not all belong to workspace ${workspaceId}` },
          };
        }

        // The task's column is workspace-scoped (015), so a move needs a destination column, not
        // just a destination workspace. Same rule task creation uses: the leftmost non-terminal
        // column, is_done excluded explicitly rather than relying on position (016).
        const columns = (tables.board_columns ?? []) as Row[];
        const destinationColumn = columns
          .filter((c) => c.workspace_id === workspaceId && !c.is_done)
          .sort((a, b) => (a.position as number) - (b.position as number))[0];

        if (!destinationColumn) {
          return {
            data: null,
            error: {
              message: `workspace ${workspaceId} has no non-terminal board column to receive task ${taskId}`,
            },
          };
        }

        target.workspace_id = workspaceId;
        target.board_column_id = destinationColumn.id;

        const affectedIds = [
          taskId,
          ...taskRows.filter((t) => t.parent_task_id === taskId).map((t) => t.id as string),
        ];

        const assignments = ((tables.task_assignments ?? []) as Row[]).filter(
          (a) => !affectedIds.includes(a.task_id as string)
        );
        for (const memberId of memberIds) {
          for (const movedId of affectedIds) {
            const max = assignments
              .filter((a) => a.member_id === memberId)
              .reduce((acc, a) => Math.max(acc, a.member_sort_key as number), 0);
            assignments.push({ task_id: movedId, member_id: memberId, member_sort_key: max + 1000 });
          }
        }
        tables.task_assignments = assignments;

        return { data: null, error: null };
      }

      // Mirrors migration 013's upsert: one rule row per task, keyed by task_id, replaced wholesale
      // on conflict rather than merged field-by-field.
      if (fnName === "upsert_task_recurrence") {
        const taskId = params.p_task_id as string;
        const rows = (tables.task_rules ?? []) as Row[];
        const row: Row = {
          task_id: taskId,
          frequency: params.p_frequency,
          interval_count: params.p_interval_count,
          next_run_at: params.p_first_run_local,
          default_due_offset_hours: params.p_due_offset_hours,
          is_active: params.p_is_active,
        };
        const existing = rows.find((r) => r.task_id === taskId);
        if (existing) Object.assign(existing, row);
        else rows.push(row);
        tables.task_rules = rows;
        return { data: null, error: null };
      }

      // Mirrors migration 020 (supersedes 018): the assignment check is hoisted above every write,
      // including the both-null branch. That branch used to return before task_assignments was
      // ever touched, so the "not found" on its update was the only place membership got checked —
      // a member in the workspace but not assigned to the task could drop a card into an empty
      // column even though the identical drop into a non-empty column correctly raised. Visibility
      // here is assignment (docs/db.md), so the check must run on every branch, before any write.
      if (fnName === "move_task_to_column") {
        const taskId = params.p_task_id as string;
        const columnId = params.p_column_id as string;
        const memberId = params.p_member_id as string;
        const prevKey = params.p_prev_key as number | null;
        const nextKey = params.p_next_key as number | null;

        const task = ((tables.tasks ?? []) as Row[]).find((t) => t.id === taskId);
        if (!task) return { data: null, error: { message: `task ${taskId} not found` } };
        if (task.parent_task_id) {
          return {
            data: null,
            error: { message: `task ${taskId} is a subtask and has no board column` },
          };
        }

        const column = ((tables.board_columns ?? []) as Row[]).find((c) => c.id === columnId);
        if (!column) return { data: null, error: { message: `board column ${columnId} not found` } };
        if (column.workspace_id !== task.workspace_id) {
          return {
            data: null,
            error: { message: `board column ${columnId} is not in workspace ${task.workspace_id}` },
          };
        }

        const member = ((tables.workspace_members ?? []) as Row[]).find((m) => m.id === memberId);
        if (!member || member.workspace_id !== task.workspace_id) {
          return {
            data: null,
            error: { message: `member ${memberId} is not in workspace ${task.workspace_id}` },
          };
        }

        const assignment = ((tables.task_assignments ?? []) as Row[]).find(
          (a) => a.task_id === taskId && a.member_id === memberId
        );
        if (!assignment) {
          return {
            data: null,
            error: { message: `member ${memberId} is not assigned to task ${taskId}` },
          };
        }

        task.board_column_id = columnId;

        // Same key arithmetic as reorderTask in src/app/tasks/actions.ts: midpoint between
        // neighbours, or a full step beyond the one neighbour that exists. Both null means the
        // destination column is empty, so the existing key stands and only the column changes.
        if (prevKey === null && nextKey === null) return { data: null, error: null };

        assignment.member_sort_key =
          prevKey === null ? nextKey! - 1000 : nextKey === null ? prevKey + 1000 : (prevKey + nextKey) / 2;

        return { data: null, error: null };
      }

      // Mirrors migration 021 (supersedes 018/020's lock-order fix; same observable behaviour here
      // since the fake has no concurrent callers). The coverage check reads a snapshot of which
      // tasks are in the column; the relocation write below re-asserts board_column_id === columnId
      // per task rather than trusting that snapshot, so a task that stopped being in this column for
      // any reason is not dragged back into the destination someone else chose for it.
      if (fnName === "delete_board_column") {
        const columnId = params.p_column_id as string;
        const moves = (params.p_moves ?? []) as { task_id: string; target_column_id: string }[];
        const columns = (tables.board_columns ?? []) as Row[];
        const column = columns.find((c) => c.id === columnId);

        if (!column) return { data: null, error: { message: `board column ${columnId} not found` } };

        const siblings = columns.filter(
          (c) => c.workspace_id === column.workspace_id && c.id !== columnId
        );
        if (siblings.filter((c) => !c.is_done).length === 0) {
          return {
            data: null,
            error: {
              message: `cannot delete the last non-terminal column of workspace ${column.workspace_id}`,
            },
          };
        }

        const taskRows = (tables.tasks ?? []) as Row[];
        const actual = taskRows
          .filter((t) => t.board_column_id === columnId)
          .map((t) => t.id as string)
          .sort();
        const requested = moves.map((m) => m.task_id).sort();

        if (actual.join() !== requested.join()) {
          return {
            data: null,
            error: { message: `column ${columnId} changed since it was listed` },
          };
        }

        const badTarget = moves.some(
          (m) =>
            m.target_column_id === columnId ||
            !siblings.some((c) => c.id === m.target_column_id)
        );
        if (badTarget) {
          return {
            data: null,
            error: {
              message: `every destination must be a different column in workspace ${column.workspace_id}`,
            },
          };
        }

        for (const move of moves) {
          const task = taskRows.find((t) => t.id === move.task_id);
          if (task && task.board_column_id === columnId) task.board_column_id = move.target_column_id;
        }

        tables.board_columns = columns.filter((c) => c.id !== columnId);

        return { data: null, error: null };
      }

      // Grocery actions stub RPC responses; batch semantics are tested against Postgres.
      return { data: null, error: { message: `unknown rpc: ${fnName}` } };
    },
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
    },
  };
}
