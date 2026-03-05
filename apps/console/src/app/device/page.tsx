"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { Suspense, useEffect, useState } from "react";
import { Button, useToast } from "@superserve/ui";
import { DEV_AUTH_ENABLED, devSignIn } from "@/lib/auth-helpers";
import { createClient } from "@/lib/supabase/client";

function Logo() {
  return (
    <div className="mb-8">
      <Link href="/" className="flex items-center gap-2">
        <img src="/logo.svg" alt="Superserve" className="h-10 mb-2" />
      </Link>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function DevicePageContent() {
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isDevLoading, setIsDevLoading] = useState(false);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const { addToast } = useToast();

  const searchParams = useSearchParams();
  const supabase = createClient();
  const posthog = usePostHog();
  const userCode = searchParams.get("code");

  useEffect(() => {
    const checkUser = async () => {
      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (error) {
          await supabase.auth.signOut();
          return;
        }

        if (session?.user) {
          const {
            data: { user: authUser },
            error: userError,
          } = await supabase.auth.getUser();
          if (userError?.code === "user_not_found") {
            await supabase.auth.signOut();
            return;
          }
          if (authUser) {
            setUser({ id: authUser.id, email: authUser.email });
            if (posthog) {
              posthog.identify(authUser.id, { email: authUser.email });
            }
          }
        }
      } catch (_error) {
        await supabase.auth.signOut();
      } finally {
        setIsCheckingSession(false);
      }
    };
    checkUser();
  }, [supabase.auth, posthog]);

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    try {
      const callbackUrl = new URL("/auth/callback", window.location.origin);
      callbackUrl.searchParams.set("next", `/device?code=${userCode}`);

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: callbackUrl.toString(),
        },
      });

      if (error) {
        console.error("Error signing in:", error);
        addToast("Error signing in. Please try again.", "error");
      }
    } catch (err) {
      console.error("Sign in error:", err);
      addToast("Error signing in. Please try again.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDevSignIn = async () => {
    if (!DEV_AUTH_ENABLED) return;

    setIsDevLoading(true);
    try {
      const result = await devSignIn();
      if (!result.success) {
        addToast(result.error || "Dev auth failed.", "error");
        return;
      }

      const {
        data: { user: signedInUser },
      } = await supabase.auth.getUser();
      if (signedInUser) {
        setUser({ id: signedInUser.id, email: signedInUser.email });
        if (posthog) {
          posthog.identify(signedInUser.id, { email: signedInUser.email });
        }
      }
    } catch (err) {
      console.error("Dev auth error:", err);
      addToast("Dev auth failed. Check console.", "error");
    } finally {
      setIsDevLoading(false);
    }
  };

  const handleAuthorize = async () => {
    if (!userCode || !user) return;

    setIsAuthorizing(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error("Session expired. Please sign in again.");
      }

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/v1/auth/device-authorize`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            user_code: userCode,
          }),
        },
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || "Failed to authorize device");
      }

      setIsAuthorized(true);
      if (posthog) {
        posthog.capture("cli_device_authorized", {
          user_email: user.email,
        });
      }
    } catch (err) {
      console.error("Authorization error:", err);
      const message =
        err instanceof Error ? err.message : "Failed to authorize device";
      addToast(message, "error");
    } finally {
      setIsAuthorizing(false);
    }
  };

  // No code provided
  if (!userCode) {
    return (
      <div className="min-h-screen bg-background relative overflow-hidden">
        <div className="relative z-10 min-h-screen flex flex-col items-center justify-center p-4">
          <Logo />
          <div className="w-full max-w-sm">
            <div className="bg-surface border border-border border-dashed p-8 text-center">
              <h1 className="text-xl font-semibold text-foreground mb-4">
                Invalid Request
              </h1>
              <p className="text-sm text-muted">
                No device code provided. Run{" "}
                <code className="bg-background px-2 py-1 text-xs">
                  superserve login
                </code>{" "}
                from your terminal.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Successfully authorized
  if (isAuthorized) {
    return (
      <div className="min-h-screen bg-background relative overflow-hidden">
        <div className="relative z-10 min-h-screen flex flex-col items-center justify-center p-4">
          <Logo />
          <div className="w-full max-w-sm">
            <div className="bg-surface border border-border border-dashed p-8 text-center">
              <svg
                className="w-12 h-12 text-success mx-auto mb-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
              <h1 className="text-xl font-semibold text-foreground mb-2">
                Device Authorized
              </h1>
              <p className="text-sm text-muted">
                You can close this tab and return to your terminal.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Checking session
  if (isCheckingSession) {
    return (
      <div className="min-h-screen bg-background relative overflow-hidden">
        <div className="relative z-10 min-h-screen flex flex-col items-center justify-center p-4">
          <Logo />
          <div className="w-full max-w-sm">
            <div className="bg-surface border border-border border-dashed p-8 text-center">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-transparent mx-auto" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Not signed in - show sign-in options
  if (!user) {
    return (
      <div className="min-h-screen bg-background relative overflow-hidden">
        <div className="relative z-10 min-h-screen flex flex-col items-center justify-center p-4">
          <Logo />
          <div className="w-full max-w-sm">
            <div className="bg-surface border border-border border-dashed p-8">
              <h1 className="text-xl font-semibold text-foreground mb-2 text-center">
                Authorize Device
              </h1>
              <p className="text-sm text-muted mb-6 text-center">
                Sign in to authorize your CLI.
              </p>

              <Button
                type="button"
                variant="outline"
                onClick={handleGoogleSignIn}
                disabled={isLoading}
                className="w-full gap-3"
              >
                {isLoading ? (
                  <div className="h-5 w-5 animate-spin border-2 border-dashed border-primary border-t-transparent rounded-full" />
                ) : (
                  <GoogleIcon />
                )}
                {isLoading ? "Signing in..." : "Continue with Google"}
              </Button>

              {DEV_AUTH_ENABLED && (
                <>
                  <div className="relative my-6">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-dashed border-border" />
                    </div>
                    <div className="relative flex justify-center text-xs">
                      <span className="px-3 py-1 bg-primary/10 text-primary">
                        Dev Only
                      </span>
                    </div>
                  </div>

                  <Button
                    type="button"
                    onClick={handleDevSignIn}
                    disabled={isDevLoading}
                    className="w-full"
                  >
                    {isDevLoading ? (
                      <div className="h-5 w-5 animate-spin border-2 border-white border-t-transparent rounded-full" />
                    ) : (
                      <svg
                        className="size-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                        />
                      </svg>
                    )}
                    {isDevLoading ? "Signing in..." : "Dev Sign In"}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Signed in - show authorize button
  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center p-4">
        <Logo />
        <div className="w-full max-w-sm">
          <div className="bg-surface border border-border border-dashed p-8 text-center">
            <h1 className="text-xl font-semibold text-foreground mb-2">
              Authorize Device
            </h1>
            <p className="text-sm text-muted mb-8">
              Signed in as{" "}
              <span className="font-medium text-foreground">{user.email}</span>
            </p>
            <p className="text-xs text-muted mb-2">
              Confirm to authorize your CLI with code:
            </p>
            <code className="flex justify-center bg-background text-primary text-2xl font-mono font-medium tracking-wide px-3 py-2 mb-3">
              {userCode}
            </code>
            <Button
              type="button"
              onClick={handleAuthorize}
              disabled={isAuthorizing}
              className="w-full"
            >
              {isAuthorizing ? (
                <div className="h-5 w-5 animate-spin border-2 border-white border-t-transparent rounded-full" />
              ) : null}
              {isAuthorizing ? "Authorizing..." : "Authorize Device"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DevicePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background relative overflow-hidden">
          <div className="relative z-10 min-h-screen flex flex-col items-center justify-center p-4">
            <Logo />
            <div className="w-full max-w-sm">
              <div className="bg-surface border border-border border-dashed p-8 text-center">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-transparent mx-auto" />
              </div>
            </div>
          </div>
        </div>
      }
    >
      <DevicePageContent />
    </Suspense>
  );
}
