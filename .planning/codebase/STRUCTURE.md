# Codebase Structure

**Analysis Date:** 2026-03-25

## Directory Layout

```
taskManager/
├── src/
│   ├── app/                    # Next.js 16 App Router
│   │   ├── layout.tsx          # Root layout (nav bar, toaster)
│   │   ├── page.tsx            # Home page (redirects to /tasks)
│   │   ├── globals.css         # Tailwind v4 theme + custom properties
│   │   ├── auth/
│   │   │   └── callback/       # OAuth redirect handler
│   │   │       ├── resolve-next.ts
│   │   │       └── route.ts
│   │   ├── login/              # Login page
│   │   │   ├── page.tsx
│   │   │   └── login-card.tsx
│   │   ├── profile/            # Profile page
│   │   │   └── page.tsx
│   │   ├── tasks/              # Tasks feature
│   │   │   ├── page.tsx        # Server component (data fetch, layout)
│   │   │   ├── tasks-page-client.tsx  # Client component (modal, sidebar)
│   │   │   ├── actions.ts      # Server actions (CRUD)
│   │   │   ├── bucket-tasks.ts # Task filtering/sorting utility
│   │   │   ├── completed-section.tsx  # Collapsed completed tasks
│   │   │   ├── new-task-modal.tsx     # Task creation modal
│   │   │   ├── tab-pill.tsx    # Mobile tab navigation
│   │   │   ├── *.test.ts(x)    # Jest tests
│   │   │   └── *.test.tsx      # Jest tests
│   │   └── workspaces/         # Workspaces feature
│   │       ├── page.tsx        # Server component (list workspaces)
│   │       ├── actions.ts      # Server actions (create, join)
│   │       ├── workspace-forms.tsx  # Create/join forms
│   │       ├── pin-display.tsx # Show/copy PIN UI
│   │       └── *.test.ts       # Jest tests
│   ├── components/             # Shared UI components
│   │   ├── toaster.tsx         # Global toast notifications
│   │   ├── nav-user.tsx        # User menu + logout
│   │   ├── task-card.tsx       # Task display card + actions
│   │   ├── avatar.tsx          # User avatar
│   │   └── __tests__/          # Component tests
│   │       ├── avatar.test.tsx
│   │       └── login-card.test.tsx
│   └── lib/                    # Utility functions
│       └── supabase/           # Supabase client setup
│           ├── server.ts       # Server-side client (uses cookies)
│           ├── browser.ts      # Browser-side client (uses env vars)
│           └── admin.ts        # Admin client (bypasses RLS)
├── proxy.ts                    # Next.js 16 edge proxy (auth redirect, session refresh)
├── jest.config.ts              # Jest configuration
├── jest.setup.ts               # Jest setup (testing library)
├── tsconfig.json               # TypeScript configuration
├── package.json                # Dependencies and scripts
└── supabase/                   # Database (managed in Supabase Cloud)
    └── migrations/             # SQL migrations (version control)
```

## Directory Purposes

**`src/app/`:**
- Purpose: Page routes and feature modules using Next.js App Router
- Contains: Route pages, server components, server actions, feature-specific client components
- Key files: `layout.tsx` (root), `page.tsx` per route

**`src/app/tasks/`:**
- Purpose: Task management feature (display, filter, create, complete, delete)
- Contains: Server component for data fetch, client component for interactivity, actions for mutations, utilities for task bucketing
- Key files: `page.tsx` (fetch + layout), `tasks-page-client.tsx` (modal + sidebar), `actions.ts` (mutations), `bucket-tasks.ts` (utility)

**`src/app/workspaces/`:**
- Purpose: Workspace management (create workspace, join by PIN, view list)
- Contains: Server component for list, client components for forms, actions for create/join mutations
- Key files: `page.tsx` (list), `actions.ts` (mutations), `workspace-forms.tsx` (create + join UI)

**`src/app/auth/`:**
- Purpose: Authentication routes (OAuth callback only)
- Contains: Route handlers for Supabase OAuth redirect
- Key files: `callback/route.ts`

**`src/app/login/`:**
- Purpose: Login/signup page
- Contains: Server component wrapper, client component form
- Key files: `page.tsx`, `login-card.tsx`

**`src/components/`:**
- Purpose: Reusable UI components across features
- Contains: Task card, toast notifications, user menu, avatar
- Key files: `task-card.tsx`, `toaster.tsx`, `nav-user.tsx`

**`src/lib/supabase/`:**
- Purpose: Supabase client factories
- Contains: Server-side client (with cookie context), browser-side client, admin client
- Key files: `server.ts`, `browser.ts`, `admin.ts`

## Key File Locations

