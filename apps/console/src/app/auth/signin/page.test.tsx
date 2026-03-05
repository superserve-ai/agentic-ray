import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks ---

const mockAddToast = vi.fn();
vi.mock("@superserve/ui", () => ({
  useToast: () => ({ addToast: mockAddToast }),
  Button: (props: React.JSX.IntrinsicElements["button"]) => (
    <button {...props} />
  ),
  Input: ({
    suffix,
    ...props
  }: React.JSX.IntrinsicElements["input"] & { suffix?: React.ReactNode }) => (
    <div>
      <input {...props} />
      {suffix}
    </div>
  ),
}));

const mockPush = vi.fn();
let searchParamsMap: Record<string, string> = {};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({
    get: (key: string) => searchParamsMap[key] ?? null,
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

const mockSignInWithPassword = vi.fn();
const mockSignInWithOAuth = vi.fn();
const mockGetSession = vi.fn();
const mockGetUser = vi.fn();
const mockSignOut = vi.fn();

vi.mock("@/components/icons", () => ({
  GoogleIcon: () => <span>GoogleIcon</span>,
  Spinner: ({ className }: { className?: string }) => (
    <div className={className}>spinner</div>
  ),
}));

vi.mock("@/lib/auth-helpers", () => ({
  DEV_AUTH_ENABLED: false,
  devSignIn: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
      signInWithOAuth: mockSignInWithOAuth,
      getSession: mockGetSession,
      getUser: mockGetUser,
      signOut: mockSignOut,
    },
  }),
}));

import SignInPage from "./page";

describe("SignInPage", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    mockAddToast.mockReset();
    mockPush.mockReset();
    mockSignInWithPassword.mockReset();
    mockSignInWithOAuth.mockReset();
    mockSignOut.mockReset();
    searchParamsMap = {};
    // Default: no existing session
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });
  });

  it("renders the signin form", () => {
    render(<SignInPage />);

    expect(screen.getByText("Welcome Back")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Email")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign In" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Continue with Google/ }),
    ).toBeInTheDocument();
  });

  it("shows error toast when submitting with empty fields", async () => {
    render(<SignInPage />);

    await user.click(screen.getByRole("button", { name: "Sign In" }));

    expect(mockAddToast).toHaveBeenCalledWith(
      "Please enter your email and password.",
      "error",
    );
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  it("calls signInWithPassword and redirects on success", async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null });
    render(<SignInPage />);

    await user.type(screen.getByPlaceholderText("Email"), "test@test.com");
    await user.type(screen.getByPlaceholderText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: "test@test.com",
        password: "password123",
      });
      expect(mockPush).toHaveBeenCalledWith("/");
    });
  });

  it("redirects to next URL after successful login", async () => {
    searchParamsMap = { next: "/dashboard/settings" };
    mockSignInWithPassword.mockResolvedValue({ error: null });
    render(<SignInPage />);

    await user.type(screen.getByPlaceholderText("Email"), "test@test.com");
    await user.type(screen.getByPlaceholderText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/dashboard/settings");
    });
  });

  it("shows invalid credentials toast on wrong password", async () => {
    mockSignInWithPassword.mockResolvedValue({
      error: { message: "Invalid login credentials" },
    });
    render(<SignInPage />);

    await user.type(screen.getByPlaceholderText("Email"), "test@test.com");
    await user.type(screen.getByPlaceholderText("Password"), "wrongpassword");
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        "Invalid email or password.",
        "error",
      );
    });
  });

  it("shows email not confirmed toast", async () => {
    mockSignInWithPassword.mockResolvedValue({
      error: { message: "Email not confirmed" },
    });
    render(<SignInPage />);

    await user.type(screen.getByPlaceholderText("Email"), "test@test.com");
    await user.type(screen.getByPlaceholderText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        "Please verify your email before signing in.",
        "error",
      );
    });
  });

  it("shows generic error toast on unexpected error", async () => {
    mockSignInWithPassword.mockRejectedValue(new Error("network failure"));
    render(<SignInPage />);

    await user.type(screen.getByPlaceholderText("Email"), "test@test.com");
    await user.type(screen.getByPlaceholderText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        "Error signing in. Please try again.",
        "error",
      );
    });
  });

  it("triggers Google OAuth on button click", async () => {
    mockSignInWithOAuth.mockResolvedValue({ error: null });
    render(<SignInPage />);

    await user.click(
      screen.getByRole("button", { name: /Continue with Google/ }),
    );

    await waitFor(() => {
      expect(mockSignInWithOAuth).toHaveBeenCalledWith({
        provider: "google",
        options: { redirectTo: expect.stringContaining("/auth/callback") },
      });
    });
  });

  it("has links to sign up and forgot password", () => {
    render(<SignInPage />);

    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute(
      "href",
      "/auth/signup",
    );
    expect(
      screen.getByRole("link", { name: "Forgot password?" }),
    ).toHaveAttribute("href", "/auth/forgot-password");
  });

  it("redirects if user already has a valid session", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "token" } },
      error: null,
    });
    mockGetUser.mockResolvedValue({
      data: { user: { id: "123" } },
      error: null,
    });

    render(<SignInPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/");
    });
  });
});
