import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LoginCard } from "../../app/login/login-card";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const mockResetPasswordForEmail = jest.fn();
jest.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: jest.fn(),
      signUp: jest.fn(),
      resetPasswordForEmail: mockResetPasswordForEmail,
      getUser: jest.fn().mockResolvedValue({ data: { user: null } }),
      updateUser: jest.fn(),
    },
  }),
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
