# Codebase Concerns

**Analysis Date:** 2026-03-25

## Unhandled Database Errors

**Database mutations without error checking:**
- Issue: `completeTask()` and `deleteTask()` in `src/app/tasks/actions.ts` do not check for errors returned from `.update()` and `.delete()` queries. If a database error occurs (permission denied, constraint violation, etc.), the error is silently ignored and `revalidatePath()` still executes.
- Files: `src/app/tasks/actions.ts` (lines 6-19)
- Impact: Failed task operations will appear to succeed to the user, leading to data inconsistency. Users will see tasks as completed/deleted when they are not actually changed in the database.
- Fix approach: Add error checking after all `.update()` and `.delete()` calls. Destructure `{ data, error }` and throw or return error status before revalidating cache.

**Example of issue:**
```typescript
// Current (broken) — no error check
export async function completeTask(taskId: string) {
  const supabase = await createClient();
  await supabase
    .from("tasks")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", taskId);  // Silent failure if error occurs
  revalidatePath("/tasks");
}
```

**Assignment insertion without error handling:**
- Issue: In `createTask()` and `createTaskWithSubtasks()`, `.insert()` calls on `task_assignments` do not check for errors. Failures silently continue, resulting in tasks without assignments being shown to no users.
- Files: `src/app/tasks/actions.ts` (lines 53-57, 103-107, 137-141)
- Impact: Subtly broken task creation — parent task created but member assignments fail, task becomes invisible/orphaned.
- Fix approach: Add error checking after each `.insert()` on `task_assignments`. At minimum, log errors and inform user if any assignment fails.

## Incomplete Test Coverage

**Missing error path tests:**
- Issue: Test files (`src/app/tasks/actions.test.ts`, `src/app/workspaces/actions.test.ts`) mock successful responses only. No tests verify behavior when Supabase returns errors.
- Files: `src/app/tasks/actions.test.ts`, `src/app/workspaces/actions.test.ts`
- Impact: Error handling logic is untested. Bugs in error paths won't be caught until production.
- Priority: High
- Safe test approach: Mock `.insert()` and `.update()` to return error objects, verify errors are thrown or handled correctly.

**Missing subtask failure integration:**
- Issue: `createTaskWithSubtasks()` returns `{ subtaskErrors: number }` but no tests verify the error counting logic or that partial success is handled correctly when some subtasks fail.
- Files: `src/app/tasks/actions.test.ts` (lines 74+), `src/app/tasks/actions.ts` (lines 110-143)
- Impact: Subtask creation errors are counted but user feedback might be insufficient or inaccurate.
- Priority: Medium

**Overall test file coverage:**
- 9 test files exist for 25 source files (36% coverage). Critical paths like `completeTask()`, `deleteTask()`, and assignment mutation error handling have no tests.
- Priority: High — Add tests for all error scenarios before shipping.

## Database Query N+1 Performance Issue

**Multiple sequential queries in task loading:**
- Issue: `src/app/tasks/page.tsx` performs 4 separate sequential Supabase queries to load task data:
  1. All workspace members (line 22-24)
  2. All workspaces (line 27-29)
  3. Task assignments for current user (line 56-62)
  4. Task details (line 71-77)
  5. All assignments for those tasks (line 80-85)
- Files: `src/app/tasks/page.tsx` (lines 14-90)
- Impact: Page load latency increases with more workspaces/tasks. Each query adds network round-trip. At scale (10+ workspaces, 50+ tasks), page will feel sluggish.
- Improvement path: Consolidate queries using Supabase joins where possible, or use RLS-filtered materialized views to fetch task data in fewer calls. Current 5 queries could potentially be reduced to 2-3.

## PIN-Based Workspace Joining Without Rate Limiting

**Bruteforceable 6-digit PIN:**
- Issue: `joinWorkspaceByPin()` in `src/app/workspaces/actions.ts` allows any authenticated user to guess PINs. No rate limiting, account lockout, or delay between attempts.
- Files: `src/app/workspaces/actions.ts` (lines 55-95), `supabase/migrations/004_workspace_pin.sql` (line 11)
- Impact: Attacker can systematically try all 1 million 6-digit PINs (00000-999999) and gain access to any workspace. PIN entropy is insufficient for a security boundary.
- Current mitigation: Supabase RLS policies require auth (user must be logged in), but that's weak defense against user account takeover.
- Recommendations:
  1. Implement rate limiting on PIN attempts (5 attempts per 15 minutes per user, per IP).
  2. Increase PIN entropy (use 8+ digits or alphanumeric).
  3. Log failed PIN attempts for security monitoring.
  4. Consider email-based invite links instead of PINs for higher security.

## Admin Client Exposure in Browser-Accessible Endpoint

