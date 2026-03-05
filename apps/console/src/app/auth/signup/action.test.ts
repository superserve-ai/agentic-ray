import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before importing the action
const mockGenerateLink = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        generateLink: mockGenerateLink,
      },
    },
  }),
}));

const mockSendEmail = vi.fn();
vi.mock("@/lib/email/send", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

vi.mock("@/lib/email/templates/confirmation", () => ({
  ConfirmationEmail: (props: { confirmationUrl: string }) =>
    `ConfirmationEmail:${props.confirmationUrl}`,
}));

vi.mock("@/lib/email/templates/welcome", () => ({
  WelcomeEmail: (props: { name: string; dashboardUrl: string }) =>
    `WelcomeEmail:${props.name}`,
}));

const mockSlack = vi.fn().mockResolvedValue(undefined);
vi.mock("@/app/auth/signin/action", () => ({
  notifySlackOfNewUser: (...args: unknown[]) => mockSlack(...args),
}));

import { signUpWithEmail } from "./action";

describe("signUpWithEmail", () => {
  beforeEach(() => {
    mockGenerateLink.mockReset();
    mockSendEmail.mockReset();
    mockSlack.mockReset().mockResolvedValue(undefined);
  });

  it("returns error for invalid email", async () => {
    const result = await signUpWithEmail("not-an-email", "password123", "Test User");
    expect(result).toEqual({
      success: false,
      error: "Invalid email address.",
    });
    expect(mockGenerateLink).not.toHaveBeenCalled();
  });

  it("returns error for short password", async () => {
    const result = await signUpWithEmail("user@test.com", "short", "Test User");
    expect(result).toEqual({
      success: false,
      error: "Password must be at least 8 characters.",
    });
    expect(mockGenerateLink).not.toHaveBeenCalled();
  });

  it("returns error for empty name", async () => {
    const result = await signUpWithEmail("user@test.com", "password123", "");
    expect(result).toEqual({
      success: false,
      error: "Name is required.",
    });
    expect(mockGenerateLink).not.toHaveBeenCalled();
  });

  it("returns success and sends confirmation email on valid signup", async () => {
    mockGenerateLink.mockResolvedValue({
      data: { properties: { hashed_token: "abc123" } },
      error: null,
    });
    mockSendEmail.mockResolvedValue({ success: true });

    const result = await signUpWithEmail(
      "user@test.com",
      "password123",
      "Test User",
    );

    expect(result).toEqual({ success: true });
    expect(mockGenerateLink).toHaveBeenCalledWith({
      type: "signup",
      email: "user@test.com",
      password: "password123",
      options: {
        data: { full_name: "Test User" },
        redirectTo: expect.stringContaining("/auth/callback"),
      },
    });
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@test.com",
        subject: "Confirm your Superserve account",
      }),
    );
  });

  it("returns error when email is already registered", async () => {
    mockGenerateLink.mockResolvedValue({
      data: null,
      error: { message: "User already registered" },
    });

    const result = await signUpWithEmail(
      "existing@test.com",
      "password123",
      "Test User",
    );

    expect(result).toEqual({
      success: false,
      error: "An account with this email already exists.",
    });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("returns error message from supabase on other errors", async () => {
    mockGenerateLink.mockResolvedValue({
      data: null,
      error: { message: "Rate limit exceeded" },
    });

    const result = await signUpWithEmail(
      "user@test.com",
      "password123",
      "Test User",
    );

    expect(result).toEqual({
      success: false,
      error: "Rate limit exceeded",
    });
  });

  it("returns error when token hash is missing", async () => {
    mockGenerateLink.mockResolvedValue({
      data: { properties: {} },
      error: null,
    });

    const result = await signUpWithEmail(
      "user@test.com",
      "password123",
      "Test User",
    );

    expect(result).toEqual({
      success: false,
      error: "Failed to generate confirmation link.",
    });
  });

  it("returns generic error on unexpected exception", async () => {
    mockGenerateLink.mockRejectedValue(new Error("network error"));

    const result = await signUpWithEmail(
      "user@test.com",
      "password123",
      "Test User",
    );

    expect(result).toEqual({
      success: false,
      error: "Error creating account. Please try again.",
    });
  });

  it("notifies slack after successful signup (fire and forget)", async () => {
    mockGenerateLink.mockResolvedValue({
      data: { properties: { hashed_token: "abc123" } },
      error: null,
    });
    mockSendEmail.mockResolvedValue({ success: true });
    mockSlack.mockResolvedValue({ success: true });

    await signUpWithEmail(
      "user@test.com",
      "password123",
      "Test User",
    );

    // Slack is called fire-and-forget via .catch(), give it a tick
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSlack).toHaveBeenCalled();
  });
});
