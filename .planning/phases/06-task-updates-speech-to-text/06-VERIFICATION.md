# Phase 6 Manual Verification

Run through these in a real browser — none are meaningfully testable against a mock.

- [ ] **Chrome — mic button appears, tap starts listening, tap again stops.** Speak a full
  sentence with a natural pause in the middle; confirm the session doesn't silently end after the
  pause (auto-restart working) and the full sentence lands in the textarea.
- [ ] **Chrome — deny microphone permission.** Confirm the inline error ("Microphone access was
  denied") appears instead of a silent failure.
- [ ] **Safari (macOS or iOS) — mic button appears and works** (confirms the
  `webkitSpeechRecognition` prefix path).
- [ ] **Firefox — no mic button renders**, typing still works normally.
- [ ] **Add a text update without dictation**, confirm it appears immediately (optimistic) and
  survives a page refresh (persisted).
- [ ] **Add a subtask to an existing task** from the edit modal, confirm it appears in the task
  card's subtask list after closing the modal.
- [ ] **Two workspace members both assigned to the same task** — confirm each sees the other's
  updates with the correct author name.
