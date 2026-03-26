# Deferred Items

## Pre-existing TypeScript error (out of scope for 01-01)

**File:** `src/app/tasks/new-task-modal.tsx` line 99
**Error:** `Argument of type '"warning"' is not assignable to parameter of type '"error" | "success" | undefined'`
**Context:** The toast function does not accept a "warning" type. This was present before plan 01-01 changes.
**Discovered during:** Task 2 (TypeScript build verification)
