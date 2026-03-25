# Requirements: Hearth

**Defined:** 2026-03-25
**Core Value:** Users can create, manage, and complete tasks across household and work workspaces — with frictionless workspace onboarding and full task lifecycle control.

## v1 Requirements

### Workspace Management

- [ ] **WS-01**: User can create a workspace with a name and kind (household or work)
- [ ] **WS-02**: User can browse a public directory listing all workspaces
- [ ] **WS-03**: User can join any workspace instantly (no pin, no approval) using their profile display name
- [ ] **WS-04**: User can see which workspaces they already belong to (distinguished in the directory)

### Task Creation

- [ ] **TASK-01**: User can create a task with title, optional description, optional due date, workspace, and one or more assignees
- [ ] **TASK-02**: Newly created task appears immediately in the task list without page reload

### Task Detail & Editing

- [ ] **TASK-03**: User can open a task detail view showing full title, description, due date, assignees, and subtasks
- [ ] **TASK-04**: User can edit a task's title, description, and due date from the detail view
- [ ] **TASK-05**: User can reassign or add members to an existing task

### Task Prioritization

- [ ] **TASK-06**: User can drag tasks to reorder their personal priority (updates member_sort_key)

## v2 Requirements

### Workspace Management

- **WS-V2-01**: Workspace owner can remove members
- **WS-V2-02**: Workspace owner can make workspace private (hidden from directory)
- **WS-V2-03**: User can leave a workspace

### Task Management

- **TASK-V2-01**: User can add text updates/comments to a task
- **TASK-V2-02**: User can create subtasks from the task detail view
- **TASK-V2-03**: User receives notifications when assigned to a task

## Out of Scope

| Feature | Reason |
|---------|--------|
| Pin-based workspace join | Replaced by public directory — simpler UX |
| Join approval flow | Instant join is appropriate for this use case |
| Per-workspace display names | Profile name auto-used — avoids extra friction |
| Mobile app | Web-first |
| Real-time collaboration | Not in current scope |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| WS-01 | Phase 1 | Pending |
| WS-02 | Phase 1 | Pending |
| WS-03 | Phase 1 | Pending |
| WS-04 | Phase 1 | Pending |
| TASK-01 | Phase 2 | Pending |
| TASK-02 | Phase 2 | Pending |
| TASK-03 | Phase 3 | Pending |
| TASK-04 | Phase 3 | Pending |
| TASK-05 | Phase 3 | Pending |
| TASK-06 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 10 total
- Mapped to phases: 10
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-25*
*Last updated: 2026-03-25 — traceability updated after roadmap creation*
