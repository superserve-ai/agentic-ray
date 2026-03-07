import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks ---

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
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

const mockAddToast = vi.fn();
vi.mock("@superserve/ui", () => ({
  useToast: () => ({ addToast: mockAddToast }),
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
  Button: (props: React.JSX.IntrinsicElements["button"]) => (
    <button {...props} />
  ),
  Input: (props: React.JSX.IntrinsicElements["input"]) => <input {...props} />,
  Textarea: (props: React.JSX.IntrinsicElements["textarea"]) => (
    <textarea {...props} />
  ),
  FormField: ({
    children,
    label,
  }: {
    children: React.ReactNode;
    label: string;
    required?: boolean;
  }) => (
    <div>
      <label>{label}</label>
      {children}
    </div>
  ),
  Alert: ({
    children,
  }: {
    children: React.ReactNode;
    variant?: string;
    className?: string;
  }) => <div role="alert">{children}</div>,
  Card: ({
    children,
    ...props
  }: React.JSX.IntrinsicElements["div"]) => <div {...props}>{children}</div>,
  Badge: ({
    children,
  }: {
    children: React.ReactNode;
    variant?: string;
    dot?: boolean;
  }) => <span>{children}</span>,
}));

const mockGetUser = vi.fn();
const mockGetSession = vi.fn();
const mockFrom = vi.fn();

vi.mock("@superserve/supabase", () => ({
  createBrowserClient: () => ({
    auth: {
      getUser: mockGetUser,
      getSession: mockGetSession,
    },
    from: mockFrom,
  }),
}));

const mockCapture = vi.fn();
const mockIdentify = vi.fn();
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: mockCapture, identify: mockIdentify }),
}));

const mockSendToSlack = vi.fn();
vi.mock("./action", () => ({
  sendEarlyAccessToSlack: (...args: unknown[]) => mockSendToSlack(...args),
}));

import DashboardPage from "./page";

describe("DashboardPage", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    mockPush.mockReset();
    mockGetUser.mockReset();
    mockGetSession.mockReset();
    mockFrom.mockReset();
    mockCapture.mockReset();
    mockIdentify.mockReset();
    mockSendToSlack.mockReset();
    mockAddToast.mockReset();
  });

  it("redirects to signin if not authenticated", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
    });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/auth/signin");
    });
  });

  function mockFromWithNoAgents(earlyAccessData: { id: string } | null = null) {
    mockFrom.mockImplementation((table: string) => {
      if (table === "agents") {
        return {
          select: () => ({
            eq: () => ({
              limit: () => Promise.resolve({ data: [] }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: earlyAccessData }),
          }),
        }),
      };
    });
  }

  it("redirects to playground when user has agents", async () => {
    const originalLocation = window.location;
    const assignMock = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, href: originalLocation.href },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window.location, "href", {
      set: assignMock,
      configurable: true,
    });

    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "user-123",
          email: "test@test.com",
          user_metadata: { full_name: "Test User" },
        },
      },
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === "agents") {
        return {
          select: () => ({
            eq: () => ({
              limit: () =>
                Promise.resolve({ data: [{ id: "agt_abc123" }] }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null }),
          }),
        }),
      };
    });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith(
        "https://playground.superserve.ai",
      );
    });

    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  it("renders CLI instructions and request access link for authenticated user", async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "user-123",
          email: "test@test.com",
          user_metadata: { full_name: "Test User" },
        },
      },
    });
    mockFromWithNoAgents();

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText(/curl/)).toBeInTheDocument();
    });
    expect(screen.getByText(/superserve\.ai\/install/)).toBeInTheDocument();
    expect(screen.getByText(/Request dashboard access/)).toBeInTheDocument();
  });

  it("shows the form when 'Request dashboard access' is clicked", async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "user-123",
          email: "test@test.com",
          user_metadata: { full_name: "Test User" },
        },
      },
    });
    mockFromWithNoAgents();

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText(/Request dashboard access/)).toBeInTheDocument();
    });

    await user.click(screen.getByText(/Request dashboard access/));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Request Access/ }),
      ).toBeInTheDocument();
    });

    // Form should be pre-filled with user data
    const nameInput = screen.getByPlaceholderText("Jane Doe");
    const emailInput = screen.getByPlaceholderText("jane@company.com");
    expect(nameInput).toHaveValue("Test User");
    expect(emailInput).toHaveValue("test@test.com");
  });

  it("shows already-submitted message when user has previously submitted", async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "user-123",
          email: "test@test.com",
          user_metadata: { full_name: "Test User" },
        },
      },
    });
    mockFromWithNoAgents({ id: "req-1" });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText(/Request dashboard access/)).toBeInTheDocument();
    });

    await user.click(screen.getByText(/Request dashboard access/));

    await waitFor(() => {
      expect(
        screen.getByText(/already received your request/),
      ).toBeInTheDocument();
    });
  });
});
