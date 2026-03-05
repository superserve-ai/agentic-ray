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

vi.mock("@/components/icons", () => ({
  GoogleIcon: () => <span>GoogleIcon</span>,
  Spinner: ({ className }: { className?: string }) => (
    <div className={className}>spinner</div>
  ),
}));

const mockSignInWithOAuth = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signInWithOAuth: mockSignInWithOAuth,
    },
  }),
}));

const mockSignUpWithEmail = vi.fn();
vi.mock("./action", () => ({
  signUpWithEmail: (...args: unknown[]) => mockSignUpWithEmail(...args),
}));

const mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
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

import SignUpPage from "./page";

describe("SignUpPage", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    mockAddToast.mockReset();
    mockSignUpWithEmail.mockReset();
    mockSignInWithOAuth.mockReset();
  });

  it("renders the signup form", () => {
    render(<SignUpPage />);

    expect(screen.getByText("Create Account")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Full Name")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Email")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Password")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Confirm Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign Up" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Continue with Google/ }),
    ).toBeInTheDocument();
  });

  it("shows error toast when submitting with empty fields", async () => {
    render(<SignUpPage />);

    await user.click(screen.getByRole("button", { name: "Sign Up" }));

    expect(mockAddToast).toHaveBeenCalledWith(
      "Please fill in all fields.",
      "error",
    );
    expect(mockSignUpWithEmail).not.toHaveBeenCalled();
  });

  it("shows error toast when password is too short", async () => {
    render(<SignUpPage />);

    await user.type(screen.getByPlaceholderText("Full Name"), "Test User");
    await user.type(screen.getByPlaceholderText("Email"), "test@test.com");
    await user.type(screen.getByPlaceholderText("Password"), "1234567");
    await user.type(screen.getByPlaceholderText("Confirm Password"), "1234567");
    await user.click(screen.getByRole("button", { name: "Sign Up" }));

    expect(mockAddToast).toHaveBeenCalledWith(
      "Password must be at least 8 characters.",
      "error",
    );
  });

  it("shows error toast when passwords do not match", async () => {
    render(<SignUpPage />);

    await user.type(screen.getByPlaceholderText("Full Name"), "Test User");
    await user.type(screen.getByPlaceholderText("Email"), "test@test.com");
    await user.type(screen.getByPlaceholderText("Password"), "password123");
    await user.type(
      screen.getByPlaceholderText("Confirm Password"),
      "different",
    );
    await user.click(screen.getByRole("button", { name: "Sign Up" }));

    expect(mockAddToast).toHaveBeenCalledWith(
      "Passwords do not match.",
      "error",
    );
  });

  it("calls signUpWithEmail and shows email sent state on success", async () => {
    mockSignUpWithEmail.mockResolvedValue({ success: true });
    render(<SignUpPage />);

    await user.type(screen.getByPlaceholderText("Full Name"), "Test User");
    await user.type(screen.getByPlaceholderText("Email"), "test@test.com");
    await user.type(screen.getByPlaceholderText("Password"), "password123");
    await user.type(
      screen.getByPlaceholderText("Confirm Password"),
      "password123",
    );
    await user.click(screen.getByRole("button", { name: "Sign Up" }));

    await waitFor(() => {
      expect(screen.getByText("Check Your Email")).toBeInTheDocument();
    });
    expect(mockSignUpWithEmail).toHaveBeenCalledWith(
      "test@test.com",
      "password123",
      "Test User",
    );
  });

  it("shows error toast when signUpWithEmail returns error", async () => {
    mockSignUpWithEmail.mockResolvedValue({
      success: false,
      error: "An account with this email already exists.",
    });
    render(<SignUpPage />);

    await user.type(screen.getByPlaceholderText("Full Name"), "Test User");
    await user.type(screen.getByPlaceholderText("Email"), "test@test.com");
    await user.type(screen.getByPlaceholderText("Password"), "password123");
    await user.type(
      screen.getByPlaceholderText("Confirm Password"),
      "password123",
    );
    await user.click(screen.getByRole("button", { name: "Sign Up" }));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        "An account with this email already exists.",
        "error",
      );
    });
  });

  it("shows generic error toast when signUpWithEmail throws", async () => {
    mockSignUpWithEmail.mockRejectedValue(new Error("network error"));
    render(<SignUpPage />);

    await user.type(screen.getByPlaceholderText("Full Name"), "Test User");
    await user.type(screen.getByPlaceholderText("Email"), "test@test.com");
    await user.type(screen.getByPlaceholderText("Password"), "password123");
    await user.type(
      screen.getByPlaceholderText("Confirm Password"),
      "password123",
    );
    await user.click(screen.getByRole("button", { name: "Sign Up" }));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        "Error creating account. Please try again.",
        "error",
      );
    });
  });

  it("triggers Google OAuth on button click", async () => {
    mockSignInWithOAuth.mockResolvedValue({ error: null });
    render(<SignUpPage />);

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

  it("has a link to sign in page", () => {
    render(<SignUpPage />);

    const signInLink = screen.getByRole("link", { name: "Sign in" });
    expect(signInLink).toHaveAttribute("href", "/auth/signin");
  });
});
