import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { createClient } from "@/lib/supabase/client";

export interface AuthValidationResult {
  isValid: boolean;
  shouldSignOut: boolean;
  error?: string;
}

type AddToastFunction = (message: string, type: "success" | "error") => void;

export async function validateSession(): Promise<AuthValidationResult> {
  const supabase = createClient();

  try {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError) {
      return { isValid: false, shouldSignOut: true, error: "Session corrupted" };
    }

    if (!session) {
      return { isValid: false, shouldSignOut: false, error: "No session found" };
    }

    const { error: userError } = await supabase.auth.getUser();

    if (userError?.code === "user_not_found") {
      return { isValid: false, shouldSignOut: true, error: "User no longer exists" };
    }

    if (userError) {
      return { isValid: false, shouldSignOut: true, error: "Authentication error" };
    }

    return { isValid: true, shouldSignOut: false };
  } catch (error) {
    console.error("Session validation failed:", error);
    return { isValid: false, shouldSignOut: true, error: "Session validation failed" };
  }
}

export const DEV_AUTH_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_DEV_AUTH === "true";
const DEV_EMAIL =
  process.env.NEXT_PUBLIC_DEV_AUTH_EMAIL || "dev@superserve.local";
const DEV_PASSWORD =
  process.env.NEXT_PUBLIC_DEV_AUTH_PASSWORD || "dev-password-123";

/**
 * Attempts dev sign-in, creating the dev user if it doesn't exist yet.
 * Returns { success: true } or { success: false, error }.
 */
export async function devSignIn(): Promise<{
  success: boolean;
  error?: string;
}> {
  if (!DEV_AUTH_ENABLED) return { success: false, error: "Dev auth disabled" };

  const supabase = createClient();

  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: DEV_EMAIL,
      password: DEV_PASSWORD,
    });

    if (error) {
      if (error.message.includes("Invalid login credentials")) {
        const { error: signUpError } = await supabase.auth.signUp({
          email: DEV_EMAIL,
          password: DEV_PASSWORD,
          options: { data: { full_name: "Dev User" } },
        });
        if (signUpError) {
          console.error("Dev sign up error:", signUpError);
          return { success: false, error: "Dev auth failed. Check console." };
        }
        const { error: signInError } =
          await supabase.auth.signInWithPassword({
            email: DEV_EMAIL,
            password: DEV_PASSWORD,
          });
        if (signInError) {
          console.error("Dev sign in error:", signInError);
          return { success: false, error: "Dev auth failed. Check console." };
        }
      } else {
        console.error("Dev sign in error:", error);
        return { success: false, error: "Dev auth failed. Check console." };
      }
    }

    return { success: true };
  } catch (err) {
    console.error("Dev auth error:", err);
    return { success: false, error: "Dev auth failed. Check console." };
  }
}

export async function handleAuthError(
  // biome-ignore lint/suspicious/noExplicitAny: error type varies
  error: any,
  router: AppRouterInstance,
  addToast?: AddToastFunction,
) {
  const supabase = createClient();

  if (error?.code === "user_not_found" || error?.shouldSignOut) {
    await supabase.auth.signOut();
    if (addToast) {
      addToast("Session expired. Please sign in again.", "error");
    }
    router.push("/auth/signin");
    return true;
  }

  return false;
}
