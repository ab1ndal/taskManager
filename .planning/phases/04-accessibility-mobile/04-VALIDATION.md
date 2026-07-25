---
phase: 4
slug: accessibility-mobile
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-25
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `04-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 30.3.0 + @testing-library/react 16.3.2 + jest-axe 10.0.0 (NEW, dev-only) |
| **Config file** | `jest.config.ts` (existing) + `jest.setup.ts` (add `jest-axe/extend-expect`) |
| **Quick run command** | `npm test -- --testPathPattern='(task-card\|toaster\|dialog)' --maxWorkers=4` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5s quick / ~3s full suite (120+ tests) |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --testPathPattern='(task-card|dialog|toaster)' --maxWorkers=4`
- **After every plan wave:** Run `npm test` + keyboard walk
- **Before `/gsd:verify-work`:** Full suite green + manual mobile keyboard/VoiceOver pass recorded
- **Max feedback latency:** 5 seconds

---

## Per-Requirement Verification Map

Per-task IDs are filled in by the planner; this map fixes the requirement → test contract.

| Requirement | Behavior | Test Type | Automated Command | File | Status |
|-------------|----------|-----------|-------------------|------|--------|
| U1 | Complete/edit/delete buttons have 44×44px hit area | unit | `npm test -- task-card.test.tsx` | `src/components/__tests__/task-card.test.tsx` | ⬜ pending |
| U1 | Subtask toggles have 44×44px hit area | unit | `npm test -- task-card.test.tsx` | `src/components/__tests__/task-card.test.tsx` | ⬜ pending |
| U2 | Focus-visible outline on all focusable elements | unit (jest-axe) | `npm test -- --testNamePattern="focus-visible"` | `src/components/__tests__/task-card.test.tsx` + new focus tests | ⬜ pending |
| U3 | Dialog opens via `showModal()` with `role="dialog"` | unit | `npm test -- new-task-modal.test.tsx` | `src/app/tasks/new-task-modal.test.tsx` | ⬜ pending |
| U3 | Escape closes dialog | unit (userEvent) | `npm test -- --testNamePattern="Escape"` | `src/app/tasks/new-task-modal.test.tsx` | ⬜ pending |
| U3 | Focus trapped inside dialog | unit (userEvent) | `npm test -- --testNamePattern="tab"` | `src/app/tasks/new-task-modal.test.tsx` | ⚠️ partial (jsdom) |
| U3 | Focus restored to trigger on close | unit (userEvent) | `npm test -- --testNamePattern="focus.*restore"` | `src/app/tasks/new-task-modal.test.tsx` | ⚠️ partial (jsdom) |
| U4 | Success toast in `role="status"` / `aria-live="polite"` region | unit (jest-axe) | `npm test -- toaster.test.tsx` | `src/components/__tests__/toaster.test.tsx` | ⬜ pending |
| U4 | Error toast in `role="alert"` / `aria-live="assertive"` region, no auto-dismiss | unit (jest-axe) | `npm test -- toaster.test.tsx` | `src/components/__tests__/toaster.test.tsx` | ⬜ pending |
| U4 | Toast announces within 500ms | unit (fake timers) | `npm test -- toaster.test.tsx` | `src/components/__tests__/toaster.test.tsx` | ⬜ pending |
| U5 | All/Household/Work pills removed from layout | static check | `grep -n "All / Household / Work" src/app/layout.tsx` | `src/app/layout.tsx` | ⬜ pending |
| U5 | Nav links hidden when `getUser()` returns null | unit | `npm test -- layout.test.tsx` | `src/app/layout.test.tsx` | ⬜ pending |
| U7 | Dynamic viewport height replaces `calc(100vh-52px)` | static check | `grep -n "dvh" src/app/tasks/tasks-page-client.tsx` | `src/app/tasks/tasks-page-client.tsx` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky/partial*

---

## Wave 0 Requirements

- [ ] `npm install --save-dev jest-axe` — no fallback; required for a11y assertions
- [ ] `jest.setup.ts` — add `import "jest-axe/extend-expect"` for `toHaveNoViolations()`
- [ ] `src/components/__tests__/dialog.test.tsx` — Dialog component open/close/focus behavior
- [ ] `src/components/__tests__/task-card.test.tsx` — extend for 44px hit areas + task-scoped labels
- [ ] `src/components/__tests__/toaster.test.tsx` — live regions, dismiss buttons, auto-dismiss timing
- [ ] `src/app/tasks/new-task-modal.test.tsx` — migrate to Dialog, keyboard tests
- [ ] `src/app/tasks/edit-task-modal.test.tsx` — migrate to Dialog, keyboard tests
- [ ] `src/app/layout.test.tsx` — nav hidden when signed out

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Focus outline never clips or disappears | U2 | Visual rendering not observable in jsdom | Tab through every page; confirm outline visible on each control |
| Dialog top-layer stacking + real focus containment | U3 | jsdom `showModal()` top-layer incomplete (jsdom#3294) | Open modal in browser, Tab through, press Escape, confirm focus returns to trigger |
| Mobile layout has no overflow / double padding | U7 | Requires real device viewport + URL bar behavior | Open on iPhone Safari; scroll; confirm no horizontal overflow, no dead space |
| Screen reader announces toasts | U4 | Announcement is AT behavior, not DOM state | VoiceOver on iOS: trigger success and error toast, confirm both announce |

Record manual results in `04-VERIFICATION.md` before the phase closes.

---

## Validation Sign-Off

- [ ] All tasks have automated verify or a Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (jest-axe install + setup)
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
