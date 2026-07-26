# Roadmap: Hearth

## Overview

Hearth already has auth, task display, and basic task creation working. This roadmap completes the product: replacing the pin-based workspace system with a public directory + instant join flow, hardening task creation into a complete workflow, adding task detail and editing, and finally enabling personal task prioritization via drag-and-drop.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Workspace Directory** - Replace pin-based join with public directory and instant join (completed 2026-03-27)
- [x] **Phase 2: Task Creation** - Complete task creation with full field support and real-time list update (completed 2026-03-27)
- [x] **Phase 3: Security Hardening & Failure Visibility** - Non-recursive RLS, authorized server actions, validated input, visible failures (completed 2026-07-25)
- [ ] **Phase 4: Accessibility & Mobile** - Touch targets, focus management, dialog semantics, live regions
- [x] **Phase 5: Task Prioritization** - Drag-to-reorder personal task priority (completed 2026-07-26)
- [ ] **Phase 6: Task Updates & Speech-to-Text** - Text updates on a task; speech only at the input layer
- [ ] **Phase 7: Recurring Tasks** - Rule-driven task generation
- [ ] **Phase 8: Design Polish** - Dark mode, semantic tokens, icon consolidation, reduced motion

**Task Detail & Editing** was the original Phase 3. It was largely built outside the planning loop
(`edit-task-modal.tsx`, `updateTask`, assignee management), so it is not carried as a separate phase.
What remains of it — a full detail view rather than a modal — is unscheduled.

## Phase Details

### Phase 1: Workspace Directory
**Goal**: Users can discover and join workspaces without friction — no pins, no approvals
**Depends on**: Nothing (builds on existing auth and workspace scaffolding)
**Requirements**: WS-01, WS-02, WS-03, WS-04
**Success Criteria** (what must be TRUE):
  1. User can create a new workspace by entering a name and selecting household or work kind
  2. User can browse a directory listing all workspaces in the system
  3. User can join any workspace from the directory instantly — no pin prompt, no waiting
  4. Workspaces the user already belongs to are visually distinguished in the directory (e.g., "Joined" badge)
**Plans**: TBD

Plans:
- [ ] 01-01: Remove pin system from DB and server actions; add public directory query
- [ ] 01-02: Build workspace directory UI with joined/unjoined states and instant join action

### Phase 2: Task Creation
**Goal**: Users can create fully-formed tasks that appear immediately in their task list
**Depends on**: Phase 1 (workspace membership required to assign tasks)
**Requirements**: TASK-01, TASK-02
**Success Criteria** (what must be TRUE):
  1. User can open the new task modal and fill in title, optional description, optional due date, workspace, and one or more assignees
  2. After submitting, the new task appears in the task list without a page reload or manual refresh
  3. Newly created task is assigned to the correct workspace and visible only to selected assignees
**Plans**: 2 plans

Plans:
- [ ] 02-01-PLAN.md — Fix modal feedback (success/warning toasts, warning type in toaster), add onTaskCreated optimistic callback
- [ ] 02-02-PLAN.md — Refactor TasksPageClient to own task list state with optimistic insert/rollback; update page.tsx to pass initialTasks

### Phase 3: Security Hardening & Failure Visibility
**Goal**: The database and the application both enforce access control, and a failed mutation is visible to the user
**Depends on**: Phase 2
**Requirements**: derived from `.planning/AUDIT-2026-07-25.md` (S1-S4, C1-C6)
**Success Criteria** (what must be TRUE):
  1. RLS policies are non-recursive and actually restrictive — a user sees only tasks assigned to them, enforced by the database
  2. Every task server action authenticates the caller and authorizes them for the specific row named
  3. Action input is validated at the boundary, with the same schemas used by the modals
  4. A failed mutation surfaces to the user and is logged, instead of silently leaving optimistic state on screen
  5. The service-role client is gone from the read paths
**Plans**: 1 plan (8 tasks)

Plans:
- [x] 03-PLAN.md — Tasks 1-8, executed 2026-07-25

