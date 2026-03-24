import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LoginCard } from "../../app/login/login-card";

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(() => ({ push: jest.fn(), refresh: jest.fn() })),
  useSearchParams: jest.fn(() => new URLSearchParams()),
}));

const mockResetPasswordForEmail = jest.fn();
jest.mock("@/lib/supabase/browser", () => ({
  createClient: jest.fn(() => ({
    auth: {
      signInWithPassword: jest.fn(),
      signUp: jest.fn(),
      resetPasswordForEmail: mockResetPasswordForEmail,
      getUser: jest.fn().mockResolvedValue({ data: { user: null } }),
      updateUser: jest.fn(),
    },
  })),
}));

jest.mock("@/components/toaster", () => ({
  toast: jest.fn(),
}));

describe("LoginCard — forgot mode", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows Forgot? link next to password label in signin mode", () => {
    render(<LoginCard />);
    expect(screen.getByText("Forgot?")).toBeInTheDocument();
  });

  it("does not show Forgot? link in signup mode", () => {
    render(<LoginCard />);
    fireEvent.click(screen.getByRole("button", { name: /sign up/i }));
    expect(screen.queryByText("Forgot?")).not.toBeInTheDocument();
  });

  it("switches to forgot mode when Forgot? is clicked", () => {
    render(<LoginCard />);
    fireEvent.click(screen.getByText("Forgot?"));
    expect(screen.getByText("Reset password")).toBeInTheDocument();
    expect(screen.getByText("We'll email you a link.")).toBeInTheDocument();
  });

  it("does not render password field in forgot mode", () => {
    render(<LoginCard />);
    fireEvent.click(screen.getByText("Forgot?"));
    expect(screen.queryByPlaceholderText("••••••••")).not.toBeInTheDocument();
  });

  it("renders Back to sign in link in forgot mode", () => {
    render(<LoginCard />);
    fireEvent.click(screen.getByText("Forgot?"));
    expect(screen.getByText(/back to sign in/i)).toBeInTheDocument();
  });

  it("returns to signin mode when Back to sign in is clicked", () => {
    render(<LoginCard />);
    fireEvent.click(screen.getByText("Forgot?"));
    fireEvent.click(screen.getByText(/back to sign in/i));
    expect(screen.getByText("Forgot?")).toBeInTheDocument();
  });

  it("calls resetPasswordForEmail and stays in forgot mode on success", async () => {
    mockResetPasswordForEmail.mockResolvedValue({ error: null });
    render(<LoginCard />);
    fireEvent.click(screen.getByText("Forgot?"));
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
    await waitFor(() => {
      expect(mockResetPasswordForEmail).toHaveBeenCalledWith(
        "user@example.com",
        expect.objectContaining({ redirectTo: expect.stringContaining("/auth/callback") })
      );
    });
    expect(screen.getByText("Reset password")).toBeInTheDocument();
  });

  it("shows inline error when resetPasswordForEmail fails", async () => {
    mockResetPasswordForEmail.mockResolvedValue({
      error: { message: "Rate limit exceeded" },
    });
    render(<LoginCard />);
    fireEvent.click(screen.getByText("Forgot?"));
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
    await waitFor(() => {
      expect(screen.getByText("Rate limit exceeded")).toBeInTheDocument();
    });
  });
});

describe("LoginCard — reset mode (URL param)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("initialises to reset mode when ?mode=reset is in the URL", async () => {
    jest.mocked(require("next/navigation").useSearchParams).mockReturnValue(
      new URLSearchParams("mode=reset")
    );
    jest.mocked(require("@/lib/supabase/browser").createClient).mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
        updateUser: jest.fn(),
        resetPasswordForEmail: jest.fn(),
        signInWithPassword: jest.fn(),
        signUp: jest.fn(),
      },
    });
    render(<LoginCard />);
    await waitFor(() => {
      expect(screen.getByText("Set new password")).toBeInTheDocument();
    });
  });

  it("shows expired-link message when in reset mode but no session", async () => {
    jest.mocked(require("next/navigation").useSearchParams).mockReturnValue(
      new URLSearchParams("mode=reset")
    );
    jest.mocked(require("@/lib/supabase/browser").createClient).mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: null } }),
        updateUser: jest.fn(),
        resetPasswordForEmail: jest.fn(),
        signInWithPassword: jest.fn(),
        signUp: jest.fn(),
      },
    });
    render(<LoginCard />);
    await waitFor(() => {
      expect(screen.getByText(/expired or already been used/i)).toBeInTheDocument();
    });
  });

  it("shows inline error when passwords do not match", async () => {
    jest.mocked(require("next/navigation").useSearchParams).mockReturnValue(
      new URLSearchParams("mode=reset")
    );
    jest.mocked(require("@/lib/supabase/browser").createClient).mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
        updateUser: jest.fn(),
        resetPasswordForEmail: jest.fn(),
        signInWithPassword: jest.fn(),
        signUp: jest.fn(),
      },
    });
    render(<LoginCard />);
    await waitFor(() => screen.getByText("Set new password"));
    fireEvent.change(screen.getByPlaceholderText("New password"), {
      target: { value: "password1" },
    });
    fireEvent.change(screen.getByPlaceholderText("Confirm password"), {
      target: { value: "password2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));
    expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
  });

  it("calls updateUser and redirects on success", async () => {
    const mockPush = jest.fn();
    const mockRefresh = jest.fn();
    const mockUpdateUser = jest.fn().mockResolvedValue({ error: null });
    jest.mocked(require("next/navigation").useRouter).mockReturnValue({
      push: mockPush,
      refresh: mockRefresh,
    });
    jest.mocked(require("next/navigation").useSearchParams).mockReturnValue(
      new URLSearchParams("mode=reset")
    );
    jest.mocked(require("@/lib/supabase/browser").createClient).mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
        updateUser: mockUpdateUser,
        resetPasswordForEmail: jest.fn(),
        signInWithPassword: jest.fn(),
        signUp: jest.fn(),
      },
    });
    render(<LoginCard />);
    await waitFor(() => screen.getByText("Set new password"));
    fireEvent.change(screen.getByPlaceholderText("New password"), {
      target: { value: "newpass123" },
    });
    fireEvent.change(screen.getByPlaceholderText("Confirm password"), {
      target: { value: "newpass123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));
    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalledWith({ password: "newpass123" });
      expect(mockPush).toHaveBeenCalledWith("/tasks");
      expect(mockRefresh).toHaveBeenCalled();
    });
  });
});
