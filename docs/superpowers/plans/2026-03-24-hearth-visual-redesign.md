# Hearth Visual Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the task manager's visual shell into "Hearth" — a warm, personal app with a violet accent palette, Inter typography, sidebar layout, and light SVG graphics.

**Architecture:** All changes are purely visual — CSS custom properties via Tailwind v4's `@theme` block, updated JSX markup in existing pages/components, and one new shared `Avatar` component. No Supabase queries, auth logic, or routing changes.

**Tech Stack:** Next.js 16, Tailwind v4 (`@theme` CSS custom properties), Inter via `next/font/google`, inline SVGs (no icon library), Jest + React Testing Library for component tests.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `jest.config.ts` | **Create** | Jest configuration |
| `jest.setup.ts` | **Create** | Jest setup — imports jest-dom matchers |
| `src/app/globals.css` | Modify | Add `@theme` design token block + Inter font |
| `src/components/avatar.tsx` | **Create** | Reusable initials avatar circle (nav + profile) |
| `src/components/__tests__/avatar.test.tsx` | **Create** | Avatar component tests |
| `src/components/__tests__/task-card.test.tsx` | **Create** | TaskCard / DeadlineBadge tests |
| `src/app/layout.tsx` | Modify | Nav: wordmark, tab pills, avatar, warm bg |
| `src/components/nav-user.tsx` | Modify | Replace text link + button with avatar + inline sign out |
| `src/app/login/page.tsx` | Modify | Blob graphics, `hearth.` wordmark, violet tokens |
| `src/app/tasks/page.tsx` | Modify | Sidebar layout, mock task cards, empty state SVG |
| `src/app/profile/page.tsx` | Modify | Avatar row, token-consistent form styling |

---

## Task 0: Test Framework Setup

**Files:**
- Modify: `package.json`
- Create: `jest.config.ts`
- Create: `jest.setup.ts`
- Create: `src/components/__tests__/avatar.test.tsx` (written in Task 2)

- [ ] **Step 1: Install dependencies**

```bash
npm install --save-dev jest jest-environment-jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event ts-jest @types/jest
```

- [ ] **Step 2: Create jest.config.ts**

```ts
import type { Config } from "jest";

const config: Config = {
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: { jsx: "react-jsx" } }],
  },
  testMatch: ["**/__tests__/**/*.test.tsx", "**/__tests__/**/*.test.ts"],
};

export default config;
```

- [ ] **Step 3: Create jest.setup.ts**

```ts
import "@testing-library/jest-dom";
```

- [ ] **Step 4: Add test script to package.json**

In `package.json`, add to the `"scripts"` block:

```json
"test": "jest",
"test:watch": "jest --watch"
```

- [ ] **Step 5: Verify setup works**

```bash
npx jest --passWithNoTests
```

Expected: "Test Suites: 0 skipped, 0 total" — no errors.

- [ ] **Step 6: Commit**

```bash
git add jest.config.ts jest.setup.ts package.json package-lock.json
git commit -m "chore: add Jest + React Testing Library test framework"
```

---

## Task 1: Design Tokens

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Replace globals.css content**

Replace the entire file:

```css
@import "tailwindcss";

@theme {
  /* Colors */
  --color-bg: #FAF9F7;
  --color-surface: #FFFFFF;
  --color-border: #E8E4F0;
  --color-text-primary: #1C1A24;
  --color-text-secondary: #6B6878;
  --color-text-muted: #A09CB0;
  --color-accent: #7C5CBF;
  --color-accent-hover: #6A4DAD;
  --color-accent-subtle: #EDE8F8;
  --color-accent-text: #5B3FA8;
  --color-deadline-red: #E05252;
  --color-deadline-yellow: #D4A017;
  --color-deadline-green: #4A9B6F;

  /* Radius */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;

  /* Shadows */
  --shadow-card: 0 1px 3px rgba(0,0,0,0.05), 0 1px 8px rgba(124,92,191,0.05);
  --shadow-login: 0 8px 32px rgba(124,92,191,0.14), 0 2px 8px rgba(0,0,0,0.06);
}
```

