# Architecture

**Analysis Date:** 2026-03-25

## Pattern Overview

**Overall:** Next.js 16 App Router with server-first architecture using Server Components and Server Actions.

**Key Characteristics:**
- Server Components for data fetching and initial render
- Server Actions for mutations with automatic cache revalidation
- Client Components for interactive UI and state management
- Row-Level Security (RLS) enforced at database level via Supabase
- Request-scoped authentication via cookie-based sessions
- Type-safe API layer through Supabase JavaScript client

## Layers

**Authentication & Session Management:**
- Purpose: Verify user identity and maintain session across requests
- Location: `proxy.ts` (next.js 16 edge-level proxy), `src/lib/supabase/server.ts` (server-side session)
- Contains: Session refresh logic, route guards, auth state
- Depends on: Supabase Auth via cookies
- Used by: All pages, Server Components, Server Actions

**Data Access (Supabase Clients):**
- Purpose: Provide isolated client instances for server-side and browser-side database access
- Location: `src/lib/supabase/server.ts`, `src/lib/supabase/browser.ts`, `src/lib/supabase/admin.ts`
- Contains: Client factory functions with proper cookie/token management
- Depends on: Supabase SDK (@supabase/ssr, @supabase/supabase-js)
- Used by: Server Components, Server Actions, Client Components

**Server Components (Page Logic):**
- Purpose: Fetch data server-side, apply RLS filters, compose UI layout
- Location: `src/app/tasks/page.tsx`, `src/app/workspaces/page.tsx`, `src/app/profile/page.tsx`
- Contains: Data fetching, RLS-protected queries, conditional rendering
- Depends on: Supabase server client, app router context
- Used by: Browser via Server-Side Rendering

**Server Actions (Mutations):**
- Purpose: Handle database mutations with automatic cache invalidation
- Location: `src/app/tasks/actions.ts`, `src/app/workspaces/actions.ts`, `src/app/auth/callback/route.ts`
- Contains: Task CRUD (create, complete, delete), workspace management (create, join by PIN)
- Depends on: Supabase server client, revalidatePath
- Used by: Client Components via useTransition hook

**Client Components (Interactive UI):**
- Purpose: Manage local state, handle user interactions, call Server Actions
- Location: `src/app/tasks/tasks-page-client.tsx`, `src/components/task-card.tsx`, `src/components/toaster.tsx`
- Contains: useState, useTransition, event handlers, form submissions
- Depends on: Server Actions, local state
- Used by: Server Components as children

**Utility Functions & Data Transformations:**
- Purpose: Pure logic for client and server (date buckets, pin generation, etc.)
- Location: `src/app/tasks/bucket-tasks.ts`, `src/app/workspaces/actions.ts` (generatePin)
- Contains: Data transformation, sorting, filtering logic
- Depends on: Standard libraries (no external deps)
- Used by: Server Components, Client Components, Server Actions

**UI Component Library:**
- Purpose: Reusable, presentational components with Tailwind styling
- Location: `src/components/` (avatar.tsx, task-card.tsx, nav-user.tsx, toaster.tsx)
- Contains: Task cards, badges, modals, badges, navigation elements
- Depends on: React, Tailwind CSS, Supabase client (for browser.ts usage in nav-user)
- Used by: Page-level components, other UI components

**Layout & Root:**
- Purpose: Global layout, metadata, navigation chrome, global providers
- Location: `src/app/layout.tsx`
- Contains: Root HTML structure, nav bar with workspace tabs, Toaster provider
- Depends on: Server-side auth check
- Used by: All pages as wrapper

## Data Flow

**Task Display Flow:**

1. User navigates to `/tasks` → Server Component (`src/app/tasks/page.tsx`) executes
2. Server Component calls `createClient()` → Creates server-side Supabase client with session cookies
3. Server Component fetches:
   - User's workspace memberships via `workspace_members` table (RLS filters to user's rows)
   - User's task assignments via `task_assignments` (RLS filtered)
   - Full task data via `tasks` (RLS filtered via assignment join)
4. Data is transformed into `RawTask[]` type with workspace and assignee info
5. `bucketTasks()` utility sorts and categorizes tasks into overdue/today/upcoming/completed
6. Server Component renders UI with `TasksPageClient` wrapper component
7. `TasksPageClient` (client component) renders task list + sidebar with workspace filters
8. User clicks task checkbox or "New Task" button → calls Server Action via `useTransition`

**Task Mutation Flow (Complete/Delete):**

1. User clicks complete button on `TaskCard` (client component)
2. `useTransition` hooks calls Server Action `completeTask(taskId)`
3. Server Action (`src/app/tasks/actions.ts`) creates server client and updates task
4. Server Action calls `revalidatePath("/tasks")` → invalidates `/tasks` cache
5. Browser re-fetches page data → Server Component executes again
6. Updated task list renders to user

