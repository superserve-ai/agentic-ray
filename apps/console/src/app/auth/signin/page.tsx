"use client";

import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button, Input, useToast } from "@superserve/ui";
import { DEV_AUTH_ENABLED, devSignIn } from "@/lib/auth-helpers";
import { createClient } from "@/lib/supabase/client";

const authInputClass =
  "h-auto px-4 py-3.5 bg-surface text-foreground border-border focus:ring-0 focus:border-primary";

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

function Spinner() {
  return (
    <div className="h-5 w-5 animate-spin border-2 border-white border-t-transparent rounded-full" />
  );
}

function SignInContent() {
  const [isLoading, setIsLoading] = useState(false);
  const [isEmailLoading, setIsEmailLoading] = useState(false);
  const [isDevLoading, setIsDevLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const { addToast } = useToast();

  const rawNext = searchParams.get("next") || "/";
  // Only allow relative paths to prevent open redirect
  const nextUrl = rawNext.startsWith("/") ? rawNext : "/";

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
  }, [router, supabase.auth, nextUrl]);

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      addToast("Please enter your email and password.", "error");
      return;
    }
    setIsEmailLoading(true);
    try {
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
          addToast(error.message, "error");
        }
        return;
      }
      if (nextUrl && nextUrl.startsWith("http")) {
        window.location.href = nextUrl;
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
                className={authInputClass}
              />
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={authInputClass}
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
                <div className="h-5 w-5 animate-spin border-2 border-dashed border-primary border-t-transparent rounded-full" />
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
