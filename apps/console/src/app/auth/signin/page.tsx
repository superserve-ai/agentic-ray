"use client";

import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button, Input, useToast } from "@superserve/ui";
import { GoogleIcon, Spinner } from "@/components/icons";
import { DEV_AUTH_ENABLED, devSignIn } from "@/lib/auth-helpers";
import { createClient } from "@/lib/supabase/client";

const AUTH_INPUT_CLASS =
  "h-auto px-4 py-3.5 bg-surface text-foreground border-border focus:ring-0 focus:border-primary";

function SignInContent() {
  const [isLoading, setIsLoading] = useState(false);
  const [isEmailLoading, setIsEmailLoading] = useState(false);
  const [isDevLoading, setIsDevLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addToast } = useToast();

  const rawNext = searchParams.get("next") || "/";
  // Only allow relative paths to prevent open redirect
  const nextUrl = rawNext.startsWith("/") ? rawNext : "/";

  useEffect(() => {
    const checkUser = async () => {
      const supabase = createClient();
      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();
        if (error) {
          await supabase.auth.signOut();
          return;
        }
        if (session) {
          const {
            data: { user },
            error: userError,
          } = await supabase.auth.getUser();
          if (userError || !user) {
            await supabase.auth.signOut();
            return;
          }
          router.push(nextUrl && nextUrl !== "/" ? nextUrl : "/");
        }
      } catch (_error) {
        await supabase.auth.signOut();
      }
    };
    checkUser();
  }, [router, nextUrl]);

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      addToast("Please enter your email and password.", "error");
      return;
    }
    setIsEmailLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        if (error.message.includes("Invalid login credentials")) {
          addToast("Invalid email or password.", "error");
        } else if (error.message.includes("Email not confirmed")) {
          addToast("Please verify your email before signing in.", "error");
        } else {
          addToast("Error signing in. Please try again.", "error");
        }
        return;
      }
      router.push(nextUrl && nextUrl !== "/" ? nextUrl : "/");
    } catch (err) {
      console.error("Email sign in error:", err);
      addToast("Error signing in. Please try again.", "error");
    } finally {
      setIsEmailLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    try {
      const supabase = createClient();
      const callbackUrl = new URL("/auth/callback", window.location.origin);
      if (nextUrl && nextUrl !== "/") {
        callbackUrl.searchParams.set("next", nextUrl);
      }
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callbackUrl.toString() },
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
      router.push(nextUrl && nextUrl !== "/" ? nextUrl : "/");
    } catch (err) {
      console.error("Dev auth error:", err);
      addToast("Dev auth failed. Check console.", "error");
    } finally {
      setIsDevLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6">
      <div className="mb-8">
        <Link href="/">
          <img src="/logo.svg" alt="Superserve" className="h-10 w-auto" />
        </Link>
      </div>

      <div className="w-full max-w-sm">
        <div className="p-8 border border-dashed border-border bg-surface">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-center mb-2 text-foreground">
              Welcome Back
            </h1>
            <p className="text-center mb-8 text-sm text-muted">
              Sign in to continue to Superserve
            </p>

            {/* Email/Password Form */}
            <form onSubmit={handleEmailSignIn} className="space-y-4 mb-6">
              <Input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={AUTH_INPUT_CLASS}
              />
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={AUTH_INPUT_CLASS}
                suffix={
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="p-0.5 transition-colors text-muted"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                }
              />
              <div className="flex justify-end">
                <Link
                  href="/auth/forgot-password"
                  className="text-xs hover:underline transition-colors text-primary"
                >
                  Forgot password?
                </Link>
              </div>
              <Button
                type="submit"
                disabled={isEmailLoading}
                className="w-full h-auto py-3.5 bg-primary text-white hover:bg-primary-hover duration-300"
              >
                {isEmailLoading ? <Spinner /> : null}
                {isEmailLoading ? "Signing in..." : "Sign In"}
              </Button>
            </form>

            {/* Divider */}
            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-dashed border-border" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="px-3 bg-surface text-muted">or</span>
              </div>
            </div>

            {/* Google OAuth */}
            <Button
              type="button"
              variant="outline"
              onClick={handleGoogleSignIn}
              disabled={isLoading}
              className="w-full h-auto gap-3 py-3.5 font-sans normal-case tracking-normal bg-surface text-foreground border-solid border-border hover:bg-surface-hover hover:text-foreground duration-300"
            >
              {isLoading ? (
                <Spinner className="border-dashed border-primary" />
              ) : (
                <GoogleIcon />
              )}
              {isLoading ? "Signing in..." : "Continue with Google"}
            </Button>

            {/* Dev Auth */}
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
                  className="w-full h-auto py-3.5 bg-primary text-white hover:bg-primary-hover duration-300"
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

            {/* Sign up link */}
            <p className="text-sm text-center mt-6 text-muted">
              Don&apos;t have an account?{" "}
              <Link
                href="/auth/signup"
                className="hover:underline transition-colors font-medium text-primary"
              >
                Sign up
              </Link>
            </p>

            {/* Privacy policy */}
            <p className="text-xs text-center mt-6 leading-relaxed text-muted">
              By continuing, you agree to our{" "}
              <a
                href={`${process.env.NEXT_PUBLIC_WEBSITE_URL}/privacy`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-2 hover:underline transition-colors text-foreground"
              >
                Privacy Policy
              </a>
            </p>
        </div>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <SignInContent />
    </Suspense>
  );
}
