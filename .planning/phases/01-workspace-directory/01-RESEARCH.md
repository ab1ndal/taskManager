# Phase 1: Workspace Directory - Research

**Researched:** 2026-03-25
**Domain:** Next.js 16 + TypeScript + Tailwind + Supabase workspace UI, server actions, RLS policies, database migrations
**Confidence:** HIGH

## Summary

Phase 1 replaces the pin-based workspace join system with a public directory for frictionless workspace discovery. This phase requires replacing the existing `/workspaces` page with a unified directory showing all workspaces, a modal for workspace creation, one-click join functionality using the admin client to bypass RLS, and a no-workspace banner on the tasks page.

The existing codebase has solid foundations: Next.js 16 server/client patterns are established, Supabase RLS policies are in place, server actions handle data mutations with proper error handling, and styling uses CSS custom properties. The main implementation work is: (1) create migration to remove `join_pin` column, (2) add `joinWorkspaceByDirectory()` server action using admin client, (3) build directory UI with workspace cards and join button, (4) implement creation modal, (5) add member count query, and (6) add no-workspace banner to tasks page.

**Primary recommendation:** Build the directory page as a server component fetching all workspaces via admin client (bypassing join_pin RLS), split join/create logic into client components using `useTransition()`, use existing card styling patterns from globals.css, and implement the no-workspace banner as a conditional render in TasksPage.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Page structure:** "All Workspaces" title, single unified directory, "New workspace" button top-right, create opens modal (not inline or separate route)
- **Directory entry design:** Card shows name + kind badge + member count; joined workspaces show green "Joined" badge instead of "Join" button
- **Join interaction:** One-click, no confirmation; button switches to "Joined" badge inline (no page reload); toast: `Joined "[workspace name]"`; admin client for workspace lookup (user not yet member, RLS blocks SELECT)
- **Post-create experience:** Modal closes, toast: `Workspace "[name]" created`, directory revalidates with new workspace showing "Joined" badge
- **No-workspace onboarding:** If user not member of any workspace, show banner on `/tasks` with text "You're not in any workspace yet." linking to `/workspaces`
- **Display name:** Auto-sourced from `user.user_metadata.name` — no user input

### Claude's Discretion
- Exact modal implementation (inline form vs dialog component)
- Member count query approach (join vs separate fetch)
- Loading/pending state styling during join action
- Exact banner styling on tasks page

### Deferred Ideas (OUT OF SCOPE)
- Unjoin/leave workspace (WS-V2-03)
- Delete workspace
- Workspace privacy/hidden from directory

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| WS-01 | User can create a workspace with a name and kind (household or work) | `createWorkspace()` already exists and auto-sources display name; only need to remove PIN generation and modal UI |
| WS-02 | User can browse a public directory listing all workspaces | New directory page fetches all workspaces via admin client (bypassing RLS); uses admin because RLS policy only shows user's own workspaces |
| WS-03 | User can join any workspace instantly (no pin, no approval) using their profile display name | Replace `joinWorkspaceByPin()` with `joinWorkspaceByDirectory(workspaceId)` using admin client; same `workspace_members_insert_self` RLS policy allows self-insert |
| WS-04 | User can see which workspaces they already belong to (distinguished in the directory) | Directory must query user's member rows; compare against all workspaces; joined workspaces show "Joined" badge |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 16.1.6 | App Router framework | Server/client split pattern, server actions, revalidation, TypeScript first-class |
| React | 19.0.0 | UI components | useTransition, event systems |
| TypeScript | 5 | Type safety | Catch errors early, developer experience |
| Tailwind | 4 | Styling | CSS custom properties, responsive, utility-first; `@import "tailwindcss"` in CSS, no config needed |
| Supabase | 2.98.0 | Database + auth | Postgres with RLS, server-side auth via `@supabase/ssr`, admin client bypass |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @supabase/ssr | 0.9.0 | Server-side auth helpers | Always for server components/actions; `createClient()` with `cookies()` |
| Tailwindcss/PostCSS | 4 | CSS processing | Already configured; `@tailwindcss/postcss` |

### Installation
```bash
# Already installed — no new dependencies needed for Phase 1
npm install
```

