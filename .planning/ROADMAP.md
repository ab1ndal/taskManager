# Roadmap: Hearth

## Overview

Hearth already has auth, task display, and basic task creation working. This roadmap completes the product: replacing the pin-based workspace system with a public directory + instant join flow, hardening task creation into a complete workflow, adding task detail and editing, and finally enabling personal task prioritization via drag-and-drop.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Workspace Directory** - Replace pin-based join with public directory and instant join
- [ ] **Phase 2: Task Creation** - Complete task creation with full field support and real-time list update
- [ ] **Phase 3: Task Detail & Editing** - Task detail view with editing, assignee management
- [ ] **Phase 4: Task Prioritization** - Drag-to-reorder personal task priority

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
**Plans**: TBD

Plans:
- [ ] 02-01: Audit and complete task creation server action (field coverage, assignment, error handling)
- [ ] 02-02: Update modal UI and optimistic list update for instant appearance

### Phase 3: Task Detail & Editing
**Goal**: Users can view full task context and make changes after creation
**Depends on**: Phase 2
**Requirements**: TASK-03, TASK-04, TASK-05
**Success Criteria** (what must be TRUE):
  1. User can click a task and open a detail view showing title, description, due date, assignees, and subtasks
  2. User can edit a task's title, description, or due date from the detail view and see changes saved
  3. User can add or change assignees on an existing task from the detail view
**Plans**: TBD

Plans:
- [ ] 03-01: Build task detail view (route or slide-over) with full field display
- [ ] 03-02: Add inline editing for title, description, due date with server action
- [ ] 03-03: Add assignee management (add/reassign) from detail view

### Phase 4: Task Prioritization
**Goal**: Users can control the personal order of their tasks via drag-and-drop
**Depends on**: Phase 3
**Requirements**: TASK-06
**Success Criteria** (what must be TRUE):
  1. User can drag a task card up or down to reorder it within a bucket
  2. After reordering, the new order persists on page refresh (member_sort_key updated in DB)
  3. Reordering one user's tasks does not affect another user's order for shared tasks
**Plans**: TBD

Plans:
- [ ] 04-01: Integrate drag-and-drop library and wire sort key update server action

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Workspace Directory | 1/2 | In Progress|  |
| 2. Task Creation | 0/2 | Not started | - |
| 3. Task Detail & Editing | 0/3 | Not started | - |
| 4. Task Prioritization | 0/1 | Not started | - |
