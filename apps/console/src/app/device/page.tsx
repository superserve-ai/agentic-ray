"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { Suspense, useEffect, useState } from "react";
import { Button, useToast } from "@superserve/ui";
import { GoogleIcon, Spinner } from "@/components/icons";
import { DEV_AUTH_ENABLED, devSignIn } from "@/lib/auth-helpers";
import { createBrowserClient } from "@superserve/supabase";

function Logo() {
  return (
    <div className="mb-8">
      <Link href="/" className="flex items-center gap-2">
        <img src="/logo.svg" alt="Superserve" className="h-10 mb-2" />
      </Link>
    </div>
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
  const posthog = usePostHog();
  const userCode = searchParams.get("code");

  useEffect(() => {
    const checkUser = async () => {
      const supabase = createBrowserClient();
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
  }, [posthog]);

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    try {
      const supabase = createBrowserClient();
      const callbackUrl = new URL("/auth/callback", window.location.origin);
      callbackUrl.searchParams.set("next", `/device?code=${encodeURIComponent(userCode ?? "")}`);

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

      const supabase = createBrowserClient();
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
      const supabase = createBrowserClient();
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
              <Spinner className="border-muted mx-auto" />
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
                  <Spinner className="border-dashed border-primary" />
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
                      <Spinner />
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
              {isAuthorizing ? <Spinner /> : null}
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
                <Spinner className="border-muted mx-auto" />
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
