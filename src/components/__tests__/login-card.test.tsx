import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LoginCard } from "../../app/login/login-card";

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(() => ({ push: jest.fn(), refresh: jest.fn() })),
  useSearchParams: jest.fn(() => new URLSearchParams()),
}));

const mockResetPasswordForEmail = jest.fn();
const mockSignUp = jest.fn();
const mockSignInWithOAuth = jest.fn();
jest.mock("@/lib/supabase/browser", () => ({
  createClient: jest.fn(() => ({
    auth: {
      signInWithPassword: jest.fn(),
      signUp: mockSignUp,
      resetPasswordForEmail: mockResetPasswordForEmail,
      getUser: jest.fn().mockResolvedValue({ data: { user: null } }),
      updateUser: jest.fn(),
      signInWithOAuth: mockSignInWithOAuth,
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

// The reset-mode describes above leave `createClient` and `useSearchParams` pinned via
// mockReturnValue, which clearAllMocks does not undo — so these restore both explicitly.
function useDefaultMocks() {
  jest.mocked(require("next/navigation").useSearchParams).mockReturnValue(new URLSearchParams());
  jest.mocked(require("@/lib/supabase/browser").createClient).mockReturnValue({
    auth: {
      signInWithPassword: jest.fn(),
      signUp: mockSignUp,
      resetPasswordForEmail: mockResetPasswordForEmail,
      getUser: jest.fn().mockResolvedValue({ data: { user: null } }),
      updateUser: jest.fn(),
      signInWithOAuth: mockSignInWithOAuth,
    },
  });
}

function submitSignup() {
  fireEvent.click(screen.getByRole("button", { name: /^sign up$/i }));
  fireEvent.change(screen.getByPlaceholderText("Your name"), { target: { value: "Ada" } });
  fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
    target: { value: "user@example.com" },
  });
  fireEvent.change(screen.getByPlaceholderText("••••••••"), { target: { value: "password1" } });
  fireEvent.click(screen.getByRole("button", { name: /create account/i }));
}

describe("LoginCard — signup with an already-registered email", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useDefaultMocks();
  });

  it("tells the user the account exists instead of claiming an email was sent", async () => {
    // Supabase's anti-enumeration response: no error, obfuscated user, empty identities.
    mockSignUp.mockResolvedValue({ data: { user: { id: "fake", identities: [] } }, error: null });
    render(<LoginCard />);
    submitSignup();
    await waitFor(() => {
      expect(screen.getByText(/already has an account/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /reset your password/i })).toBeInTheDocument();
  });

  it("moves to forgot mode when the reset link in that message is clicked", async () => {
    mockSignUp.mockResolvedValue({ data: { user: { id: "fake", identities: [] } }, error: null });
    render(<LoginCard />);
    submitSignup();
    await waitFor(() => screen.getByRole("button", { name: /reset your password/i }));
    fireEvent.click(screen.getByRole("button", { name: /reset your password/i }));
    expect(screen.getByText("Reset password")).toBeInTheDocument();
    // email is carried over so the user does not retype it
    expect(screen.getByPlaceholderText("you@example.com")).toHaveValue("user@example.com");
  });

  it("still confirms by email for a genuinely new address", async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: "u1", identities: [{ provider: "email" }] } },
      error: null,
    });
    render(<LoginCard />);
    submitSignup();
    await waitFor(() => {
      expect(mockSignUp).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            emailRedirectTo: expect.stringContaining("/auth/callback"),
          }),
        })
      );
    });
    expect(screen.queryByText(/already has an account/i)).not.toBeInTheDocument();
  });
});

describe("LoginCard — Google sign-in", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useDefaultMocks();
  });

  it("offers Google in signin and signup modes but not while resetting", () => {
    render(<LoginCard />);
    expect(screen.getByRole("button", { name: /continue with google/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^sign up$/i }));
    expect(screen.getByRole("button", { name: /continue with google/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
    fireEvent.click(screen.getByText("Forgot?"));
    expect(screen.queryByRole("button", { name: /continue with google/i })).not.toBeInTheDocument();
  });

  it("calls signInWithOAuth with the callback redirect", async () => {
    mockSignInWithOAuth.mockResolvedValue({ error: null });
    render(<LoginCard />);
    fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));
    await waitFor(() => {
      expect(mockSignInWithOAuth).toHaveBeenCalledWith({
        provider: "google",
        options: { redirectTo: expect.stringContaining("/auth/callback?next=") },
      });
    });
  });

  it("surfaces an error when the provider call fails", async () => {
    mockSignInWithOAuth.mockResolvedValue({ error: { message: "Provider not enabled" } });
    render(<LoginCard />);
    fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));
    await waitFor(() => {
      expect(screen.getByText("Provider not enabled")).toBeInTheDocument();
    });
  });
});
