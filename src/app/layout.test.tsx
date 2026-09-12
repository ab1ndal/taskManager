import { render, screen } from "@testing-library/react";
import RootLayout from "./layout";

jest.mock("./globals.css", () => ({}));

jest.mock("next/font/google", () => ({
  Inter: () => ({ className: "inter" }),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

jest.mock("@/components/nav-user", () => ({
  NavUser: ({ name }: { name: string }) => <div data-testid="nav-user">{name}</div>,
}));

jest.mock("@/components/toaster", () => ({
  Toaster: () => <div data-testid="toaster" />,
}));

// Its own suite covers the refresh behaviour; here it would only demand a mounted app router.
jest.mock("@/components/resume-refresh", () => ({
  ResumeRefresh: () => <div data-testid="resume-refresh" />,
}));

jest.mock("@/components/push-upkeep", () => ({
  PushUpkeep: () => <div data-testid="push-upkeep" />,
}));

const mockGetUser = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  getUser: () => mockGetUser(),
}));

const mockRedirect = jest.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
jest.mock("next/navigation", () => ({
  redirect: (url: string) => mockRedirect(url),
  usePathname: () => "/tasks",
}));

const mockHeadersGet = jest.fn();
jest.mock("next/headers", () => ({
  headers: async () => ({ get: mockHeadersGet }),
}));

async function renderLayout() {
  const jsx = await RootLayout({ children: <div>content</div> });
  render(jsx);
}

describe("RootLayout — nav visibility", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHeadersGet.mockReturnValue("/tasks");
  });

  // Task 10 review, Minor: nothing previously asserted the Board link exists — deleting its entry
  // from nav-links.tsx's `links` array broke nothing in the suite.
  it("renders nav when signed in", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "user@example.com", user_metadata: {} } },
      error: null,
    });
    await renderLayout();
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("Board")).toBeInTheDocument();
    expect(screen.getByText("Groceries")).toBeInTheDocument();
    expect(screen.getByTestId("nav-user")).toBeInTheDocument();
  });

  // Regression: proxy already guarantees a session on protected routes. If the layout's own
  // getUser() call ever disagrees under flaky connectivity (the iOS PWA resuming from suspend —
  // see docs/ios.md), rendering a nav-less shell with no sign-in and no sign-out is a dead end.
  // The correct behavior is to send the visitor to /login, never to render that dead page.
  it("redirects to /login on a protected route when getUser() returns no user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(renderLayout()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("does not redirect on /login itself when there is no user", async () => {
    mockHeadersGet.mockReturnValue("/login");
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    await renderLayout();
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});