- [ ] **Step 2: Verify build passes**

```bash
npm run build
```

Expected: Compiled successfully with no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "feat: add Hearth design token system to globals.css"
```

---

## Task 2: Inter Font + Avatar Component

**Files:**
- Modify: `src/app/layout.tsx` (font setup only)
- Create: `src/components/avatar.tsx`
- Create: `src/components/__tests__/avatar.test.tsx`

- [ ] **Step 1: Add Inter font to layout.tsx**

At the top of `src/app/layout.tsx`, add the font import and apply it to the body:

```tsx
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"] });
```

Then on the `<body>` tag, add `className={inter.className}` (merge with existing classes):

```tsx
<body className={`${inter.className} min-h-screen bg-[var(--color-bg)] text-[var(--color-text-primary)]`}>
```

- [ ] **Step 2: Create src/components/avatar.tsx**

```tsx
export function Avatar({ name, email, size = "sm" }: {
  name: string;
  email: string;
  size?: "sm" | "lg";
}) {
  const initials = (name || email).charAt(0).toUpperCase();
  const sizeClasses = size === "lg"
    ? "w-14 h-14 text-2xl"
    : "w-[30px] h-[30px] text-xs";

  return (
    <div
      className={`${sizeClasses} rounded-full bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)] font-semibold flex items-center justify-center flex-shrink-0`}
      aria-label={`Avatar for ${name || email}`}
    >
      {initials}
    </div>
  );
}
```

- [ ] **Step 3: Write Avatar tests**

Create `src/components/__tests__/avatar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { Avatar } from "../avatar";

