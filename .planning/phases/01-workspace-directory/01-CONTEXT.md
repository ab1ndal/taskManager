# Phase 1: Workspace Directory - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace pin-based workspace joining with a public directory. Users can create workspaces (household or work), browse all workspaces in a directory, and join any workspace instantly — no pin, no approval. Display name is auto-sourced from profile. Workspaces the user already belongs to are visually distinguished. Also includes an onboarding prompt on the tasks page for users with no workspace.

Explicitly out of scope: leaving/unjoining a workspace, deleting tasks on unjoin (deferred to v2).

</domain>

<decisions>
## Implementation Decisions

### Page structure
- Page title: "All Workspaces" — no subtitle
- Single unified directory: one list showing ALL workspaces (joined and unjoined)
- "New workspace" button positioned top-right of the page header
- Create workspace opens a modal (not inline form or separate route)

### Directory entry design
- Each workspace card shows: name + kind badge (Household / Work) + member count (e.g. "3 members")
- Joined workspaces show a green "Joined" badge instead of a "Join" button
- Visual pattern matches existing cards: `rounded-[8px]` border, CSS variable colors

### Join interaction
- One-click, no confirmation: clicking "Join" immediately joins the workspace
- No display name input — auto-sourced from `user.user_metadata.name`
- After joining: button switches to green "Joined" badge inline (no page reload)
- Toast: `Joined "[workspace name]"`
- The join action uses the admin client to look up the workspace (user is not a member yet, RLS blocks SELECT)

### Post-create experience
- Modal closes after successful creation
- Toast: `Workspace "[name]" created`
- Directory revalidates and new workspace appears with "Joined" badge
- No PIN banner (pins are removed entirely)
- Empty directory state: "No workspaces yet. Create the first one!" with the "New workspace" button visible

### No-workspace onboarding prompt
- If the authenticated user is not a member of any workspace, show a banner on the `/tasks` page
- Banner text: "You're not in any workspace yet." with a link to `/workspaces`
- Banner appears at the top of the tasks content area (above any task buckets)

### Claude's Discretion
- Exact modal implementation (inline form vs dialog component)
- Member count query approach (join vs separate fetch)
- Loading/pending state styling during join action
- Exact banner styling on tasks page

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Database & Auth
- `docs/db.md` — Database schema design, RLS policies, query patterns
- `supabase/migrations/` — All existing migrations (read before writing new ones)

### Product requirements
- `docs/product.md` — Product requirements for all features

### Existing workspace code (READ BEFORE MODIFYING)
- `src/app/workspaces/page.tsx` — Current workspace page (server component, will be replaced)
- `src/app/workspaces/actions.ts` — Current server actions (pin system to remove, new join action to add)
- `src/app/workspaces/workspace-forms.tsx` — Current forms (will be replaced with modal + directory)
- `src/app/tasks/page.tsx` — Tasks page (needs no-workspace banner added)

### Styling reference
- `src/app/globals.css` — CSS custom properties (color tokens used throughout)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/toaster.tsx` — `toast(msg)` / `toast(msg, "error")` for success/error feedback (client components only)
- `src/lib/supabase/server.ts` — `createClient()` for server components and server actions
- `src/lib/supabase/admin.ts` — `createAdminClient()` for queries that need to bypass RLS (e.g., looking up a workspace the user isn't yet a member of)
- Existing card pattern: `rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3`

### Established Patterns
- Server component fetches data, client component handles interaction (`page.tsx` + `*-client.tsx` pattern from tasks/)
- `useTransition()` for server action pending states (no extra loading state libraries)
- `revalidatePath()` in server actions to refresh cached data
- Error surfaced via `toast(msg, "error")` and inline error state in client

### Integration Points
- `/workspaces` route: existing page.tsx will need a full replacement
- `/tasks` page: needs a conditional no-workspace banner (query workspace_members count)
- `workspace_members` insert: existing `workspace_members_insert_self` RLS policy allows users to insert their own member row
- Admin client needed for `workspaces` SELECT during join (RLS only allows SELECT on workspaces the user belongs to)

### What to Remove
- `src/app/workspaces/pin-display.tsx` — delete
- `join_pin` column from `workspaces` table (migration needed)
- `generatePin()` and `joinWorkspaceByPin()` from `actions.ts`
- `WorkspaceForms` join-by-pin section

</code_context>

<specifics>
## Specific Ideas

No specific references — open to standard approaches for modal and directory patterns.

</specifics>

<deferred>
## Deferred Ideas

- **Unjoin/leave workspace** — user wants to be able to leave a workspace, with all their task assignments deleted on unjoin. Explicitly v2 (WS-V2-03). Implement in a future phase.
- **Delete workspace** — user mentioned wanting to delete a workspace. New capability, not in Phase 1 scope. Add to roadmap backlog.
- **Workspace privacy** — making a workspace private/hidden from directory. Already listed as WS-V2-02.

</deferred>

---

*Phase: 01-workspace-directory*
*Context gathered: 2026-03-25*