**Entry Points:**
- `proxy.ts`: Next.js 16 edge-level request proxy (auth guard, session refresh)
- `src/app/layout.tsx`: Root layout wrapping all pages
- `src/app/page.tsx`: Home page (redirects to /tasks)

**Configuration:**
- `tsconfig.json`: TypeScript compiler with `@/*` path alias
- `jest.config.ts`: Jest test runner setup with jsdom environment
- `jest.setup.ts`: Testing library imports
- `src/app/globals.css`: Tailwind v4 theme with CSS custom properties

**Core Logic:**
- `src/lib/supabase/server.ts`: Server-side database client with session cookies
- `src/app/tasks/bucket-tasks.ts`: Task filtering/sorting (overdue, today, upcoming, completed)
- `src/app/tasks/actions.ts`: Task mutations (create, complete, delete)
- `src/app/workspaces/actions.ts`: Workspace mutations (create, join by PIN)

**Testing:**
- `src/app/tasks/actions.test.ts`: Unit tests for task actions
- `src/app/tasks/bucket-tasks.test.ts`: Unit tests for task bucketing logic
- `src/components/__tests__/avatar.test.tsx`: Component tests

## Naming Conventions

**Files:**
- Server components: `page.tsx`, `{feature}.tsx` (e.g., `tasks-page-client.tsx`)
- Server actions: `actions.ts` (colocated in feature directory)
- Client components: Any file with `"use client"` directive
- Utilities: `{name}.ts` (e.g., `bucket-tasks.ts`, `pin-generation.ts`)
- Tests: `{name}.test.ts` or `{name}.test.tsx` or `__tests__/{name}.test.tsx`

**Directories:**
- Features: Lowercase, plural or singular per convention (`tasks/`, `workspaces/`, `auth/`)
- Components: `components/` (shared), `__tests__/` for co-located tests
- Utilities: `lib/` (generic), feature-specific utilities colocated in feature dir

**Functions:**
- Server actions: camelCase, export directly (e.g., `completeTask()`, `createWorkspace()`)
- Client components: PascalCase, export as named exports (e.g., `TaskCard()`, `NewTaskModal()`)
- Utilities: camelCase (e.g., `bucketTasks()`, `generatePin()`)

**Types/Interfaces:**
- PascalCase (e.g., `RawTask`, `BucketedTask`, `TaskBuckets`, `Workspace`)
- Exported from where they're used (e.g., types in `bucket-tasks.ts` imported in page.tsx)

## Where to Add New Code

**New Feature (e.g., task subtasks):**
- Create feature directory: `src/app/tasks/`
- Page component: `src/app/{feature}/page.tsx` (fetch data)
- Client component: `src/app/{feature}/{feature}-client.tsx` (UI + state)
- Actions: `src/app/{feature}/actions.ts` (mutations)
- Utilities: `src/app/{feature}/{utility}.ts` (pure functions)
- Tests: `src/app/{feature}/{name}.test.ts` or `__tests__/{name}.test.tsx`

**New Component (e.g., task priority badge):**
- Location: `src/components/{name}.tsx` (shared across features)
- Export: Named export (e.g., `export function PriorityBadge()`)
- Tests: `src/components/__tests__/{name}.test.tsx`
- Usage: Import in any page or client component

**Utilities (e.g., date formatting):**
- Location: `src/lib/{name}.ts` (generic) or `src/app/{feature}/{name}.ts` (feature-specific)
- Export: Named exports or default
- Tests: Colocated as `{name}.test.ts`

**API Routes (e.g., webhook handler):**
- Location: `src/app/api/{route}/route.ts` (Next.js convention)
- Export: `POST()`, `GET()`, etc. (standard Next.js handlers)
- Authentication: Use `createClient()` from `src/lib/supabase/server.ts`

## Special Directories

**`proxy.ts`:**
- Purpose: Next.js 16 edge-level request proxy (named `proxy.ts` not `middleware.ts`)
- Generated: No
- Committed: Yes

**`supabase/migrations/`:**
- Purpose: SQL migration files for database schema changes
- Generated: No (manually authored)
- Committed: Yes (version control for database)

**`.next/`:**
- Purpose: Next.js build output
- Generated: Yes (created by `npm run build`)
- Committed: No (in .gitignore)

**`node_modules/`:**
- Purpose: Installed dependencies
- Generated: Yes (created by `npm install`)
- Committed: No (in .gitignore)

**`.env` (if present):**
- Purpose: Environment variables for development
- Generated: No (manually created)
- Committed: No (in .gitignore) — use `.env.example` for documentation
- Contains: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_SECRET_KEY` (at minimum)

---

*Structure analysis: 2026-03-25*
