import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

// --- Mocks ---

vi.mock("@superserve/ui", () => ({
  cn: (...classes: Array<string | undefined | false>) =>
    classes.filter(Boolean).join(" "),
  Button: (props: React.JSX.IntrinsicElements["button"]) => (
    <button {...props} />
  ),
  Input: ({
    suffix,
    error,
    wrapperClassName: _wrapperClassName,
    ...props
  }: React.JSX.IntrinsicElements["input"] & {
    suffix?: React.ReactNode
    error?: string
    wrapperClassName?: string
  }) => (
    <div>
      <input {...props} />
      {suffix}
      {error && <p>{error}</p>}
    </div>
  ),
}))

vi.mock("@/components/corner-brackets", () => ({
  CornerBrackets: () => null,
}))
vi.mock("@/components/dither-background", () => ({
  DitherBackground: () => null,
}))
vi.mock("@/components/icons", () => ({
  GoogleIcon: () => <span>GoogleIcon</span>,
  Spinner: ({ className }: { className?: string }) => (
    <div className={className}>spinner</div>
  ),
}))

vi.mock("@phosphor-icons/react", () => ({
  EyeIcon: () => <span>eye</span>,
  EyeSlashIcon: () => <span>eye-slash</span>,
}))

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    <img alt={alt} src={src} />
  ),
}))

const mockSignInWithOAuth = vi.fn()
vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({
    auth: {
      signInWithOAuth: mockSignInWithOAuth,
    },
  }),
}))

const mockSignUpWithEmail = vi.fn()
vi.mock("./action", () => ({
  signUpWithEmail: (...args: unknown[]) => mockSignUpWithEmail(...args),
}))

const mockSearchParams = new URLSearchParams()
const mockRouterPush = vi.fn()
vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ push: mockRouterPush }),
}))

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode
    href: string
  }) => <a href={href}>{children}</a>,
}))

const mockCapture = vi.fn()
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: mockCapture }),
}))

import SignUpPage from "./page"

