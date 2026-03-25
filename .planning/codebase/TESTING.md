# Testing Patterns

**Analysis Date:** 2026-03-25

## Test Framework

**Runner:**
- Jest 30.3.0
- Config: `jest.config.ts`
- Environment: jsdom (browser simulation)
- Transform: ts-jest with React JSX support

**Assertion Library:**
- Jest built-in matchers
- Testing Library assertions (imported via `@testing-library/jest-dom`)

**Run Commands:**
```bash
npm run test              # Run all tests
npm run test:watch       # Watch mode
# Coverage: Not configured (no command present)
```

## Test File Organization

**Location:**
- Co-located with source code (same directory) OR in `__tests__` subdirectory
- Pattern 1 (same directory): `actions.test.ts`, `bucket-tasks.test.ts`
- Pattern 2 (subdirectory): `src/components/__tests__/avatar.test.tsx`

**Naming:**
- `.test.ts` for non-React utilities (e.g., `actions.test.ts`, `bucket-tasks.test.ts`, `route.test.ts`)
- `.test.tsx` for React components (e.g., `avatar.test.tsx`, `completed-section.test.tsx`)

**Structure:**
```
src/
├── app/
│   ├── auth/callback/
│   │   ├── route.test.ts
│   │   └── resolve-next.ts
│   ├── tasks/
│   │   ├── actions.test.ts
│   │   ├── actions.ts
│   │   ├── bucket-tasks.test.ts
│   │   ├── bucket-tasks.ts
│   │   ├── completed-section.test.tsx
│   │   ├── completed-section.tsx
│   │   ├── new-task-modal.test.tsx
│   │   └── new-task-modal.tsx
│   └── workspaces/
│       ├── actions.test.ts
│       └── actions.ts
└── components/
    ├── __tests__/
    │   ├── avatar.test.tsx
    │   └── login-card.test.tsx
    └── avatar.tsx
```

## Test Structure

**Suite Organization:**

```typescript
describe("ComponentOrFunction", () => {
  it("specific behavior", () => {
    // test code
  });

  it("another behavior", () => {
    // test code
  });
});
```

**Setup/Teardown Pattern (from `actions.test.ts`):**
```typescript
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

beforeEach(() => jest.clearAllMocks());

describe("completeTask", () => {
  it("updates completed_at and revalidates /tasks", async () => {
    // test
  });
});
```

**Pattern Details:**
- Mocks at top of file, then imports
- `beforeEach` to clear mock state between tests (important for isolation)
- Async/await for Promise-based code
- Explicit `expect()` assertions with specific matchers

## Mocking

**Framework:** Jest's built-in `jest.mock()` and `jest.fn()`

**Patterns:**

**1. Mocking entire modules (server actions, Next.js APIs):**
```typescript
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/components/task-card", () => ({
  TaskCard: ({ title }: { title: string }) => <div>{title}</div>,
}));
```

**2. Chaining mock returns (Supabase client chain):**
```typescript
const eq = jest.fn().mockResolvedValue({ error: null });
const update = jest.fn().mockReturnValue({ eq });
(createClient as jest.Mock).mockResolvedValue({
  from: jest.fn().mockReturnValue({ update })
});
```

**3. Multiple return values for sequential calls:**
```typescript
const mockFrom = jest.fn()
  .mockReturnValueOnce({ insert: insertTask })        // tasks insert
  .mockReturnValueOnce({ select: sortKeySelect })     // task_assignments query
  .mockReturnValueOnce({ insert: insertAssignment }); // task_assignments insert

(createClient as jest.Mock).mockResolvedValue({ from: mockFrom });
```

**4. Component-level mocking (React components):**
```typescript
jest.mock("next/navigation", () => ({
  useSearchParams: jest.fn(() => new URLSearchParams())
}));
```

**What to Mock:**
- External APIs (Supabase client)
- Next.js runtime modules (cache, navigation)
- Server actions and complex dependencies
- Components that have side effects or external dependencies

**What NOT to Mock:**
- Pure utility functions (e.g., `bucketTasks` — test directly)
- React hooks from standard library (`useState`, `useEffect`)
- Simple UI components without side effects

