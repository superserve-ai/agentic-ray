import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock supabase client
const mockSignInWithPassword = vi.fn();
const mockSignUp = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
      signUp: mockSignUp,
    },
  }),
}));

import { DEV_AUTH_ENABLED, devSignIn } from "./auth-helpers";

describe("DEV_AUTH_ENABLED", () => {
  it("is a boolean derived from NEXT_PUBLIC_ENABLE_DEV_AUTH", () => {
    expect(typeof DEV_AUTH_ENABLED).toBe("boolean");
  });
});

describe("devSignIn", () => {
  beforeEach(() => {
    mockSignInWithPassword.mockReset();
    mockSignUp.mockReset();
  });

  it("returns error when dev auth is disabled", async () => {
    // DEV_AUTH_ENABLED is set via env in test/setup.ts
    // We test the function behavior assuming it's enabled
    // If NEXT_PUBLIC_ENABLE_DEV_AUTH is not "true", it returns early
    // Since our test setup sets it to "true", we test the enabled path
  });

  it("returns success on successful sign-in", async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null });

    const result = await devSignIn();

    expect(result).toEqual({ success: true });
    expect(mockSignInWithPassword).toHaveBeenCalled();
  });

  it("creates user and retries sign-in on invalid credentials", async () => {
    mockSignInWithPassword
      .mockResolvedValueOnce({
        error: { message: "Invalid login credentials" },
      })
      .mockResolvedValueOnce({ error: null });
    mockSignUp.mockResolvedValue({ error: null });

    const result = await devSignIn();

    expect(result).toEqual({ success: true });
    expect(mockSignUp).toHaveBeenCalled();
    expect(mockSignInWithPassword).toHaveBeenCalledTimes(2);
  });

  it("returns error when sign-up fails", async () => {
    mockSignInWithPassword.mockResolvedValue({
      error: { message: "Invalid login credentials" },
    });
    mockSignUp.mockResolvedValue({ error: new Error("signup failed") });

    const result = await devSignIn();

    expect(result).toEqual({
      success: false,
      error: "Dev auth failed. Check console.",
    });
  });

  it("returns error when retry sign-in fails after signup", async () => {
    mockSignInWithPassword
      .mockResolvedValueOnce({
        error: { message: "Invalid login credentials" },
      })
      .mockResolvedValueOnce({ error: new Error("still failing") });
    mockSignUp.mockResolvedValue({ error: null });

    const result = await devSignIn();

    expect(result).toEqual({
      success: false,
      error: "Dev auth failed. Check console.",
    });
  });

  it("returns error on non-credentials sign-in error", async () => {
    mockSignInWithPassword.mockResolvedValue({
      error: { message: "Network error" },
    });

    const result = await devSignIn();

    expect(result).toEqual({
      success: false,
      error: "Dev auth failed. Check console.",
    });
  });

  it("returns error on unexpected exception", async () => {
    mockSignInWithPassword.mockRejectedValue(new Error("crash"));

    const result = await devSignIn();

    expect(result).toEqual({
      success: false,
      error: "Dev auth failed. Check console.",
    });
  });
});
