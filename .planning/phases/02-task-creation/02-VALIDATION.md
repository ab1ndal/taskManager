---
phase: 2
slug: task-creation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-26
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest 30.3.0 + React Testing Library 16.3.2 |
| **Config file** | `jest.config.ts` |
| **Quick run command** | `npx jest --testPathPattern="tasks"` |
| **Full suite command** | `npx jest` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx jest --testPathPattern="tasks"`
- **After every plan wave:** Run `npx jest`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 2-01-01 | 01 | 0 | TASK-01 | unit | `npx jest src/app/tasks/actions.test.ts` | ✅ | ⬜ pending |
| 2-01-02 | 01 | 1 | TASK-01 | unit | `npx jest src/app/tasks/actions.test.ts` | ✅ | ⬜ pending |
| 2-02-01 | 02 | 0 | TASK-02 | unit | `npx jest src/app/tasks/tasks-page-client.test.tsx` | ❌ W0 | ⬜ pending |
| 2-02-02 | 02 | 1 | TASK-02 | unit | `npx jest src/app/tasks/tasks-page-client.test.tsx` | ❌ W0 | ⬜ pending |
| 2-02-03 | 02 | 1 | TASK-02 | unit | `npx jest src/app/tasks/tasks-page-client.test.tsx` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/app/tasks/tasks-page-client.test.tsx` — stubs for TASK-02 (optimistic insert, bucket placement, error rollback)

*Existing `actions.test.ts` and `new-task-modal.test.tsx` cover TASK-01 actions and modal interaction.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Task appears immediately after submit without reload | TASK-02 | Optimistic UI timing is browser-observable | Open /tasks, submit new task, verify it appears without full page reload |
| Task visible only to selected assignees | TASK-01 | Multi-user session required | Log in as assignee → see task; log in as non-assignee → don't see task |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