describe("SignUpPage", () => {
  const user = userEvent.setup()

  beforeEach(() => {
    mockSignUpWithEmail.mockReset()
    mockSignInWithOAuth.mockReset()
    mockCapture.mockReset()
    mockRouterPush.mockReset()
  })

  it("renders the signup form", async () => {
    render(<SignUpPage />)

    expect(
      await screen.findByText("Create your Superserve account"),
    ).toBeInTheDocument()
    expect(screen.getByPlaceholderText("Full Name")).toBeInTheDocument()
    expect(screen.getByPlaceholderText("Email")).toBeInTheDocument()
    expect(screen.getByPlaceholderText("Password")).toBeInTheDocument()
    expect(screen.getByPlaceholderText("Confirm Password")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Sign Up" })).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Continue with Google/ }),
    ).toBeInTheDocument()
  })

  it("shows inline errors when submitting with empty fields", async () => {
    render(<SignUpPage />)

    await user.click(await screen.findByRole("button", { name: "Sign Up" }))

    expect(await screen.findByText("Name is required.")).toBeInTheDocument()
    expect(screen.getByText("Email is required.")).toBeInTheDocument()
    expect(screen.getByText("Password is required.")).toBeInTheDocument()
    expect(mockSignUpWithEmail).not.toHaveBeenCalled()
  })

  it("shows an inline error when password is too short", async () => {
    render(<SignUpPage />)

    await user.type(
      await screen.findByPlaceholderText("Full Name"),
      "Test User",
    )
    await user.type(screen.getByPlaceholderText("Email"), "test@test.com")
    await user.type(screen.getByPlaceholderText("Password"), "1234567")
    await user.type(screen.getByPlaceholderText("Confirm Password"), "1234567")
    await user.click(screen.getByRole("button", { name: "Sign Up" }))

    expect(
      await screen.findByText("Must be at least 8 characters."),
    ).toBeInTheDocument()
  })

  it("shows an inline error when passwords do not match", async () => {
    render(<SignUpPage />)

    await user.type(
      await screen.findByPlaceholderText("Full Name"),
      "Test User",
    )
    await user.type(screen.getByPlaceholderText("Email"), "test@test.com")
    await user.type(screen.getByPlaceholderText("Password"), "password123")
    await user.type(
      screen.getByPlaceholderText("Confirm Password"),
      "different",
    )
    await user.click(screen.getByRole("button", { name: "Sign Up" }))

    expect(
      await screen.findByText("Passwords do not match."),
    ).toBeInTheDocument()
  })

  it("calls signUpWithEmail and shows email-sent state on success", async () => {
    mockSignUpWithEmail.mockResolvedValue({ success: true })
    render(<SignUpPage />)

    await user.type(
      await screen.findByPlaceholderText("Full Name"),
      "Test User",
    )
    await user.type(screen.getByPlaceholderText("Email"), "test@test.com")
    await user.type(screen.getByPlaceholderText("Password"), "password123")
    await user.type(
      screen.getByPlaceholderText("Confirm Password"),
      "password123",
    )
    await user.click(screen.getByRole("button", { name: "Sign Up" }))

    await waitFor(() => {
      expect(screen.getByText("Check Your Email")).toBeInTheDocument()
    })
    expect(mockSignUpWithEmail).toHaveBeenCalledWith(
      "test@test.com",
      "password123",
      "Test User",
      undefined,
    )
  })

  it("shows inline form error when signUpWithEmail returns an error", async () => {
    mockSignUpWithEmail.mockResolvedValue({
      success: false,
      error: "An account with this email already exists.",
    })
    render(<SignUpPage />)

    await user.type(
      await screen.findByPlaceholderText("Full Name"),
      "Test User",
    )
    await user.type(screen.getByPlaceholderText("Email"), "test@test.com")
    await user.type(screen.getByPlaceholderText("Password"), "password123")
    await user.type(
      screen.getByPlaceholderText("Confirm Password"),
      "password123",
    )
    await user.click(screen.getByRole("button", { name: "Sign Up" }))

    expect(
      await screen.findByText("An account with this email already exists."),
    ).toBeInTheDocument()
  })

  it("redirects to auth-code-error when signup is blocked by the trigger", async () => {
    mockSignUpWithEmail.mockResolvedValue({
      success: false,
      error: "Database error saving new user",
      errorCode: "blocked_email",
    })
    render(<SignUpPage />)

    await user.type(
      await screen.findByPlaceholderText("Full Name"),
      "Test User",
    )
    await user.type(screen.getByPlaceholderText("Email"), "test@test.com")
    await user.type(screen.getByPlaceholderText("Password"), "password123")
    await user.type(
      screen.getByPlaceholderText("Confirm Password"),
      "password123",
    )
    await user.click(screen.getByRole("button", { name: "Sign Up" }))

    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalledWith(
        "/auth/auth-code-error?reason=signup_blocked",
      )
    })
  })

  it("shows generic error when signUpWithEmail throws", async () => {
    mockSignUpWithEmail.mockRejectedValue(new Error("network error"))
    render(<SignUpPage />)

    await user.type(
      await screen.findByPlaceholderText("Full Name"),
      "Test User",
    )
    await user.type(screen.getByPlaceholderText("Email"), "test@test.com")
    await user.type(screen.getByPlaceholderText("Password"), "password123")
    await user.type(
      screen.getByPlaceholderText("Confirm Password"),
      "password123",
    )
    await user.click(screen.getByRole("button", { name: "Sign Up" }))

    expect(
      await screen.findByText("Error creating account. Please try again."),
    ).toBeInTheDocument()
  })

  it("triggers Google OAuth on button click", async () => {
    mockSignInWithOAuth.mockResolvedValue({ error: null })
    render(<SignUpPage />)

    await user.click(
      await screen.findByRole("button", { name: /Continue with Google/ }),
    )

    await waitFor(() => {
      expect(mockSignInWithOAuth).toHaveBeenCalledWith({
        provider: "google",
        options: { redirectTo: expect.stringContaining("/auth/callback") },
      })
    })
  })

  it("has a link to sign in page", async () => {
    render(<SignUpPage />)

    const signInLink = await screen.findByRole("link", { name: "Sign in" })
    expect(signInLink).toHaveAttribute("href", "/auth/signin")
  })
})
