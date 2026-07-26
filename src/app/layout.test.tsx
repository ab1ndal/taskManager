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

const mockGetUser = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() => ({
    auth: { getUser: mockGetUser },
  })),
}));

async function renderLayout() {
  const jsx = await RootLayout({ children: <div>content</div> });
  render(jsx);
}

describe("RootLayout — nav visibility", () => {
  beforeEach(() => jest.clearAllMocks());

  it("does not render nav when signed out", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await renderLayout();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByText("Tasks")).not.toBeInTheDocument();
    expect(screen.queryByText("Workspaces")).not.toBeInTheDocument();
  });

  it("renders nav when signed in", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "user@example.com", user_metadata: {} } },
    });
    await renderLayout();
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("Workspaces")).toBeInTheDocument();
    expect(screen.getByTestId("nav-user")).toBeInTheDocument();
  });
});
