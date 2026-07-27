# Phase 6 Manual Verification

Run through these in a real browser — none are meaningfully testable against a mock.

Run by hand on 2026-07-27 against `localhost:3000` (the `task-manager-dev` project). All checks
below passed. Five observations came out of the run and are raised as followups F15–F19 in
`.planning/phases/06.5-app-wide-ui-polish/06.5-FOLLOWUPS.md`.

- [x] **Chrome — mic button appears, tap starts listening, tap again stops.** Speak a full
  sentence with a natural pause in the middle; confirm the session doesn't silently end after the
  pause (auto-restart working) and the full sentence lands in the textarea.
- [x] **Chrome — deny microphone permission.** Confirm the inline error ("Microphone access was
  denied") appears instead of a silent failure.
- [x] **Safari (macOS or iOS) — mic button appears and works** (confirms the
  `webkitSpeechRecognition` prefix path).
- [x] **Firefox — no mic button renders**, typing still works normally.
- [x] **Add a text update without dictation**, confirm it appears immediately (optimistic) and
  survives a page refresh (persisted).
- [ ] **Add a subtask to an existing task** from the edit modal, confirm it appears in the task
  card's subtask list after closing the modal.
- [ ] **Two workspace members both assigned to the same task** — confirm each sees the other's
  updates with the correct author name.