## Fixtures and Factories

**Test Data Pattern (from `new-task-modal.test.tsx`):**
```typescript
const workspaces = [
  {
    id: "ws-1",
    name: "Home",
    kind: "household",
    members: [{ id: "m-1", display_name: "Alice" }],
  },
];

const tasks = [
  {
    taskId: "1",
    title: "Done A",
    deadline: null,
    deadlineVariant: null,
    workspace: "Home",
    shared: false,
    completed: true as const,
  },
];
```

**Location:**
- Defined inline at top of test file
- Not extracted to separate fixtures directory
- Use TypeScript `as const` for literal type narrowing when needed

**Factory Helper (from `new-task-modal.test.tsx`):**
```typescript
function renderModal(open = true) {
  const onClose = jest.fn();
  render(
    <NewTaskModal
      open={open}
      onClose={onClose}
      workspaces={workspaces}
      currentMemberIds={["m-1"]}
    />
  );
  return { onClose };
}
```

## Coverage

**Requirements:** Not enforced (no coverage thresholds configured)

**View Coverage:**
```bash
npm run test -- --coverage  # Not configured as npm script
```

**Current Status:** 9 test files covering critical paths (auth, actions, components)

## Test Types

**Unit Tests:**
- Scope: Individual functions and utilities (e.g., `bucketTasks`, `resolveNext`)
- Approach: Mock external dependencies, assert outputs
- Example: `bucket-tasks.test.ts` tests date logic and bucketing without DB calls

**Integration Tests:**
- Scope: Server actions with mocked Supabase client
- Approach: Mock the client and verify it's called correctly
- Example: `actions.test.ts` verifies task creation inserts data and revalidates cache

**Component Tests:**
- Scope: React component rendering and user interactions
- Approach: Render with Testing Library, assert on DOM output
- Example: `completed-section.test.tsx` tests expand/collapse state

**End-to-End Tests:**
- Framework: Not used (no Cypress/Playwright config)
- Status: Untested via E2E

## Common Patterns

**Async Testing (server actions):**
```typescript
async function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  // async operations
  const { error } = await supabase.auth.signInWithPassword({ email, password });
}

// Test:
it("calls Supabase with email/password", async () => {
  const { error } = jest.fn().mockResolvedValue({ error: null });
  // Mock setup
  await completeTask("task-1");
  expect(mockFn).toHaveBeenCalledWith(...);
});
```

**Error Testing:**
```typescript
// Test error case:
it("sets error message on DB failure", async () => {
  const single = jest.fn().mockResolvedValue({ data: null, error: { message: "DB error" } });
  // Setup mock to fail
  const result = await createTaskWithSubtasks({ /* ... */ });
  expect(result).toEqual({ subtaskErrors: 1 });
});
```

**Component User Interaction:**
```typescript
import { fireEvent, screen } from "@testing-library/react";

it("calls onClose when cancel is clicked", () => {
  const { onClose } = renderModal();
  fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
  expect(onClose).toHaveBeenCalled();
});

it("enables submit once title is entered", () => {
  renderModal();
  fireEvent.change(screen.getByPlaceholderText(/task title/i), {
    target: { value: "Buy milk" },
  });
  expect(screen.getByRole("button", { name: /add task/i })).not.toBeDisabled();
});
```

**DOM Assertions:**
```typescript
// Check visibility:
expect(screen.queryByText("Done A")).not.toBeInTheDocument();

// Check text content:
expect(screen.getByRole("button")).toHaveTextContent("2 completed");

// Check class:
expect(container.firstChild).toHaveClass("w-14");

// Check empty DOM:
expect(container).toBeEmptyDOMElement();
```

## Test Execution Notes

**Module name mapping:**
- Jest configured to map `@/*` paths to `src/*` in test environment (see `jest.config.ts` moduleNameMapper)

**Files excluded:**
- `node_modules/`
- `.next/`

**Environment:**
- jsdom (simulates browser DOM)
- Tests can call browser APIs (`window.confirm`, event listeners, etc.)

---

*Testing analysis: 2026-03-25*
