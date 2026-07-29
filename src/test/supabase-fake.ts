/**
 * An in-memory stand-in for the Supabase client, seeded per test.
 *
 * The previous mocks were hand-assembled method chains sequenced with `mockReturnValueOnce`, so the
 * *number and order* of Supabase calls inside an action was baked into every test — adding an
 * authorization query broke them all (tasks/lessons.md L5). This fake answers by table and filter
 * instead, so tests assert on resulting state rather than on call sequence.
 *
 * It implements only the query surface these actions use: eq / in / is / order / limit / single on
 * select, `{ count: "exact", head: true }`, and insert / update / delete.
 */

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

type Op = "select" | "insert" | "update" | "delete";

/** Return a message to make the matching operation fail, or null to let it through. */
export type FailureHook = (table: string, op: Op, payload: Row | null) => { message: string } | null;

export interface FakeOptions {
  /** Rows visible to the fake, keyed by table name. Mutated in place by writes. */
  tables?: Tables;
  /** The authenticated user `auth.getUser()` reports. `null` means signed out. */
  user?: { id: string } | null;
  failOn?: FailureHook;
}

interface Filter {
  kind: "eq" | "in" | "is";
  column: string;
  value: unknown;
}

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => {
    const actual = row[f.column];
    if (f.kind === "eq") return actual === f.value;
    if (f.kind === "is") return actual === f.value || (f.value === null && actual === undefined);
    return Array.isArray(f.value) && f.value.includes(actual);
  });
}

class Query implements PromiseLike<{ data: Row[] | Row | null; error: { message: string; code?: string } | null; count: number | null }> {
  private filters: Filter[] = [];
  private op: Op = "select";
  private payload: Row | null = null;
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitN: number | null = null;
  private wantSingle = false;
  private wantMaybeSingle = false;
  private countMode = false;
  private returning = false;

  constructor(
    private readonly table: string,
    private readonly tables: Tables,
    private readonly failOn?: FailureHook
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

  order(column: string, options?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: options?.ascending !== false };
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
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      result.sort((a, b) => {
        const x = a[column];
        const y = b[column];
        // Postgres orders text and timestamp columns too, so subtraction alone (NaN for strings,
        // i.e. no reordering at all) would let a missing ORDER BY pass unnoticed in tests.
        const delta =
          typeof x === "number" && typeof y === "number"
            ? x - y
            : String(x).localeCompare(String(y));
        return ascending ? delta : -delta;
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

  return {
    tables,
    from: (table: string) => new Query(table, tables, options.failOn),
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
      // Mirrors migration 010: parent and subtasks change workspace, all of their assignments are
      // replaced by the given members, each new key landing at the end of that member's list.
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

        const movedIds = [taskId, ...taskRows.filter((t) => t.parent_task_id === taskId).map((t) => t.id as string)];
        taskRows.forEach((t) => {
          if (movedIds.includes(t.id as string)) t.workspace_id = workspaceId;
        });

        const assignments = ((tables.task_assignments ?? []) as Row[]).filter(
          (a) => !movedIds.includes(a.task_id as string)
        );
        for (const memberId of memberIds) {
          for (const movedId of movedIds) {
            const max = assignments
              .filter((a) => a.member_id === memberId)
              .reduce((acc, a) => Math.max(acc, a.member_sort_key as number), 0);
            assignments.push({ task_id: movedId, member_id: memberId, member_sort_key: max + 1000 });
          }
        }
        tables.task_assignments = assignments;

        return { data: null, error: null };
      }

      return { data: null, error: { message: `unknown rpc: ${fnName}` } };
    },
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
    },
  };
}
