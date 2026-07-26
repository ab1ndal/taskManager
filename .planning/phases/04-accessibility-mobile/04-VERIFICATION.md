---
phase: 04-accessibility-mobile
plan: 06
status: pending
---

# Phase 4 — Manual Verification Checklist

> Human-in-the-loop checks jsdom cannot prove. Run in a real browser/device, then fill in
> the Result column and flip `status: pending` → `status: complete` above once all four pass.
> Structure follows `04-VALIDATION.md`'s "Manual-Only Verifications" table.

Prep: `npm run dev`, open the app in a real browser.

| # | Behavior | Requirement | Why Manual | Test Instructions | Result |
|---|----------|-------------|-------------|--------------------|--------|
| 1 | Keyboard walk + focus containment | U3 | jsdom `HTMLDialogElement`/top-layer stacking is incomplete (jsdom#3294) — cannot prove focus never escapes | Open new-task modal. Tab repeatedly — confirm focus cycles only inside the modal, never reaching the page behind (nav links, sidebar). Shift+Tab from the first field — confirm it wraps to the last focusable element inside the modal. Press Escape — confirm modal closes and focus returns to the "New task" button. Repeat for edit-task modal (via a task card's edit button) and the delete-confirm dialog (via a task card's delete button); for the delete dialog additionally confirm the **first** tab stop on open is Cancel, not Delete. | ⬜ pending |
| 2 | Screen reader announces both toast politeness levels | U4 | Announcement timing/interruption is assistive-tech behavior, not DOM state jest-axe can assert | Enable VoiceOver (macOS Safari) or a mobile screen reader. Create a task — confirm the success toast is announced without interrupting current speech. Force an error (e.g. submit an edit with an emptied title) — confirm the error toast interrupts and announces immediately, and does NOT auto-dismiss — you must be able to navigate to and activate its dismiss button. | ⬜ pending |
| 3 | Real mobile viewport — no overflow/dead space, tap targets reliable | U7, U1 | `100dvh` collapsing-address-bar behavior and real touch-target spacing can't be simulated headlessly | Open the tasks page on an iPhone/Android (or Chrome DevTools device emulation). Scroll down then up so the address bar hides/shows — confirm no horizontal scrollbar and no dead space at the bottom when the bar collapses. Tap the complete/edit/delete buttons on a task card in quick succession — confirm each hits reliably without triggering its neighbor. | ⬜ pending |
| 4 | Leaked-password protection enabled | — (dashboard toggle, not code) | Supabase Auth dashboard setting, not a code path | Log into the Supabase dashboard for this project → Authentication → Settings → enable "Leaked password protection". | ⬜ pending |

## Sign-off

- [ ] All four checks recorded pass
- [ ] `status: complete` set in frontmatter above
- [ ] Reply "approved" in the execute-phase session (or re-run `/gsd-execute-phase 4 --wave 3`) to close out plan 04-06 and complete Phase 4
