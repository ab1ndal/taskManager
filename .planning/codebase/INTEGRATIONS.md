# External Integrations

**Analysis Date:** 2026-03-25

## APIs & External Services

**Authentication:**
- Supabase Auth - Built-in OAuth and password-based authentication
  - SDK/Client: @supabase/supabase-js 2.98.0
  - Auth methods: Email/password sign-up, OAuth redirect flow
  - Implementation: `src/app/auth/callback/route.ts` handles OAuth callbacks with code exchange
  - Session refresh: `proxy.ts` manages cookie-based sessions across requests

**Database:**
- Supabase (PostgreSQL) - Full relational database with RLS
  - SDK/Client: @supabase/supabase-js 2.98.0
  - Session handling: @supabase/ssr 0.9.0 for cookie management in Next.js

## Data Storage

**Databases:**
- PostgreSQL via Supabase
  - Connection: `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - Client: @supabase/supabase-js createClient() from `src/lib/supabase/browser.ts` (client) and `src/lib/supabase/server.ts` (server)
  - Schema: `supabase/migrations/001_initial_schema.sql` defines workspaces, workspace_members, tasks, task_rules, task_assignments, task_updates tables
  - RLS Policies: `supabase/migrations/002_rls_policies.sql` and `003_fix_tasks_update_policy.sql` enforce row-level security

**File Storage:**
- Not implemented - No S3, Cloud Storage, or file storage integrations detected

**Caching:**
- Next.js built-in caching via revalidatePath()
- No Redis, Memcached, or external cache service detected

## Authentication & Identity

**Auth Provider:**
- Supabase Auth (OAuth + Email/Password)
  - Implementation: Supabase provides built-in auth with OAuth providers, email verification, and password reset
  - OAuth callback: `GET /auth/callback` route at `src/app/auth/callback/route.ts`
  - Session: Cookie-based sessions via @supabase/ssr, refreshed by `proxy.ts`
  - Password reset: Supports `mode=reset` query parameter in login flow
  - User retrieval: `supabase.auth.getUser()` called in proxy.ts for route protection

## Monitoring & Observability

**Error Tracking:**
- None detected - No Sentry, LogRocket, or error tracking service

**Logs:**
- console (client) and server logs (default Next.js logging)
- No external logging service detected

## CI/CD & Deployment

**Hosting:**
- Vercel (inferred from Next.js 16 and package.json name "task-manager")
- No vercel.json or deployment config file present

**CI Pipeline:**
- None detected - No GitHub Actions, GitLab CI, or CI config files found

## Environment Configuration

**Required env vars:**
```
NEXT_PUBLIC_SUPABASE_URL=https://[project].supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_[key]
NEXT_PUBLIC_SUPABASE_SECRET_KEY=sb_secret_[key]
```

**Secrets location:**
- `.env` file (local development)
- Vercel environment secrets (production)

## Webhooks & Callbacks

**Incoming:**
- `GET /auth/callback` - Supabase OAuth redirect target
  - Handles `code` parameter for authorization code exchange
  - Handles `token_hash` + `type` parameter for OTP verification (email recovery, password reset)
  - Redirects authenticated users to `/tasks` if already logged in

**Outgoing:**
- None detected - No webhook consumers to external services

## API Routes

**Authentication Endpoints:**
- `src/app/auth/callback/route.ts` - OAuth and OTP callback handler
  - POST targets: None (callback is GET only)
  - Depends on: Supabase Auth exchangeCodeForSession() and verifyOtp()

**Server Actions:**
- `src/app/tasks/actions.ts` - Server-side mutations (createTask, deleteTask, completeTask, createTaskWithSubtasks)
  - Uses: createClient() from `src/lib/supabase/server`
  - Revalidates cache with revalidatePath("/tasks")

---

*Integration audit: 2026-03-25*
