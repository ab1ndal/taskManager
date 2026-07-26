# Phase 6: Task Updates & Speech-to-Text — Design

## Context

Roadmap Phase 6. Depends on Phase 5 (task prioritization — complete). Requirement TASK-07
(`docs/product.md`).

`task_updates` table and its RLS policies already exist (`001_initial_schema.sql`,
`002_rls_policies.sql`, `007_rls_security_definer.sql`) — schema was staged ahead of this phase,
same as `@hello-pangea/dnd` was staged for Phase 5. No application code reads or writes it yet.

During brainstorming the user also asked to allow adding a subtask to an already-created task —
today `createTaskWithSubtasks` (`actions.ts:170`) only accepts subtasks at parent-creation time.
Phase 5's design doc flagged this exact gap as deferred. Folded into this phase because it shares
a home (`edit-task-modal.tsx`) and an authorization shape (`assertTaskAssignee`) with task updates.

## Scope

**In scope:**
- Task updates: text log per task, chronological, author + timestamp shown.
- Add-update input supports typing and speech-to-text dictation (Web Speech API, tap-to-toggle
  mic); user can edit transcribed text before saving. Audio never leaves the browser.
- Add a subtask to an existing task, from the edit-task-modal. New subtask inherits the parent's
  current assignees.
- All three surface inside the existing `edit-task-modal.tsx` (chosen over a new detail view or
  inline card-expansion — keeps one place users go to change a task).

**Out of scope:**
- Editing or deleting a task update once saved (product.md describes updates as a log, not
  editable content — matches the "text only with the date stamp" framing).
- Editing or deleting a subtask from this modal (subtasks already have their own card-level
  complete/delete affordances).
- Server-side transcription API. Web Speech API only; browsers without it (Firefox) fall back to
  typing — no mic button rendered.
- Phase 6.5 (task-panel visual polish via ui-ux-pro-max) — separate phase, separate brainstorm,
  raised mid-session and inserted into the roadmap after this one.

## Data Layer

No migration needed. Existing `task_updates` columns: `id, task_id, member_id, created_at,
update_text`. Existing index: `(task_id, created_at)`. Existing RLS: select/insert both scoped via
`private.is_task_assignee(task_id)`, insert additionally requires `private.is_own_member(member_id)`.

Subtask-add-later needs no schema change — `tasks.parent_task_id` is already nullable and the
insert path is identical to `createTaskWithSubtasks`'s subtask loop, just triggered later and for
one subtask at a time instead of a batch at creation.

## Server Actions (`src/app/tasks/actions.ts`)

All three follow the file's existing pattern: `requireUser` → `assertTaskAssignee` → admin-client
mutation/read wrapped in `run()`, so authorization is app-level (matches the comment at the top of
the file — RLS is defense in depth, not the enforcement point here).

**`getTaskUpdates(taskId): ActionResult<{ updates: TaskUpdate[] }>`**
Read. `assertTaskAssignee(taskId, user.id)` → select `task_updates` joined to
`workspace_members.display_name` for the author name, ordered by `created_at` ascending.

**`addTaskUpdate(input: { taskId, updateText }): ActionResult`**
Write. `assertTaskAssignee(taskId, user.id)` → resolve author `member_id` as the single id in
`memberIdsForUser(user.id) ∩ {assignees of taskId}` — deterministic because a task belongs to one
workspace and `unique (workspace_id, auth_user_id)` is a real DB constraint on `workspace_members`
(`001_initial_schema.sql:15`, confirmed via research, not just a doc claim), so at most one of the
user's member rows can be assigned to any given task → insert `{ task_id, member_id, update_text }`.

**`addSubtask(input: { parentTaskId, title, description?, dueAt? }): ActionResult`**
Write. `assertTaskAssignee(parentTaskId, user.id)` → load parent's current assignee `member_id`s
→ insert new task row with `parent_task_id: parentTaskId` → assign it the same members via
`assignTaskMember` (the same atomic-sort-key RPC call already used elsewhere).

`createTaskWithSubtasks`'s subtask-insert-and-assign block and `addSubtask`'s body do the same
work; factor a shared `insertSubtask(admin, { parentId, workspaceId, memberIds, title,
description, dueAt })` helper both call, instead of duplicating the insert+assign loop.

New schemas in `schemas.ts`:
- `createTaskUpdateSchema` — `taskId` (uuid), `updateText` (string, trimmed, 1–2000 chars).
- `addSubtaskSchema` — `parentTaskId` (uuid), `title` (required), `description`/`dueAt` (optional)
  — same shape as the subtask fields already inside `createTaskWithSubtasksSchema`.

