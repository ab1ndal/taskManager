# Coding Conventions

**Analysis Date:** 2026-03-25

## Naming Patterns

**Files:**
- Components: PascalCase (e.g., `LoginCard.tsx`, `TaskCard.tsx`)
- Pages: kebab-case (e.g., `page.tsx` in route folders)
- Utilities and services: camelCase (e.g., `bucket-tasks.ts`, `resolve-next.ts`)
- Test files: suffix with `.test.ts` or `.test.tsx` (e.g., `actions.test.ts`, `avatar.test.tsx`)

**Functions:**
- React components: PascalCase (e.g., `TaskCard`, `CompletedSection`, `LoginCard`)
- Utility functions: camelCase (e.g., `bucketTasks`, `completeTask`, `createTask`)
- Event handlers: `handle` prefix in camelCase (e.g., `handleSubmit`, `handleClick`)
- Type validation/helper functions: camelCase (e.g., `resolveNext`)

**Variables:**
- Constants: camelCase (e.g., `deadlineStyles`, `sortKey`)
- Component props: camelCase (e.g., `taskId`, `workspaceId`, `onClose`)
- State variables: camelCase (e.g., `modalOpen`, `loading`, `sessionChecked`)

**Types:**
- Custom types: PascalCase (e.g., `Mode`, `BucketedTask`, `TaskBuckets`, `DeadlineVariant`)
- Type aliases: PascalCase (e.g., `RawTask`, `WorkspaceMember`)
- Enum-like unions: lowercase with pipes (e.g., `"red" | "yellow" | "green"`)

## Code Style

**Formatting:**
- No explicit formatter configuration (no `.prettierrc`)
- Manual formatting observed with consistent patterns:
  - 2-space indentation
  - Template strings for dynamic className composition
  - Ternary operators for inline conditionals
  - Multi-line JSX elements properly indented

**Linting:**
- ESLint enabled (`npm run lint`) via Next.js default config
- No custom `.eslintrc` file — uses `eslint-config-next`
- TypeScript strict mode enabled (`"strict": true` in tsconfig.json)

## Import Organization

**Order:**
1. React and Next.js imports: `import { ... } from "react"`, `import { ... } from "next/*"`
2. Third-party libraries: `import { ... } from "@supabase/..."`
3. Local imports: `import { ... } from "@/..."`
4. Type imports (when needed): `import type { ... } from "@/..."`

**Path Aliases:**
- Project root alias: `@/*` maps to `src/*` (configured in `tsconfig.json`)
- All local imports use `@/` prefix (e.g., `@/lib/supabase/server`, `@/components/task-card`)

**Example pattern from `src/app/login/login-card.tsx`:**
```typescript
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/browser";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { toast } from "@/components/toaster";
```

## Error Handling

**Patterns:**
- Server actions throw errors on DB failures (see `src/app/tasks/actions.ts`):
  ```typescript
  if (error || !task) throw new Error(error?.message ?? "Failed to create task");
  ```
- Client components use try-catch in event handlers (implicit in form submission pattern)
- Failed subtasks logged via return value (e.g., `{ subtaskErrors: number }`) rather than thrown
- Supabase errors destructured and checked: `const { error, data } = await client.from(...)`

**Toast notifications:**
- Use `toast(message)` for success (default)
- Use `toast(message, "error")` for errors
- Called from client components only (imported from `@/components/toaster`)

## Logging

**Framework:** Browser `console` and custom toast system

**Patterns:**
- No debug logging found in source code
- Error messages bubble up via Supabase error responses
- Toast system used for user-facing feedback (success/error)
- Comments indicate intentional behavior (e.g., `// stay in forgot mode — intentional`)

## Comments

**When to Comment:**
- Mark intentional fallthrough logic (e.g., line 74 in `login-card.tsx`: `// stay in forgot mode — intentional`)
- Explain non-obvious state management (e.g., resetting errors on mode change)
- Notes about browser/server API differences in try-catch blocks (e.g., "Called from a Server Component — safe to ignore")

**JSDoc/TSDoc:**
- Minimal usage observed
- Type annotations preferred over comment-based documentation
- Function signatures are self-documenting with TypeScript types

## Function Design

**Size:**
- Average 15-40 lines for utility functions
- Server actions typically 10-20 lines of direct logic
- UI components 30-100 lines including JSX

**Parameters:**
- Destructured object parameters for clarity: `({ title, dueAt, workspaceId, memberIds }: { ... })`
- Explicit type annotations on function parameters
- React hooks preferred over prop drilling

**Return Values:**
- Server actions return void or error objects: `Promise<{ subtaskErrors: number }>`
- Utility functions return typed objects: `TaskBuckets`, `BucketedTask`
- Components return JSX or null
- Error cases throw or return error indicators (not null checks)

## Module Design

**Exports:**
- Named exports for functions and components (e.g., `export function TaskCard(...) { ... }`)
- Utility functions grouped by domain (e.g., `bucket-tasks.ts`, `actions.ts`)
- Type exports: `export type RawTask = { ... }`

**Barrel Files:**
- Not heavily used; direct imports from files preferred
- Example: Import directly from `@/app/tasks/actions` rather than from a barrel index

**Server vs Client:**
- Server components (default): Use for data fetching, RLS policies
- Client components: Marked with `"use client"` at top of file
- Server actions: Marked with `"use server"` at top of file, imported into client components
- Clear separation prevents accidental client-side imports of server code

## TypeScript Usage

**Type Definitions:**
- Inline prop types in React component signatures:
  ```typescript
  function TaskCard({
    taskId,
    title,
    deadline,
    deadlineVariant,
    workspace,
    shared,
    completed,
  }: {
    taskId: string;
    title: string;
    deadline?: string | null;
    deadlineVariant?: DeadlineVariant | null;
    workspace: string;
    shared?: boolean;
    completed?: boolean;
  })
  ```
- Extracted types for reusability across multiple locations

**Optional vs Required:**
- Required properties: plain type (e.g., `taskId: string`)
- Optional properties: `?` marker (e.g., `deadline?: string | null`)
- Nullable values: `| null` union (e.g., `string | null`)

## Tailwind Patterns

**CSS Variables:**
- Design tokens as CSS custom properties: `var(--color-bg)`, `var(--color-accent)`, `var(--color-text-primary)`
- Used in Tailwind class names: `bg-[var(--color-surface)]`, `text-[var(--color-text-primary)]`
- Arbitrary values with brackets: `p-[3px]`, `rounded-[9px]`, `w-[200px]`

**Responsive Classes:**
- Mobile-first approach with `md:` breakpoint prefix
- Example: `flex md:hidden` (flex on mobile, hidden on medium+)

---

*Convention analysis: 2026-03-25*