### Phase 4: Accessibility & Mobile
**Goal**: The app is usable on a phone and with a keyboard or screen reader
**Depends on**: Phase 3
**Requirements**: audit U1-U5, U7
**Success Criteria** (what must be TRUE):
  1. Interactive controls meet the 44px touch target minimum on the task list
  2. Every focusable control has a visible focus indicator
  3. Modals are dialogs: role, focus trap, Escape to close, focus restored on close
  4. Toasts announce through a live region
**Plans**: 6 plans (3 waves)

Plans:
- [x] 04-01-PLAN.md — jest-axe setup + Dialog primitive component (foundation for U3)
- [x] 04-02-PLAN.md — Global :focus-visible rule (U2) + split polite/assertive toast live regions (U4)
- [x] 04-03-PLAN.md — Nav cleanup (U5) + 100dvh viewport fix (U7) + login-card lint fix
- [x] 04-04-PLAN.md — Convert new-task-modal and edit-task-modal to Dialog (U3)
- [x] 04-05-PLAN.md — 44px touch targets + task-scoped labels (U1) + delete confirm dialog (U3)
- [ ] 04-06-PLAN.md — Manual verification checkpoint (keyboard/VoiceOver/mobile) + leaked-password toggle

### Phase 5: Task Prioritization
**Goal**: Users can control the personal order of their tasks via drag-and-drop
**Depends on**: Phase 4
**Requirements**: TASK-06
**Success Criteria** (what must be TRUE):
  1. User can drag a task card up or down to reorder it within a bucket
  2. After reordering, the new order persists on page refresh (member_sort_key updated in DB)
  3. Reordering one user's tasks does not affect another user's order for shared tasks
**Plans**: TBD

Plans:
- [x] 05-01: Integrated `@hello-pangea/dnd`, wired `reorderTask()` to the UI with a keyboard
      alternative. Fixed the racy global `max + 1000` sort keys twice — migration 008's advisory
      lock only covered the read, not the follow-up insert (audit C3 was not actually closed
      until migration 009 folded both into one locked function; see `tasks/lessons.md` L10).
      All four manual verification checks pass (`05-VERIFICATION.md`).

### Phase 6: Task Updates & Speech-to-Text
**Goal**: Users can add text updates to a task, dictated if they prefer
**Depends on**: Phase 5
**Requirements**: TASK-07 (docs/product.md)
**Success Criteria** (what must be TRUE):
  1. A task shows its updates in chronological order
  2. Speech-to-text is available at the input layer only — audio is never stored
**Plans**: TBD

### Phase 7: Recurring Tasks
**Goal**: A recurrence rule generates task instances without duplicates
**Depends on**: Phase 6
**Requirements**: TASK-08 (docs/product.md)
**Success Criteria** (what must be TRUE):
  1. A rule produces the next instance on schedule
  2. The generator is idempotent for a repeated `next_run_at` — a retry cannot double-create
**Plans**: TBD

### Phase 8: Design Polish
**Goal**: One coherent visual system across light and dark
**Depends on**: Phase 7
**Requirements**: audit U6, U8-U12
**Success Criteria** (what must be TRUE):
  1. Dark mode works throughout, driven by semantic tokens rather than raw palette classes
  2. Icons come from one source at consistent sizes
  3. Animation respects `prefers-reduced-motion`
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Workspace Directory | 3/3 | Complete | 2026-03-27 |
| 2. Task Creation | 2/2 | Complete | 2026-03-27 |
| 3. Security Hardening & Failure Visibility | 1/1 | Complete | 2026-07-25 |
| 4. Accessibility & Mobile | 5/6 | In Progress — 3 of 4 manual checks in 04-06 done or partial, resuming later |  |
| 5. Task Prioritization | 1/1 | Complete | 2026-07-26 |
| 6. Task Updates & Speech-to-Text | 0/? | Not started | - |
| 7. Recurring Tasks | 0/? | Not started | - |
| 8. Design Polish | 0/? | Not started | - |

**Superseded:** the old "Phase 5: Task and workspace lifecycle" entry. Task deletion, editing, and
completion all landed — deletion and completion were fixed properly in Phase 3, which also found
that the complete button could never be used on a parent with an open subtask. Workspace deletion is
the only piece left and needs an ownership rule first; migration 007 deliberately grants no DELETE
policy on `workspaces`.