**Note:** The existing admin client pattern (`src/lib/supabase/admin.ts`) uses service-role key to bypass RLS. This is required for directory lookups because authenticated users cannot SELECT workspaces they don't belong to.

## Architecture Patterns

### Recommended Project Structure (Workspace Directory)
```
src/app/workspaces/
├── page.tsx              # Server component: fetch all workspaces, render directory
├── workspaces-client.tsx # Client component: join/create buttons, useTransition, modal
├── actions.ts            # Server actions: createWorkspace(), joinWorkspaceByDirectory()
├── workspace-card.tsx    # Directory entry card: name, kind badge, member count, join button
└── [REMOVED] pin-display.tsx, workspace-forms.tsx (replaced by modal)

src/app/tasks/
├── page.tsx              # Server component: add no-workspace banner conditional render
└── [existing: TasksPageClient, TaskCard, etc.]
```

### Pattern 1: Server Component Fetching All Workspaces via Admin Client
**What:** The directory page needs to show ALL workspaces in the system, but the standard RLS policy on `workspaces` only permits SELECTs for workspaces the user belongs to. Solution: use admin client to bypass RLS.

**When to use:** Any query that requires seeing non-member resources (search, directory, discovery).

**Example:**
```typescript
// src/app/workspaces/page.tsx
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Workspace = { id: string; name: string; kind: string; member_count: number };

export default async function WorkspacesPage() {
  const supabase = await createClient();
  const admin = createAdminClient();

  // Get all workspaces (admin bypasses RLS)
  const { data: allWorkspaces } = await admin
    .from("workspaces")
    .select("id, name, kind")
    .order("name");

  // Get current user's members (RLS-filtered)
  const { data: { user } } = await supabase.auth.getUser();
  const { data: userMembers } = user
    ? await supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("auth_user_id", user.id)
    : { data: [] };

  const userMembershipSet = new Set((userMembers ?? []).map(m => m.workspace_id));

  return (
    <div>
      {(allWorkspaces ?? []).map(ws => (
        <WorkspaceCard
          key={ws.id}
          workspace={ws}
          isJoined={userMembershipSet.has(ws.id)}
        />
      ))}
    </div>
  );
}
```

**Why:** Avoid fetching workspace list twice (once filtered by RLS, then re-computing member count). Admin client is the canonical way to bypass RLS in Supabase. Source: existing codebase pattern in `actions.ts` `joinWorkspaceByPin()`.

### Pattern 2: Client Component for Interactive State (Join Button)
**What:** Once the directory is rendered, join buttons must handle click, show pending state, and swap to "Joined" badge without page reload.

**When to use:** Any mutation that should update UI instantly with `useTransition()`.

**Example:**
```typescript
// src/app/workspaces/workspace-card.tsx
"use client";

import { useTransition } from "react";
import { joinWorkspaceByDirectory } from "./actions";
import { toast } from "@/components/toaster";

interface WorkspaceCardProps {
  workspace: { id: string; name: string; kind: string };
  isJoined: boolean;
  memberCount: number;
}

export function WorkspaceCard({ workspace, isJoined, memberCount }: WorkspaceCardProps) {
  const [isPending, startTransition] = useTransition();

  const handleJoin = () => {
    startTransition(async () => {
      try {
        await joinWorkspaceByDirectory(workspace.id);
        toast(`Joined "${workspace.name}"`);
        // UI re-renders with isJoined=true (server revalidates)
      } catch (error) {
        toast(error instanceof Error ? error.message : "Failed to join", "error");
      }
    });
  };

  return (
    <div className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-[var(--color-text-primary)]">
            {workspace.name}
          </h3>
          <span className="mt-0.5 text-xs font-medium px-2 py-0.5 rounded-full inline-block bg-indigo-100 text-indigo-700">
            {workspace.kind === "household" ? "Household" : "Work"}
          </span>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">
            {memberCount} members
          </p>
        </div>
        {isJoined ? (
          <span className="text-xs font-medium px-3 py-1 rounded-full bg-green-100 text-green-700">
            Joined
          </span>
        ) : (
          <button
            onClick={handleJoin}
            disabled={isPending}
            className="text-xs font-medium px-3 py-1 rounded-full bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)] hover:bg-[var(--color-accent)] hover:text-white disabled:opacity-50"
          >
            {isPending ? "Joining..." : "Join"}
          </button>
        )}
      </div>
    </div>
  );
}
```