describe("Avatar", () => {
  it("shows first letter of name as initials", () => {
    render(<Avatar name="Alice" email="alice@example.com" />);
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("falls back to email initial when name is empty", () => {
    render(<Avatar name="" email="bob@example.com" />);
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("has accessible aria-label", () => {
    render(<Avatar name="Alice" email="alice@example.com" />);
    expect(screen.getByLabelText("Avatar for Alice")).toBeInTheDocument();
  });

  it("applies large size class when size=lg", () => {
    const { container } = render(<Avatar name="Alice" email="" size="lg" />);
    expect(container.firstChild).toHaveClass("w-14");
  });
});
```

- [ ] **Step 4: Run tests — expect them to pass**

```bash
npx jest src/components/__tests__/avatar.test.tsx --no-coverage
```

Expected: 4 tests pass.

- [ ] **Step 5: Verify build passes**

```bash
npm run build
```

Expected: Compiled successfully.

- [ ] **Step 6: Commit**

```bash
git add src/app/layout.tsx src/components/avatar.tsx src/components/__tests__/avatar.test.tsx
git commit -m "feat: add Inter font and Avatar component with tests"
```

---

## Task 3: Nav + NavUser

**Files:**
- Modify: `src/app/layout.tsx` (nav markup)
- Modify: `src/components/nav-user.tsx`

- [ ] **Step 1: Update nav markup in layout.tsx**

Replace the entire `<nav>` element with:

```tsx
<nav className="h-[52px] border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center px-5 gap-4">
  {/* Wordmark */}
  <span className="font-semibold text-base tracking-tight flex-shrink-0">
    hearth<span className="text-[var(--color-accent)]">.</span>
  </span>

  {/* Workspace tab pills */}
  <div className="flex items-center gap-[3px] bg-[var(--color-accent-subtle)] p-[3px] rounded-[9px] text-sm">
    <button className="px-3 py-[5px] rounded-[7px] bg-white text-[var(--color-accent)] font-medium shadow-sm text-xs">
      All
    </button>
    <button className="px-3 py-[5px] rounded-[7px] text-[var(--color-text-secondary)] hover:bg-white/60 font-medium text-xs">
      Household
    </button>
    <button className="px-3 py-[5px] rounded-[7px] text-[var(--color-text-secondary)] hover:bg-white/60 font-medium text-xs">
      Work
    </button>
  </div>

  <div className="ml-auto">
    {user && (
      <NavUser
        name={user.user_metadata?.name ?? ""}
        email={user.email ?? ""}
      />
    )}
  </div>
</nav>
```

- [ ] **Step 2: Update nav-user.tsx**

Replace the entire file content:

```tsx
"use client";

import { createClient } from "@/lib/supabase/browser";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "@/components/toaster";
import { Avatar } from "@/components/avatar";

export function NavUser({ name, email }: { name: string; email: string }) {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast(error.message, "error");
    } else {
      toast("Signed out");
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Link
        href="/profile"
        className="hidden sm:inline text-sm font-medium text-[var(--color-text-primary)] hover:text-[var(--color-accent)] transition-colors"
      >
        {name || email}
      </Link>
      <Avatar name={name} email={email} size="sm" />
      <button
        onClick={handleLogout}
        className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
      >
        Sign out
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Verify build + lint**

```bash
npm run build && npm run lint
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/layout.tsx src/components/nav-user.tsx
git commit -m "feat: update nav with Hearth wordmark, tab pills, and avatar"
```

---

## Task 4: Login Page

**Files:**
- Modify: `src/app/login/page.tsx`

- [ ] **Step 1: Replace the return JSX in login/page.tsx**

Replace everything from `return (` to the closing `);` with:

```tsx
return (
  <div className="flex min-h-[80vh] items-center justify-center relative overflow-hidden">
    {/* Pastel blobs */}
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -top-16 -left-16 w-64 h-64 rounded-full opacity-50"
      style={{ background: "#C4B0E8", filter: "blur(50px)" }}
    />
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -bottom-10 right-5 w-52 h-52 rounded-full opacity-50"
      style={{ background: "#F0C8D4", filter: "blur(50px)" }}
    />
    <div
      aria-hidden="true"
      className="pointer-events-none absolute bottom-5 -left-8 w-40 h-40 rounded-full opacity-50"
      style={{ background: "#B8D4F0", filter: "blur(50px)" }}
    />

    {/* Card */}
    <div className="relative z-10 w-full max-w-sm rounded-[16px] border border-[var(--color-border)] bg-[var(--color-surface)] p-8"
      style={{ boxShadow: "var(--shadow-login)" }}>

      {/* Wordmark */}
      <p className="mb-6 text-center text-xl font-semibold tracking-tight">
        hearth<span className="text-[var(--color-accent)]">.</span>
      </p>

      {/* Mode tabs */}
      <div className="mb-6 flex rounded-[10px] bg-[var(--color-accent-subtle)] p-[3px] text-sm">
        <button
          type="button"
          onClick={() => { setMode("signin"); setError(""); }}
          className={`flex-1 rounded-[8px] py-[7px] font-medium transition-colors text-sm ${
            mode === "signin"
              ? "bg-white shadow-sm text-[var(--color-accent)]"
              : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          }`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => { setMode("signup"); setError(""); }}
          className={`flex-1 rounded-[8px] py-[7px] font-medium transition-colors text-sm ${
            mode === "signup"
              ? "bg-white shadow-sm text-[var(--color-accent)]"
              : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          }`}
        >
          Sign up
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {mode === "signup" && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className="text-xs font-medium text-[var(--color-text-secondary)]">
              Name
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-[9px] text-sm outline-none focus:border-[var(--color-accent)] focus:ring-[3px] focus:ring-[var(--color-accent)]/10 focus:bg-white"
              placeholder="Your name"
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-xs font-medium text-[var(--color-text-secondary)]">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-[9px] text-sm outline-none focus:border-[var(--color-accent)] focus:ring-[3px] focus:ring-[var(--color-accent)]/10 focus:bg-white"
            placeholder="you@example.com"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-xs font-medium text-[var(--color-text-secondary)]">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-[9px] text-sm outline-none focus:border-[var(--color-accent)] focus:ring-[3px] focus:ring-[var(--color-accent)]/10 focus:bg-white"
            placeholder="••••••••"
          />
        </div>

        {error && (
          <p className="rounded-[8px] bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="mt-1 rounded-[8px] bg-[var(--color-accent)] px-4 py-[10px] text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors"
        >
          {loading ? "…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>
    </div>
  </div>
);
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: Compiled successfully.

- [ ] **Step 3: Commit**

```bash
git add src/app/login/page.tsx
git commit -m "feat: redesign login page with blobs, wordmark, and violet tokens"
```

---

## Task 5: Tasks Page

**Files:**
- Modify: `src/app/tasks/page.tsx`
- Create: `src/components/task-card.tsx`
- Create: `src/components/__tests__/task-card.test.tsx`

- [ ] **Step 1: Replace tasks/page.tsx entirely**

```tsx
import { createClient } from "@/lib/supabase/server";

type DeadlineVariant = "red" | "yellow" | "green";

function DeadlineBadge({ variant, label }: { variant: DeadlineVariant; label: string }) {
  const styles: Record<DeadlineVariant, string> = {
    red: "bg-red-50 text-[var(--color-deadline-red)]",
    yellow: "bg-amber-50 text-[var(--color-deadline-yellow)]",
    green: "bg-emerald-50 text-[var(--color-deadline-green)]",
  };
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${styles[variant]}`}>
      {label}
    </span>
  );
}

function SharedBadge() {
  return (
    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]">
      Shared
    </span>
  );
}

function TaskCard({
  title,
  deadline,
  deadlineVariant,
  workspace,
  shared,
}: {
  title: string;
  deadline: string;
  deadlineVariant: DeadlineVariant;
  workspace: string;
  shared?: boolean;
}) {
  return (
    <div
      className="bg-[var(--color-surface)] rounded-[11px] border border-[var(--color-border)] px-4 py-3 flex items-center gap-3"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      {/* Checkbox circle */}
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" className="flex-shrink-0">
        <circle cx="9" cy="9" r="7.5" stroke="var(--color-border)" strokeWidth="1.8"/>
      </svg>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">{title}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <DeadlineBadge variant={deadlineVariant} label={deadline} />
          {shared && <SharedBadge />}
          <span className="text-[11px] text-[var(--color-text-muted)]">{workspace}</span>
        </div>
      </div>

      {/* Drag handle */}
      <svg width="14" height="14" viewBox="0 0 14 14" fill="var(--color-text-muted)" aria-hidden="true" className="flex-shrink-0">
        <circle cx="5" cy="4" r="1.2"/><circle cx="9" cy="4" r="1.2"/>
        <circle cx="5" cy="7" r="1.2"/><circle cx="9" cy="7" r="1.2"/>
        <circle cx="5" cy="10" r="1.2"/><circle cx="9" cy="10" r="1.2"/>
      </svg>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <circle cx="32" cy="32" r="28" fill="var(--color-accent-subtle)"/>
        <path d="M20 38 Q26 26 32 30 Q38 34 44 22" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round"/>
        <circle cx="20" cy="38" r="2.5" fill="var(--color-accent)" opacity="0.4"/>
        <circle cx="32" cy="30" r="2.5" fill="var(--color-accent)" opacity="0.65"/>
        <circle cx="44" cy="22" r="2.5" fill="var(--color-accent)"/>
        <path d="M24 46h16" stroke="var(--color-border)" strokeWidth="2" strokeLinecap="round"/>
        <path d="M27 51h10" stroke="var(--color-border)" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
      <p className="text-sm text-[var(--color-text-muted)]">
        No tasks yet.<br/>Add one to get started.
      </p>
    </div>
  );
}

function SidebarItem({
  icon,
  label,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-2 py-[7px] rounded-[8px] text-sm font-medium cursor-pointer ${
        active
          ? "bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]"
          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-subtle)]/50"
      }`}
    >
      {icon}
      {label}
    </div>
  );
}

export default async function TasksPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const name = user?.user_metadata?.name || user?.email || "there";

  // Mock tasks — replace with real data when task queries are implemented
  const mockTasks = [
    { id: 1, title: "Buy groceries", deadline: "Overdue", deadlineVariant: "red" as DeadlineVariant, workspace: "Household", shared: true, section: "Overdue" },
    { id: 2, title: "Review Q2 budget report", deadline: "Due in 18 hrs", deadlineVariant: "yellow" as DeadlineVariant, workspace: "Work", section: "Today" },
    { id: 3, title: "Call the plumber", deadline: "Due in 3 days", deadlineVariant: "green" as DeadlineVariant, workspace: "Household", section: "Upcoming" },
    { id: 4, title: "Weekly team sync prep", deadline: "Due in 5 days", deadlineVariant: "green" as DeadlineVariant, workspace: "Work", section: "Upcoming" },
  ];

  const sections = ["Overdue", "Today", "Upcoming"] as const;
  const hasTasks = mockTasks.length > 0;

  return (
    <div className="flex min-h-[calc(100vh-52px)] -m-6">
      {/* Sidebar */}
      <aside className="hidden md:flex w-[200px] flex-col bg-[var(--color-surface)] border-r border-[var(--color-border)] p-3 flex-shrink-0">
        <button className="mb-4 w-full flex items-center justify-center gap-1.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-sm font-medium rounded-[8px] py-[9px] transition-colors">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 1v10M1 6h10"/>
          </svg>
          New task
        </button>

        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)] px-2 mb-1">Views</p>
        <SidebarItem active icon={
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M2 4h11M2 7.5h7M2 11h5"/>
          </svg>
        } label="My tasks" />
        <SidebarItem icon={
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <circle cx="5.5" cy="5.5" r="3.5"/><circle cx="9.5" cy="9.5" r="3.5"/>
          </svg>
        } label="Shared" />

        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)] px-2 mb-1 mt-4">Spaces</p>
        <SidebarItem icon={
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M1.5 6L7.5 1.5L13.5 6V13.5a.75.75 0 01-.75.75H2.25A.75.75 0 011.5 13.5V6z"/>
          </svg>
        } label="Household" />
        <SidebarItem icon={
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <rect x="1.5" y="4" width="12" height="9" rx="1.25"/>
            <path d="M4.5 4V3a.75.75 0 01.75-.75h4.5A.75.75 0 0110.5 3v1"/>
          </svg>
        } label="Work" />
      </aside>

      {/* Main content */}
      <main className="flex-1 p-6 overflow-auto">
        <h2 className="text-xl font-semibold tracking-tight mb-1">Hello, {name}</h2>
        <p className="text-sm text-[var(--color-text-secondary)] mb-6">Here are your tasks.</p>

        {!hasTasks ? (
          <EmptyState />
        ) : (
          sections.map((section) => {
            const tasks = mockTasks.filter((t) => t.section === section);
            if (!tasks.length) return null;
            return (
              <div key={section} className="mb-6">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)] mb-2">
                  {section}
                </p>
                <div className="flex flex-col gap-1.5">
                  {tasks.map((task) => (
                    <TaskCard key={task.id} {...task} />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Create src/components/task-card.tsx**

Create this file with the shared components (extracted from the inline definitions in Step 1). Delete the inline definitions of `DeadlineVariant`, `DeadlineBadge`, `SharedBadge`, `TaskCard`, and `EmptyState` from `tasks/page.tsx` after creating this file.

```tsx
export type DeadlineVariant = "red" | "yellow" | "green";

const deadlineStyles: Record<DeadlineVariant, string> = {
  red: "bg-red-50 text-[var(--color-deadline-red)]",
  yellow: "bg-amber-50 text-[var(--color-deadline-yellow)]",
  green: "bg-emerald-50 text-[var(--color-deadline-green)]",
};

export function DeadlineBadge({ variant, label }: { variant: DeadlineVariant; label: string }) {
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${deadlineStyles[variant]}`}>
      {label}
    </span>
  );
}

export function SharedBadge() {
  return (
    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]">
      Shared
    </span>
  );
}

export function TaskCard({
  title,
  deadline,
  deadlineVariant,
  workspace,
  shared,
}: {
  title: string;
  deadline: string;
  deadlineVariant: DeadlineVariant;
  workspace: string;
  shared?: boolean;
}) {
  return (
    <div
      className="bg-[var(--color-surface)] rounded-[11px] border border-[var(--color-border)] px-4 py-3 flex items-center gap-3"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" className="flex-shrink-0">
        <circle cx="9" cy="9" r="7.5" stroke="var(--color-border)" strokeWidth="1.8"/>
      </svg>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">{title}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <DeadlineBadge variant={deadlineVariant} label={deadline} />
          {shared && <SharedBadge />}
          <span className="text-[11px] text-[var(--color-text-muted)]">{workspace}</span>
        </div>
      </div>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="var(--color-text-muted)" aria-hidden="true" className="flex-shrink-0">
        <circle cx="5" cy="4" r="1.2"/><circle cx="9" cy="4" r="1.2"/>
        <circle cx="5" cy="7" r="1.2"/><circle cx="9" cy="7" r="1.2"/>
        <circle cx="5" cy="10" r="1.2"/><circle cx="9" cy="10" r="1.2"/>
      </svg>
    </div>
  );
}

export function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <circle cx="32" cy="32" r="28" fill="var(--color-accent-subtle)"/>
        <path d="M20 38 Q26 26 32 30 Q38 34 44 22" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round"/>
        <circle cx="20" cy="38" r="2.5" fill="var(--color-accent)" opacity="0.4"/>
        <circle cx="32" cy="30" r="2.5" fill="var(--color-accent)" opacity="0.65"/>
        <circle cx="44" cy="22" r="2.5" fill="var(--color-accent)"/>
        <path d="M24 46h16" stroke="var(--color-border)" strokeWidth="2" strokeLinecap="round"/>
        <path d="M27 51h10" stroke="var(--color-border)" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
      <p className="text-sm text-[var(--color-text-muted)]">
        No tasks yet.<br/>Add one to get started.
      </p>
    </div>
  );
}
```

Then update the import in `tasks/page.tsx` — add this at the top and remove the inline definitions:
```tsx
import { TaskCard, EmptyState, type DeadlineVariant } from "@/components/task-card";
```

- [ ] **Step 3: Write TaskCard tests**

Create `src/components/__tests__/task-card.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { TaskCard, DeadlineBadge, EmptyState } from "../task-card";