**Secret key usage in client-side code:**
- Issue: `src/lib/supabase/admin.ts` exports `createAdminClient()` which uses `NEXT_PUBLIC_SUPABASE_SECRET_KEY`. This function is imported and called in `src/app/workspaces/actions.ts` which is a server action, so it's safe there. However, the export is available for any code to import.
- Files: `src/lib/supabase/admin.ts`, `src/app/workspaces/actions.ts` (line 4)
- Risk: Secret key is not actually exposed (it's in `.env` which is server-only), but the pattern of exporting admin clients makes them easy to accidentally use in client components.
- Recommendations: Restrict admin client to specific server action files only. Consider renaming to `createServerAdminClient()` to signal it's server-only, or enforce import path restrictions.

## Missing Error Handling in Login Flow

**Silent auth failures in reset password mode:**
- Issue: In `src/app/login/login-card.tsx`, password reset and forgot password flows handle errors but don't provide clear guidance when errors occur.
- Files: `src/app/login/login-card.tsx` (lines 46-78)
- Impact: Users stuck in password reset may not understand why their attempt failed (network error vs. invalid token vs. user not found).
- Fix approach: Add more specific error messages based on error codes. Distinguish between recoverable errors (retry) and non-recoverable (contact support).

**Unchecked session state in reset mode:**
- Issue: `hasSession` state check in reset password path (lines 30-37) fetches user but doesn't handle potential async errors from `getUser()`.
- Files: `src/app/login/login-card.tsx` (lines 30-37)
- Impact: If `getUser()` fails, `hasSession` remains false, which is acceptable but user won't know why. Should at least toast a warning if session check fails.

## Incomplete Row-Level Security Coverage

**Workspace creation RLS is permissive:**
- Issue: `workspaces_insert` policy in `supabase/migrations/004_workspace_pin.sql` (line 14-15) allows ANY authenticated user to create workspaces without restrictions. No workspace owner limit, no quota system.
- Files: `supabase/migrations/004_workspace_pin.sql` (lines 14-15)
- Impact: User with malicious intent can create unlimited workspaces, consuming database storage and confusing the workspace list UI.
- Recommendations: Add soft limit in application layer (e.g., 50 workspaces per user max). Log workspace creation for abuse detection.

**Task deletion RLS allows cascade:**
- Issue: `tasks_delete` policy (line 45-52 in `002_rls_policies.sql`) allows deletion of any task assigned to the user, which cascade-deletes all subtasks and assignments without warning.
- Files: `supabase/migrations/002_rls_policies.sql` (lines 45-52), `src/app/tasks/actions.ts` (lines 15-19)
- Impact: A single accidental delete call will destroy a task family (parent + all subtasks). No recovery mechanism (soft delete, archive, or undo).
- Recommendations: Implement soft delete (mark `deleted_at` instead of hard delete), or add confirmation UI that shows what will be deleted (including subtask count).

## Missing Validation and Sanitization

**User input not validated in task creation:**
- Issue: `createTask()` and `createTaskWithSubtasks()` accept `title`, `description`, `dueAt` without length limits or format validation. JavaScript `.trim()` is applied but no max length enforced.
- Files: `src/app/tasks/actions.ts` (lines 21-61, 63-147)
- Impact: User can create tasks with extremely long titles (10k+ characters) or with misleading dates. Could cause UI layout issues or confusion.
- Recommendations: Add max length validation (e.g., 255 chars for title, 5000 for description). Validate `dueAt` is a valid ISO date and not in the past.

**PIN not validated in workspace join:**
- Issue: `joinWorkspaceByPin()` calls `.trim()` on PIN but doesn't validate format (should be 6 digits).
- Files: `src/app/workspaces/actions.ts` (line 70)
- Impact: Invalid PINs could be queried against the database. Clearer error messaging needed if user enters non-numeric PIN.

## Untested Subtask Completion Logic

**Subtask completion does not update parent status:**
- Issue: Per `docs/product.md` (line 83), "A task is completed when the entire task and all its subtasks are marked as complete." However, `completeTask()` does not fetch subtasks to check overall completion status.
- Files: `src/app/tasks/actions.ts` (lines 6-13)
- Impact: Parent task can be marked complete while subtasks remain open, violating spec. UI will show inconsistent task state.
- Fix approach: When completing a task, query for `parent_task_id = taskId` to find subtasks. Only allow completion if all subtasks are complete, or auto-complete subtasks on parent completion.

## Missing Timezone Handling

**Due date storage ambiguity:**
- Issue: `dueAt` is stored as `timestamptz` but UI accepts `datetime-local` input (line 149 in `new-task-modal.tsx`). The timestamp is submitted as-is without explicit timezone handling.
- Files: `src/app/tasks/new-task-modal.tsx` (lines 148-150), `src/app/tasks/actions.ts` (lines 86, 116)
- Impact: If user sets due date in different timezone (e.g., traveling), task deadline may be off by hours. Deadline calculations in `bucket-tasks.ts` may show wrong deadline color.
- Recommendations: Store user's timezone preference in `workspace_members` table. Convert all due dates to user's local timezone for display and calculation.

## Race Condition in Task Sort Key Generation

**Concurrent task creation may assign duplicate sort keys:**
- Issue: In `createTask()` and `createTaskWithSubtasks()`, sort key is determined by querying max `member_sort_key` and adding 1000. Two concurrent inserts could query same max, both assign same sort key.
- Files: `src/app/tasks/actions.ts` (lines 42-57, 94-108, 128-142)
- Impact: Two tasks assigned same sort key will have unpredictable order. Re-ordering UI may fail if it assumes unique keys.
- Fix approach: Use database sequence or trigger to generate sort keys atomically, or use `NOW()` timestamp as sort key instead of numeric increment.

## Scaling Concerns

**All workspace members loaded per page view:**
- Issue: `src/app/tasks/page.tsx` fetches ALL members from ALL workspaces user belongs to, every time tasks page loads (line 22-24).
- Files: `src/app/tasks/page.tsx` (lines 22-24)
- Impact: At 50+ workspaces with 5+ members each, this query loads 250+ rows every page load.
- Improvement: Filter workspace members to only current workspace context, or use pagination/lazy loading.

**No pagination on task queries:**
- Issue: All task assignments and tasks for a user are fetched in a single query with no limit. User with 1000 tasks loads entire dataset.
- Files: `src/app/tasks/page.tsx` (lines 56-85)
- Impact: Slow page loads and high memory usage for power users with many tasks.
- Improvement: Implement pagination (load first 50 tasks, show "load more"), or virtual scrolling.

---

*Concerns audit: 2026-03-25*
