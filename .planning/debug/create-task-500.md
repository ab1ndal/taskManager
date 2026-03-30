---
status: awaiting_human_verify
trigger: "POST /tasks returns 500 Internal Server Error when submitting the new task modal. Error originates in createTaskWithSubtasks at actions.ts:63."
created: 2026-03-26T00:00:00Z
updated: 2026-03-26T00:01:00Z
---

## Current Focus

hypothesis: actions.ts appends `T00:00:00Z` to a `datetime-local` value that already contains a time component, producing an invalid ISO 8601 string like "2026-03-26T14:30T00:00:00Z" which Postgres rejects
test: trace how dueAt flows from modal input (datetime-local) through to the DB insert
expecting: confirmation that double-encoding causes a Postgres type error on the tasks insert, which propagates to the throw at line 92

next_action: confirm the due_at encoding mismatch, then check for secondary bugs

## Symptoms

expected: Task is created and appears in the task list
actual: 500 Internal Server Error on POST /tasks
errors: |
  actions.ts:63 — POST http://localhost:3000/tasks 500 (Internal Server Error)
  Stack:
    createTaskWithSubtasks @ actions.ts:63
    (anonymous) @ new-task-modal.tsx:88
    handleSubmit @ new-task-modal.tsx:86
reproduction: Open new task modal, fill in details, submit
started: Existing code — task creation not yet verified to work

## Eliminated

- hypothesis: RLS blocks the tasks insert
  evidence: tasks_insert policy exists and allows inserts when workspace_id matches a member row for auth.uid(); user is authenticated via server client with session cookies
  timestamp: 2026-03-26T00:01:00Z

- hypothesis: Server action wiring is broken (use client calling use server)
  evidence: Standard Next.js pattern — "use client" component importing from "use server" file is correct; modal calls createTaskWithSubtasks which is exported from actions.ts with "use server" directive
  timestamp: 2026-03-26T00:01:00Z

## Evidence

- timestamp: 2026-03-26T00:01:00Z
  checked: new-task-modal.tsx line 149 — due date input type
  found: input is type="datetime-local", which produces values in format "YYYY-MM-DDTHH:MM" (already has T + time component)
  implication: the dueAt string passed to createTaskWithSubtasks already contains a datetime, not just a date

- timestamp: 2026-03-26T00:01:00Z
  checked: actions.ts line 86 — how dueAt is stored
  found: `due_at: dueAt ? \`${dueAt}T00:00:00Z\` : null` — appends T00:00:00Z unconditionally when dueAt is truthy
  implication: result is "YYYY-MM-DDTHH:MMT00:00:00Z" which is invalid ISO 8601; Postgres will reject this with a type/format error

- timestamp: 2026-03-26T00:01:00Z
  checked: actions.ts lines 112-116 — subtask due_at encoding
  found: subtask rows use `type="date"` input (modal line 218) → "YYYY-MM-DD" format; action does `${sub.dueAt}T00:00:00Z` → "YYYY-MM-DDT00:00:00Z" which IS valid
  implication: subtask encoding is correct; only parent task due_at is broken

- timestamp: 2026-03-26T00:01:00Z
  checked: actions.ts line 92 — error propagation
  found: `if (parentError || !parent) throw new Error(...)` — any Supabase error on the insert throws immediately
  implication: a Postgres rejection of the invalid timestamp causes this throw, which becomes the 500

- timestamp: 2026-03-26T00:01:00Z
  checked: actions.ts line 36 — simpler createTask function
  found: `due_at: dueAt ?? null` — does NOT append T00:00:00Z; uses value as-is
  implication: createTask would also fail with a datetime-local value since Postgres expects a full timestamptz, but createTaskWithSubtasks double-encodes which is a more obvious malformation

## Resolution

root_cause: In `createTaskWithSubtasks` (actions.ts:86), `dueAt` from the modal's `datetime-local` input is already in "YYYY-MM-DDTHH:MM" format but the action appends `T00:00:00Z`, producing the invalid string "YYYY-MM-DDTHH:MMT00:00:00Z". Postgres rejects this malformed timestamp, causing the Supabase insert to return an error, which is thrown at line 92 and surfaces as a 500.

fix: |
  1. actions.ts line 36 (createTask): changed `dueAt ?? null` to `dueAt ? \`${dueAt}:00Z\` : null`
  2. actions.ts line 86 (createTaskWithSubtasks): changed `\`${dueAt}T00:00:00Z\`` to `\`${dueAt}:00Z\``
  Both produce valid ISO 8601 timestamptz strings ("YYYY-MM-DDTHH:MM:00Z") from datetime-local input values ("YYYY-MM-DDTHH:MM").

verification: fixes applied; awaiting human verification in live environment
files_changed: [src/app/tasks/actions.ts]
