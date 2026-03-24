# Hearth — Visual Redesign Spec

**Date:** 2026-03-24
**Scope:** Full visual redesign of the task manager UI — tokens, layout, branding, and graphics. No functional or data-layer changes.

---

## 1. Goals

- Elevate the visual feel from plain gray scaffolding to a warm, personal, polished product.
- Establish a complete design token system as the foundation for all future UI work.
- Rename the app to **Hearth** with a consistent wordmark (`hearth.` with a violet dot).
- Introduce light graphics: pastel blobs on login, SVG icon accents throughout, empty state illustration.

## 2. Design Tokens

All tokens are defined as CSS custom properties in `src/app/globals.css` via Tailwind v4's `@theme` block.

### Colors

| Token | Value | Usage |
|---|---|---|
| `--color-bg` | `#FAF9F7` | Page background |
| `--color-surface` | `#FFFFFF` | Cards, nav, modals |
| `--color-border` | `#E8E4F0` | All borders |
| `--color-text-primary` | `#1C1A24` | Headings, task titles |
| `--color-text-secondary` | `#6B6878` | Metadata, labels |
| `--color-text-muted` | `#A09CB0` | Placeholders, disabled, section labels |
| `--color-accent` | `#7C5CBF` | Primary buttons, active states, focus rings |
| `--color-accent-hover` | `#6A4DAD` | Button hover |
| `--color-accent-subtle` | `#EDE8F8` | Active tab bg, hover fills, icon pill bg |
| `--color-accent-text` | `#5B3FA8` | Links, accent text on light bg |
| `--color-deadline-red` | `#E05252` | Overdue tasks |
| `--color-deadline-yellow` | `#D4A017` | Due within 24 hours |
| `--color-deadline-green` | `#4A9B6F` | Sufficient time / no deadline |

### Typography

Font: **Inter** (via `next/font/google`, no external request at runtime).

| Scale | Size | Weight | Usage |
|---|---|---|---|
| Auth heading | 20px | 600 | Login card title (`hearth.`) |
| Page heading | 20px | 600 | "Hello, Alice" |
| Task title | 14–15px | 500 | Task card primary line |
| Body / label | 13px | 400–500 | Meta, nav links, form labels |
| Section label | 10–11px | 600 | Uppercase letter-spaced section dividers |

### Shape & Shadow

- Input / button radius: `8px`
- Card radius: `12px`
- Task card shadow: `0 1px 3px rgba(0,0,0,0.05), 0 1px 8px rgba(124,92,191,0.05)`
- Login card shadow: `0 8px 32px rgba(124,92,191,0.14), 0 2px 8px rgba(0,0,0,0.06)`
- Focus ring: `box-shadow: 0 0 0 3px rgba(124,92,191,0.12)` + `border-color: #7C5CBF`

---

## 3. Branding

- App name: **Hearth**
- Wordmark: `hearth.` — lowercase, the trailing `.` rendered in `--color-accent` (`#7C5CBF`)
- `<title>` and `<meta name="description">` updated in `layout.tsx`

---

## 4. Layout

### App Shell (`layout.tsx`)

- Background: `--color-bg`
- Nav height: `52px`, background `--color-surface`, border-bottom `--color-border`
- Nav left: wordmark `hearth.`
- Nav center: workspace tab pills (All / Household / Work) in an `--color-accent-subtle` pill container
- Nav right: user display name + avatar circle (initials, `--color-accent-subtle` bg, `--color-accent-text` text)
- Workspace tabs remain placeholder (no routing change yet)

### Tasks Page (`tasks/page.tsx`)

- Two-column layout: `200px` sidebar + flex main content
- **Sidebar:**
  - "New task" primary button (full width, violet)
  - Views section: "My tasks" (active), "Shared" — each with SVG icon
  - Spaces section: "Household", "Work" — each with SVG icon
  - Active item style: `--color-accent-subtle` background, `--color-accent-text` color
- **Main content:**
  - Greeting heading + subtitle
  - Task cards grouped by section labels: Overdue / Today / Upcoming
  - Each card: checkbox circle, title, deadline badge + workspace label, drag handle dots
  - Deadline badges use colored pill styles (red/yellow/green/shared)
  - Task data remains placeholder (`p` tag replaced with mock card components)
- Mobile: sidebar hidden below `md` breakpoint; workspace switcher shown in nav tabs only

### Login Page (`login/page.tsx`)

- Full-screen centered layout with `--color-bg` background
- Three blurred pastel blob SVGs as absolute-positioned background decoration:
  - Top-left: `rgba(196,176,232,0.5)` — soft violet
  - Bottom-right: `rgba(240,200,212,0.5)` — soft pink
  - Bottom-left: `rgba(184,212,240,0.5)` — soft blue
- Card: white, `border-radius: 16px`, violet-tinted shadow
- `hearth.` wordmark centered above form tabs
- Violet tab group (Sign in / Sign up)
- Inputs: `--color-bg` fill at rest, white + violet focus ring on focus
- Primary button: `--color-accent`
- Error state: existing red inline message, no change to logic

### Profile Page (`profile/page.tsx`)

- Add avatar initials circle above the form (large, `56px`)
- Display name + email read-only row under avatar
- Form inputs consistent with token system
- Save button: `--color-accent`, `max-width: 160px`

---

## 5. Graphics

### Blobs (login only)
Inline SVG circles with `filter: blur(50px)` and `opacity: 0.5`. Three blobs in soft violet, pink, and blue. Absolutely positioned, `pointer-events: none`, `z-index: 0`. Login card sits at `z-index: 2`.

### Icon Accents
Inline SVG icons (no icon library dependency) on:
- Sidebar nav items (home icon for Household, briefcase for Work, list for My tasks, overlap circles for Shared)
- Workspace tab pills in nav (optional — only if not visually crowded)
- Task status circles (open circle = incomplete)

### Empty State Illustration
Shown when task list has no items. Inline SVG: violet circle background, abstract line-chart curve with dots in violet gradient, two muted lines below. Caption: "No tasks yet. Add one to get started."

---

## 6. Files Changed

| File | Change |
|---|---|
| `src/app/globals.css` | Add `@theme` block with all CSS custom properties + Inter font import |
| `src/app/layout.tsx` | Update metadata title/description, nav markup, background color, avatar component |
| `src/app/login/page.tsx` | Add blob graphics, wordmark, violet tokens throughout |
| `src/app/tasks/page.tsx` | Add sidebar layout, mock task cards, empty state illustration |
| `src/app/profile/page.tsx` | Add avatar row, apply token-consistent form styling |
| `src/components/nav-user.tsx` | Replace text link + sign out button with avatar circle (initials) + inline "Sign out" text link — no dropdown |

---

## 7. Out of Scope

- No changes to Supabase queries, auth logic, RLS, or API routes
- No real task data wired to the UI (task cards remain mock/placeholder)
- No drag-and-drop implementation (handle rendered but not functional)
- No mobile bottom sheet for sidebar (responsive hiding only)
- No new dependencies (no icon library, no animation library)
- No dark mode — `prefers-color-scheme` not addressed