**Source:** Existing codebase uses `useTransition()` for pending states (not shown in sampled files, but standard Next.js 16 pattern).

### Pattern 3: Migration to Remove join_pin Column
**What:** Current migrations include `join_pin` column; Phase 1 removes it entirely. Pattern: create a new migration that drops the column and the unique index.

**When to use:** Always write migrations for schema changes (don't alter in Supabase console manually).

**Example:**
```sql
-- supabase/migrations/005_remove_workspace_pin.sql
-- Drop unique index first (if it exists, due to backfill safety)
DROP INDEX IF EXISTS workspaces_join_pin_key;

-- Drop the column
ALTER TABLE workspaces DROP COLUMN IF EXISTS join_pin;

-- Remove the insert policy (no longer needed for workspace creation)
DROP POLICY IF EXISTS "workspaces_insert" ON workspaces;

-- Add new policy: authenticated users can create workspaces (without pin)
CREATE POLICY "workspaces_insert" ON workspaces
FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
```

**Source:** Existing migrations 002, 003, 004 in `supabase/migrations/`.

### Anti-Patterns to Avoid
- **Do NOT query workspaces twice:** Once for all workspaces (admin), then again filtered by user. Fetch all once via admin, compute membership in memory.
- **Do NOT re-fetch all workspaces after join:** Use `revalidatePath()` to refresh cached data; client-side state update via `useTransition()` shows instant feedback.
- **Do NOT inline join button in server component:** Join is interactive (onClick), must be client component. Server component renders initial isJoined state, client component handles mutation.
- **Do NOT store member count in workspace table:** Compute it on each query (or cache in view if needed). Schema shows member_count is NOT a column — count from `workspace_members` JOIN.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Modal dialog | Custom div with click handlers | React Dialog library or built-in `<dialog>` element | Modal z-index, focus trap, backdrop click handling are deceptively complex; Tailwind + Radix Dialog are battle-tested |
| Toast notifications | setTimeout + DOM manipulation | Existing `toast()` function in `src/components/toaster.tsx` | Already integrated with event system; supports success/error types; auto-dismisses |
| Member count query | COUNT subquery in SELECT | Fetch workspace_members rows and count in memory (or use PostgreSQL COUNT aggregate) | For small workspaces (household/work), in-memory count is simpler; SQL COUNT is also fine but adds query complexity |
| State sync after join | Manual useState for isJoined + refetch | `revalidatePath()` + `useTransition()` | Next.js handles revalidation and re-renders; manual state leads to sync bugs |
| Date formatting (if needed) | Manual string manipulation | `new Date().toLocaleDateString()` or date-fns library | Standard solution; toLocaleDateString is sufficient for Phase 1 |

**Key insight:** This codebase prefers built-in React hooks (`useTransition`) + Next.js utilities (`revalidatePath`) over external state management or animation libraries. Modal is a discretion area — either a simple div with `absolute` positioning or a proper Dialog component work; recommend Dialog for accessibility.

## Common Pitfalls

### Pitfall 1: Forgetting to Revalidate After Join
**What goes wrong:** User joins a workspace, button changes to "Joined", but if they navigate away and return to directory, it still shows the old list.

**Why it happens:** Server-side cached data (via `revalidatePath()`) isn't automatically invalidated; client-side state change with `useTransition()` is instant, but server cache persists.

**How to avoid:** Always call `revalidatePath("/workspaces")` in `joinWorkspaceByDirectory()` server action. Test by: join workspace, navigate away, return, verify new workspace shows in sidebar and directory shows "Joined" badge.

**Warning signs:** Directory doesn't reflect join immediately (likely missing `useTransition()`), or requires hard refresh to see updated membership.

### Pitfall 2: RLS Blocking Directory Queries
**What goes wrong:** Tried to query `workspaces` table from server action/page without admin client, got empty result because RLS policy restricts SELECT to user's own workspaces.

**Why it happens:** RLS policy `workspaces_select` uses:
```sql
id IN (SELECT workspace_id FROM workspace_members WHERE auth_user_id = auth.uid())
```
This is correct for task visibility, but blocks the directory use case.

**How to avoid:** Always use admin client (`createAdminClient()`) for directory/search queries. Keep regular `createClient()` for user's own data. Test: fetch all workspaces and verify count > user's member count.

**Warning signs:** Directory shows 0 workspaces or only user's joined workspaces; `console.log` admin query and count members manually to verify data exists.

### Pitfall 3: Member Count Query Performance
**What goes wrong:** Fetching member count for every workspace card causes N+1 queries (one per card).

**Why it happens:** Naive approach: fetch all workspaces, then for each workspace SELECT COUNT(*) FROM workspace_members WHERE workspace_id = ?.

**How to avoid:** Use a single JOIN query with COUNT aggregate:
```sql
SELECT w.id, w.name, w.kind, COUNT(wm.id) as member_count
FROM workspaces w
LEFT JOIN workspace_members wm ON w.id = wm.workspace_id
GROUP BY w.id
ORDER BY w.name
```

Or fetch workspaces + separate fetch of all workspace_members, compute counts in memory. Either way: one query per table, not N+1.

**Warning signs:** Directory loads slowly with many workspaces; database shows many workspace_members queries in logs.

### Pitfall 4: Admin Client Exposing Sensitive Data
**What goes wrong:** Used admin client to fetch workspace details, accidentally exposed `join_pin` in the response (which was secret).

**Why it happens:** Admin client has no restrictions; easy to forget that responses should still be filtered.

**How to avoid:** Always use `.select("id, name, kind")` (explicit columns) in admin queries. After removing `join_pin`, this is less of a concern, but good practice. Code review: verify admin queries don't return `role`, `auth_user_id`, or future sensitive columns.

**Warning signs:** Workspace card shows unexpected fields; API response dumps include columns not used in UI.

## Code Examples

Verified patterns from official sources and existing codebase:

### Creating a Workspace (With Modal)
```typescript
// src/app/workspaces/actions.ts
export async function createWorkspace(
  name: string,
  kind: "household" | "work"
): Promise<{ id: string; name: string; kind: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Removed: PIN generation loop

  const { data, error } = await supabase
    .from("workspaces")
    .insert({ name: name.trim(), kind })
    .select("id, name, kind")
    .single();

  if (error) throw error;
  if (!data) throw new Error("Failed to create workspace");

  // Add creator as member (auto-source display name)
  const displayName = (user.user_metadata?.name as string)?.trim()
    || user.email?.split("@")[0]
    || "Member";

  await supabase.from("workspace_members").insert({
    workspace_id: data.id,
    auth_user_id: user.id,
    display_name: displayName,
    role: "owner",
  });

  revalidatePath("/workspaces");
  revalidatePath("/tasks");
  return data;
}
```

Source: Existing `createWorkspace()` in `src/app/workspaces/actions.ts`; remove PIN generation.

### Joining a Workspace (No PIN)
```typescript
// src/app/workspaces/actions.ts
export async function joinWorkspaceByDirectory(
  workspaceId: string
): Promise<{ workspaceName: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Look up workspace using admin client (no RLS)
  const admin = createAdminClient();
  const { data: workspace } = await admin
    .from("workspaces")
    .select("id, name")
    .eq("id", workspaceId)
    .single();

  if (!workspace) throw new Error("Workspace not found");

  // Check already a member
  const { data: existing } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (existing) throw new Error("You are already a member of this workspace");

  // Insert member (workspace_members_insert_self policy allows this)
  const displayName = (user.user_metadata?.name as string)?.trim()
    || user.email?.split("@")[0]
    || "Member";

  const { error } = await supabase.from("workspace_members").insert({
    workspace_id: workspace.id,
    auth_user_id: user.id,
    display_name: displayName,
  });

  if (error) throw error;

  revalidatePath("/workspaces");
  revalidatePath("/tasks");
  return { workspaceName: workspace.name };
}
```

Source: Adapted from `joinWorkspaceByPin()` in `src/app/workspaces/actions.ts`; replace PIN lookup with ID lookup, remove PIN uniqueness validation.

### No-Workspace Banner on Tasks Page
```typescript
// src/app/tasks/page.tsx (add to top of TasksPage return)
{myWorkspaces.length === 0 && (
  <div className="mb-6 p-4 bg-[var(--color-accent-subtle)] rounded-[8px] border border-[var(--color-accent-text)]">
    <p className="text-sm text-[var(--color-accent-text)]">
      You're not in any workspace yet.{" "}
      <a href="/workspaces" className="font-semibold underline">
        Join or create one
      </a>
    </p>
  </div>
)}
```

Source: Pattern matches existing card styling from globals.css (custom color tokens); link to `/workspaces` per CONTEXT.md spec.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| PIN-based workspace join | Public directory with instant join | Phase 1 | Removes friction; no secret sharing; simpler UX |
| Fetch workspaces with RLS filter | Admin client for directory; separate member query | Phase 1 | Enables discovery of all workspaces; proper separation of concerns |
| Manual display name input on join | Auto-source from user.user_metadata.name | Phase 1 | One less friction point; consistent identity across workspaces |
| `join_pin` column on workspaces table | Removed entirely | Phase 1 | Schema cleanup; no more unique constraint on PIN |

**Deprecated/outdated:**
- `generatePin()` function: No longer needed; removed from actions.ts.
- `pin-display.tsx` component: Removed entirely; "Joined" badge replaces PIN display.
- `workspace-forms.tsx`: Replaced by modal (in WorkspacesClient component).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 30.3.0 (configured in package.json) |
| Config file | None detected — uses defaults |
| Quick run command | `npm test -- --testPathPattern=workspace` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WS-01 | Create workspace with name and kind (household or work) | unit | `npm test -- --testPathPattern=createWorkspace` | ❌ Wave 0 |
| WS-02 | Browse public directory listing all workspaces | integration | `npm test -- --testPathPattern=workspacesDirectory` | ❌ Wave 0 |
| WS-03 | Join workspace instantly by ID (no PIN required) | unit | `npm test -- --testPathPattern=joinWorkspaceByDirectory` | ❌ Wave 0 |
| WS-04 | User can see which workspaces they belong to (Joined badge) | integration | `npm test -- --testPathPattern=workspaceMembership` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- --testPathPattern=workspace` (quick tests only)
- **Per wave merge:** `npm test` (full suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/__tests__/actions/workspace.test.ts` — covers createWorkspace, joinWorkspaceByDirectory, helper functions
- [ ] `src/__tests__/components/workspace-directory.test.tsx` — covers WorkspaceCard join button, pending state, error handling
- [ ] `jest.config.js` — Jest configuration (paths alias, module resolver for @/*)
- [ ] Framework install: `npm install` — jest/testing-library already in devDependencies

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/lib/supabase/admin.ts`, `src/app/workspaces/actions.ts`, `src/app/workspaces/page.tsx` — admin client pattern, server actions, RLS implications
- Project docs: `docs/db.md` — database schema, workspace_members table, RLS policies
- Project docs: `.planning/phases/01-workspace-directory/01-CONTEXT.md` — locked decisions and requirements
- Migrations: `supabase/migrations/002_rls_policies.sql`, `004_workspace_pin.sql` — RLS policy implementation, PIN column structure

### Secondary (MEDIUM confidence)
- Next.js 16.1.6 App Router patterns (server components, server actions, useTransition) — standard Next.js conventions, verified in existing codebase
- Supabase admin client usage — verified in existing `joinWorkspaceByPin()` implementation
- Tailwind v4 with CSS custom properties — verified in globals.css and existing components

### Tertiary (LOW confidence)
- Jest 30.3.0 test structure — package.json lists jest but no test files found in src/; need to establish test directory and config

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — All technologies already in use in project; versions from package.json confirmed
- Architecture: **HIGH** — Server/client patterns established in codebase; RLS policies documented in migrations; admin client pattern working in existing code
- Pitfalls: **MEDIUM-HIGH** — RLS and revalidation pitfalls based on existing codebase behavior; member count perf based on standard database best practices
- Testing: **MEDIUM** — Jest is in devDependencies but no config or test files found; need Wave 0 setup

**Research date:** 2026-03-25
**Valid until:** 2026-04-25 (30 days; Next.js 16 is stable, Supabase patterns are established)