**Task Creation Flow:**

1. User clicks "New Task" button in `TasksPageClient`
2. Opens `NewTaskModal` (client component) with workspace/assignee selection
3. User submits form → calls `createTask` or `createTaskWithSubtasks` Server Action
4. Server Action inserts task + creates task_assignments records for each selected member
5. Each assignment gets auto-incremented sort key (1000, 2000, 3000, etc.)
6. `revalidatePath("/tasks")` invalidates cache
7. Page re-renders with new task visible

**Authentication Flow:**

1. Unauthenticated user attempts to access any route
2. `proxy.ts` intercepts request at edge
3. Proxy checks if `user` exists in Supabase auth session
4. If no user and not auth-related route → redirect to `/login`
5. If user and at `/login` → redirect to `/tasks`
6. If user exists → refresh session cookies and continue

**State Management:**

- **Server State:** Stored in database, fetched fresh per request, managed via Server Components
- **Session State:** Stored in auth cookies (Supabase session), managed by `proxy.ts`
- **Client State:** Local component state via `useState` (modal open/close, filter tabs)
- **Cache State:** Next.js fetch cache, invalidated via `revalidatePath()` in Server Actions
- **Real-time:** Not implemented; uses traditional request/response pattern

## Key Abstractions

**Supabase Client Factory Pattern:**
- Purpose: Isolate client creation logic, handle auth context injection, normalize setup across server/browser
- Examples: `src/lib/supabase/server.ts`, `src/lib/supabase/browser.ts`
- Pattern: Export a `createClient()` function; server version uses cookies from context, browser version uses static env vars

**Server Action Pattern:**
- Purpose: Encapsulate mutations with automatic revalidation and error handling
- Examples: `completeTask()`, `deleteTask()`, `createTask()`, `createWorkspace()`, `joinWorkspaceByPin()`
- Pattern: `"use server"` directive, async function, returns result or throws error, calls `revalidatePath()` at end

**Toast Notification System:**
- Purpose: Global, event-driven notifications from any client component
- Location: `src/components/toaster.tsx`
- Pattern: Export `toast(message, type)` function that dispatches `CustomEvent`; Toaster component listens and renders

**Type Aliases for API Responses:**
- Purpose: Define shape of data flowing from server to client
- Examples: `RawTask`, `BucketedTask`, `TaskBuckets` in `src/app/tasks/bucket-tasks.ts`
- Pattern: Export type from utility file, import in components/pages

**Workspace Kind Classification:**
- Purpose: Distinguish household vs. work tasks without separate tables
- Pattern: Single `workspaces` table with `kind` column (string: "household" or "work"), drives UI icons and filtering

## Entry Points

**Web Request Entry:**
- Location: `proxy.ts`
- Triggers: Every HTTP request
- Responsibilities: Session validation, route guard redirects, cookie refresh

**Page Entry (Async Server Component):**
- Location: `src/app/layout.tsx` (root), `src/app/page.tsx` (home), `src/app/tasks/page.tsx`, `src/app/workspaces/page.tsx`
- Triggers: Navigation to route
- Responsibilities: Fetch data, check auth, compose UI tree, pass props to client components

**Client Interaction Entry:**
- Location: Event handlers in Client Components (e.g., `onClick` → Server Action via `useTransition`)
- Triggers: User click, form submit
- Responsibilities: Validate input, call Server Action, show loading state

**API Routes (if used):**
- Location: `src/app/auth/callback/route.ts` (Supabase OAuth redirect)
- Triggers: OAuth provider redirect
- Responsibilities: Exchange auth code for session tokens, set cookies, redirect to app

## Error Handling

**Strategy:** Minimal error handling (relies on Supabase errors bubbling up); manual try/catch in Server Actions with error throws.

**Patterns:**
- Server Actions throw errors on failure (no explicit catch/handling in most actions)
- Client components rely on Supabase PostREST error responses (e.g., 404, 409 for constraint violations)
- `createTask()` and `createWorkspace()` perform retry logic on constraint violations (PIN collision)
- Toast notifications used for user-facing feedback (success only in current implementation, errors not surfaced in UI)

## Cross-Cutting Concerns

**Logging:** No centralized logging; browser console.log and server console.error available but not implemented.

**Validation:** Client-side only (form inputs checked before submission); server-side via Supabase constraints and RLS.

**Authentication:** Supabase Auth handles JWT tokens; session cookies managed by `@supabase/ssr`; verified in `proxy.ts` and Server Components.

---

*Architecture analysis: 2026-03-25*
