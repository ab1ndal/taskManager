# Technology Stack

**Analysis Date:** 2026-03-25

## Languages

**Primary:**
- TypeScript 5 - All source code in `src/`, strict mode enabled

**Secondary:**
- JavaScript - PostCSS and Jest configurations use `.mjs` and `.ts` with mixed JS/TS support

## Runtime

**Environment:**
- Node.js (version specified via TypeScript target ES2017)

**Package Manager:**
- npm
- Lockfile: `package-lock.json` present (415KB, locked dependencies)

## Frameworks

**Core:**
- Next.js 16.1.6 - Full App Router with React 19 (src/app structure)
- React 19.0.0 - UI components and hooks

**Styling:**
- Tailwind CSS 4 - Utility-first CSS framework
- PostCSS 4 - CSS processing pipeline via `@tailwindcss/postcss` plugin

**Testing:**
- Jest 30.3.0 - Test runner with TypeScript support (ts-jest)
- React Testing Library 16.3.2 - Component testing
- @testing-library/jest-dom 6.9.1 - Custom matchers
- @testing-library/user-event 14.6.1 - User interaction simulation

**Build/Dev:**
- TypeScript 5 - Type checking and compilation
- ts-jest 29.4.6 - TypeScript support in Jest
- ts-node 10.9.2 - TypeScript execution for scripts
- ESLint 9 - Code linting via `eslint-config-next`

## Key Dependencies

**Critical:**
- @supabase/supabase-js 2.98.0 - PostgreSQL client and auth SDK
- @supabase/ssr 0.9.0 - Supabase cookie-based session handling for Next.js

**Infrastructure:**
- next 16.1.6 - React meta-framework with server components and API routes
- react-dom 19.0.0 - React DOM rendering

**Type Definitions:**
- @types/node 20 - Node.js type definitions
- @types/react 19 - React type definitions
- @types/react-dom 19 - React DOM type definitions
- @types/jest 30.0.0 - Jest type definitions

## Configuration

**Environment:**
- `.env` file present - Contains Supabase connection variables
- Required env vars:
  - `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` - Public anon key for client-side auth
  - `NEXT_PUBLIC_SUPABASE_SECRET_KEY` - Secret key for server-side operations

**TypeScript:**
- `tsconfig.json` - Target ES2017, strict mode, module resolution via bundler
- Path alias: `@/*` maps to `./src/*` for clean imports
- JSX: react-jsx (modern JSX transform)

**Build:**
- `next.config.ts` - Minimal configuration (empty NextConfig object)
- `postcss.config.mjs` - Tailwind CSS plugin configuration
- `jest.config.ts` - Test environment (jsdom), module mapping, ts-jest transformer
- `jest.setup.ts` - Jest DOM matchers import

**ESLint:**
- ESLint 9 with `eslint-config-next` - Lints TypeScript and React code

## Platform Requirements

**Development:**
- Node.js (LTS recommended, package.json targets ^20)
- npm for dependency management
- TypeScript compiler (tsconfig: ES2017 target)
- Modern browser for dev server (localhost:3000 default)

**Production:**
- Vercel deployment target (Next.js hosting platform)
- PostgreSQL database (via Supabase)
- Node.js runtime for serverless functions

---

*Stack analysis: 2026-03-25*