describe("DeadlineBadge", () => {
  it("renders the label text", () => {
    render(<DeadlineBadge variant="red" label="Overdue" />);
    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });

  it("renders green variant label", () => {
    render(<DeadlineBadge variant="green" label="Due in 3 days" />);
    expect(screen.getByText("Due in 3 days")).toBeInTheDocument();
  });
});

describe("TaskCard", () => {
  const baseProps = {
    title: "Buy groceries",
    deadline: "Overdue",
    deadlineVariant: "red" as const,
    workspace: "Household",
  };

  it("renders task title", () => {
    render(<TaskCard {...baseProps} />);
    expect(screen.getByText("Buy groceries")).toBeInTheDocument();
  });

  it("renders workspace label", () => {
    render(<TaskCard {...baseProps} />);
    expect(screen.getByText("Household")).toBeInTheDocument();
  });

  it("renders Shared badge when shared=true", () => {
    render(<TaskCard {...baseProps} shared />);
    expect(screen.getByText("Shared")).toBeInTheDocument();
  });

  it("does not render Shared badge when shared is omitted", () => {
    render(<TaskCard {...baseProps} />);
    expect(screen.queryByText("Shared")).not.toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("renders empty state message", () => {
    render(<EmptyState />);
    expect(screen.getByText(/No tasks yet/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run tests**

```bash
npx jest src/components/__tests__/task-card.test.tsx --no-coverage
```

Expected: All tests pass.

- [ ] **Step 5: Verify build**

```bash
npm run build
```

Expected: Compiled successfully.

- [ ] **Step 6: Commit**

```bash
git add src/app/tasks/page.tsx src/components/task-card.tsx src/components/__tests__/task-card.test.tsx
git commit -m "feat: redesign tasks page with sidebar, task cards, and empty state"
```

---

## Task 6: Profile Page

**Files:**
- Modify: `src/app/profile/page.tsx`

- [ ] **Step 1: Replace the entire contents of src/app/profile/page.tsx**

```tsx
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { useRouter } from "next/navigation";
import { toast } from "@/components/toaster";
import { Avatar } from "@/components/avatar";

export default function ProfilePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setName(user.user_metadata?.name ?? "");
        setEmail(user.email ?? "");
      }
      setFetching(false);
    });
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({
      data: { name: name.trim() },
    });
    if (error) {
      toast(error.message, "error");
    } else {
      toast("Profile updated");
      router.refresh();
    }
    setLoading(false);
  }

  if (fetching) {
    return <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>;
  }

  return (
    <div className="max-w-sm">
      <h2 className="mb-6 text-xl font-semibold tracking-tight">Profile</h2>

      {/* Avatar row */}
      <div className="flex items-center gap-4 mb-6">
        <Avatar name={name} email={email} size="lg" />
        <div>
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">{name || "—"}</p>
          <p className="text-sm text-[var(--color-text-secondary)]">{email}</p>
        </div>
      </div>

      <form onSubmit={handleSave} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="name" className="text-xs font-medium text-[var(--color-text-secondary)]">
            Name
          </label>
          <input
            id="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-[9px] text-sm outline-none focus:border-[var(--color-accent)] focus:ring-[3px] focus:ring-[var(--color-accent)]/10 focus:bg-white"
            placeholder="Your name"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">Email</label>
          <p className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-[9px] text-sm text-[var(--color-text-muted)]">
            {email}
          </p>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-fit rounded-[8px] bg-[var(--color-accent)] px-5 py-[10px] text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors"
        >
          {loading ? "Saving…" : "Save changes"}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Verify build + lint**

```bash
npm run build && npm run lint
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/profile/page.tsx
git commit -m "feat: redesign profile page with avatar row and Hearth tokens"
```

---

## Task 7: Update Metadata + Final Verification

**Files:**
- Modify: `src/app/layout.tsx` (metadata only)

- [ ] **Step 1: Update metadata in layout.tsx**

```tsx
export const metadata: Metadata = {
  title: "Hearth",
  description: "Your household and work tasks, in one warm place.",
};
```

- [ ] **Step 2: Final build + lint**

```bash
npm run build && npm run lint
```

Expected: Both pass with no errors.

- [ ] **Step 3: Start dev server and do a visual smoke test**

```bash
npm run dev
```

Visit:
- `http://localhost:3000/login` — blobs visible, `hearth.` wordmark, violet button
- `http://localhost:3000/tasks` — sidebar visible on desktop, task cards with badges
- `http://localhost:3000/profile` — avatar circle, consistent form styling

- [ ] **Step 4: Final commit**

```bash
git add src/app/layout.tsx
git commit -m "feat: update app title and description to Hearth"
```