## UI (`src/app/tasks/edit-task-modal.tsx`)

Two new sections appended after the existing title/description/due-date/assignee form, inside the
same `Dialog`.

**Updates section**
- On modal open, `useEffect` calls `getTaskUpdates(task.id)` and populates local state — lazy,
  not part of the page-load query, since most modals are never opened.
- List: each entry shows author display name, timestamp, update text, oldest first.
- Input row: textarea + mic toggle button + "Add" button.
- Submit: optimistic append to the local list (log/chat feel — the list is additive, unlike the
  rest of this modal's edit-and-wait fields), calls `addTaskUpdate`, rolls back the appended entry
  and shows an inline error (not a toast — same reason the rest of this modal uses inline errors:
  `<dialog>.showModal()` makes the toaster inert while open) on failure.

**Subtasks section**
- Existing subtasks rendered read-only from `task.subtasks` (title, done state) — already present
  on `RawTask`, no fetch needed.
- "Add subtask" row: title/description/due-date inputs, same shape as `new-task-modal`'s subtask
  row component (reused, not reimplemented).
- Submit: optimistic append to the local subtask list, calls `addSubtask`, rolls back + inline
  error on failure, same pattern as updates.

**Speech-to-text (`useSpeechRecognition` hook, new, in `src/lib/`)**
- Wraps `window.SpeechRecognition ?? window.webkitSpeechRecognition`.
- Feature-detected: hook exposes `isSupported`; mic button doesn't render when `false`.
- Tap-to-toggle: tap starts listening (button relabels to "Stop"), tap again or the API's own
  `onend` stops it.
- Interim + final results write into the update textarea as they arrive; user can keep editing
  after stopping, same as typed text — nothing auto-submits.
- No audio ever reaches application code or a server — the browser API returns text only, so
  "audio is never stored" holds by construction, not by a discard step.
- **`onend` fires on silence even with `continuous: true`** (confirmed via research, not just a
  Chrome quirk to patch later) — the hook needs a ref-guarded auto-restart from `onend` (restart
  only if the user hasn't explicitly tapped stop) built in from the first implementation, not
  bolted on after manual testing surfaces it.
- Both `window.SpeechRecognition` and the `webkitSpeechRecognition` prefix must be checked — Safari
  still requires the prefix (confirmed current as of this research), Chrome accepts either.
- Firefox has no real support (flag-gated, never shipped) — feature-detection with no mic button is
  the only correct fallback, not a gap to close later.
- `isSupported` must be computed inside a `useEffect` or lazy initializer, never read from `window`
  at module scope — this is a client component but still SSR-rendered once on the server.
- Permission-denied vs. no-speech-detected: treat `onerror` with `event.error === "not-allowed"` as
  the denied case; verify manually in Chrome + Safari during execution, since authoritative current
  docs on re-prompt behavior weren't conclusively found in research.

## Error Handling

Same as the rest of `actions.ts`: `ValidationError`/`ForbiddenError` messages pass through to the
caller verbatim; anything else is logged server-side and replaced with the generic message. No new
failure modes beyond what `run()` already handles.

## Testing

- `schemas.test.ts` (or wherever existing schema tests live) — `createTaskUpdateSchema` and
  `addSubtaskSchema` boundary cases: empty text, over-length text, missing required fields.
- `actions.test.ts` — extend with `getTaskUpdates`, `addTaskUpdate`, `addSubtask`: authz rejection
  for a non-assignee, correct author `member_id` resolution, subtask inherits parent assignees.
- `edit-task-modal.test.tsx` — extend: updates list renders fetched entries, optimistic
  append+rollback on `addTaskUpdate` failure, subtask add optimistic append+rollback, mic button
  absent when `SpeechRecognition` undefined (jsdom has none by default, so this is the default
  test environment — a separate test mocks the API present to cover the supported path).
- `useSpeechRecognition` — new hook test with a mock `SpeechRecognition` implementation: start/stop
  toggling, interim/final result handling, `isSupported` false when the global is absent.
- **Manual-only**: actual mic dictation accuracy/behavior across real browsers (Chrome/Safari) —
  not meaningfully testable against a mock. Recorded in a `06-VERIFICATION.md` checklist, same
  pattern as Phase 4/5.

## Open Questions Resolved During Brainstorm

- Location: inside `edit-task-modal.tsx`, not a new detail view or card-expansion.
- STT: Web Speech API (client-only), not a server transcription API.
- Mic interaction: tap-to-toggle, not hold-to-talk.
- Subtask-add-later: in scope for this phase, not deferred further.
- Task-panel UI polish (ui-ux-pro-max): out of scope — inserted as Phase 6.5, separate brainstorm.
