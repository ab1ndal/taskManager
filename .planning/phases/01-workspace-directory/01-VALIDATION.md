---
phase: 1
slug: workspace-directory
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-25
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest 30.x |
| **Config file** | `jest.config.js` (none — Wave 0 installs) |
| **Quick run command** | `npx jest --testPathPattern="workspace"` |
| **Full suite command** | `npx jest` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx jest --testPathPattern="workspace"`
- **After every plan wave:** Run `npx jest`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 0 | WS-01 | infra | `npx jest --listTests` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 1 | WS-01 | unit | `npx jest --testPathPattern="workspace.actions"` | ❌ W0 | ⬜ pending |
| 1-01-03 | 01 | 1 | WS-01 | unit | `npx jest --testPathPattern="workspace.actions"` | ❌ W0 | ⬜ pending |
| 1-02-01 | 02 | 2 | WS-02 | unit | `npx jest --testPathPattern="workspace.directory"` | ❌ W0 | ⬜ pending |
| 1-02-02 | 02 | 2 | WS-03 | unit | `npx jest --testPathPattern="workspace.directory"` | ❌ W0 | ⬜ pending |
| 1-02-03 | 02 | 2 | WS-04 | unit | `npx jest --testPathPattern="workspace.directory"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `jest.config.js` — Jest configuration for Next.js 16 + TypeScript
- [ ] `src/__tests__/workspace.actions.test.ts` — stubs for WS-01 (create, join actions)
- [ ] `src/__tests__/workspace.directory.test.ts` — stubs for WS-02, WS-03, WS-04 (directory listing, join, badge)

*Wave 0 must install test config before Wave 1 tasks run.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Workspace directory renders all workspaces visually | WS-02 | UI rendering requires browser | Navigate to /workspaces, confirm all workspaces visible |
| "Joined" badge appears on joined workspaces | WS-04 | Visual state requires browser | Login as Alice, navigate to /workspaces, confirm Home workspace shows "Joined" |
| Instant join with no pin prompt | WS-03 | User flow requires browser | Login as Bob, click join on Acme Corp, confirm no pin dialog appears |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
