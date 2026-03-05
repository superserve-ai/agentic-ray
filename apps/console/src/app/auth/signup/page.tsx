"use client";

import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button, Input, useToast } from "@superserve/ui";
import { GoogleIcon, Spinner } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";

const AUTH_INPUT_CLASS =
  "h-auto px-4 py-3.5 bg-surface text-foreground border-border focus:ring-0 focus:border-primary";
import { signUpWithEmail } from "./action";

function SignUpContent() {
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const { addToast } = useToast();
  const searchParams = useSearchParams();
  const rawNext = searchParams.get("next") || "/";
  // Only allow relative paths to prevent open redirect
  const nextUrl = rawNext.startsWith("/") ? rawNext : "/";

  useEffect(() => {
    if (searchParams.get("error") === "link_expired") {
      addToast("Verification link expired or invalid", "error");
    }
  }, [searchParams, addToast]);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !fullName) {
      addToast("Please fill in all fields.", "error");
      return;
    }
    if (password.length < 8) {
      addToast("Password must be at least 8 characters.", "error");
      return;
    }
    if (password !== confirmPassword) {
      addToast("Passwords do not match.", "error");
      return;
    }
    setIsLoading(true);
    try {
      const result = await signUpWithEmail(email, password, fullName);
      if (!result.success) {
        addToast(result.error || "Error creating account.", "error");
        return;
      }
      setEmailSent(true);
    } catch (err) {
      console.error("Sign up error:", err);
      addToast("Error creating account. Please try again.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true);
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
      setIsGoogleLoading(false);
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
            {emailSent ? (
              <>
                <h1 className="font-display text-2xl font-semibold tracking-tight text-center mb-2 text-foreground">
                  Check Your Email
                </h1>
                <p className="text-center mb-6 text-sm leading-relaxed text-muted">
                  We&apos;ve sent a verification link to{" "}
                  <strong className="text-foreground">{email}</strong>. Please
                  check your inbox and click the link to verify your account.
                </p>
                <p className="text-sm text-center text-muted">
                  Already verified?{" "}
                  <Link
                    href="/auth/signin"
                    className="hover:underline transition-colors font-medium text-primary"
                  >
                    Sign in
                  </Link>
                </p>
              </>
            ) : (
              <>
                <h1 className="font-display text-2xl font-semibold tracking-tight text-center mb-2 text-foreground">
                  Create Account
                </h1>
                <p className="text-center mb-8 text-sm text-muted">
                  Sign up to get started with Superserve
                </p>

                <form onSubmit={handleSignUp} className="space-y-4 mb-6">
                  <Input
                    type="text"
                    placeholder="Full Name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className={AUTH_INPUT_CLASS}
                  />
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
                        {showPassword ? (
                          <EyeOff size={18} />
                        ) : (
                          <Eye size={18} />
                        )}
                      </button>
                    }
                  />
                  <Input
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder="Confirm Password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={AUTH_INPUT_CLASS}
                    suffix={
                      <button
                        type="button"
                        onClick={() =>
                          setShowConfirmPassword(!showConfirmPassword)
                        }
                        className="p-0.5 transition-colors text-muted"
                      >
                        {showConfirmPassword ? (
                          <EyeOff size={18} />
                        ) : (
                          <Eye size={18} />
                        )}
                      </button>
                    }
                  />
                  <Button
                    type="submit"
                    disabled={isLoading}
                    className="w-full h-auto py-3.5 bg-primary text-white hover:bg-primary-hover duration-300"
                  >
                    {isLoading ? <Spinner /> : null}
                    {isLoading ? "Creating account..." : "Sign Up"}
                  </Button>
                </form>

                <div className="relative mb-6">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-dashed border-border" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="px-3 bg-surface text-muted">or</span>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  onClick={handleGoogleSignIn}
                  disabled={isGoogleLoading}
                  className="w-full h-auto gap-3 py-3.5 font-sans normal-case tracking-normal bg-surface text-foreground border-solid border-border hover:bg-surface-hover hover:text-foreground duration-300"
                >
                  {isGoogleLoading ? (
                    <Spinner className="border-dashed border-primary" />
                  ) : (
                    <GoogleIcon />
                  )}
                  {isGoogleLoading ? "Signing up..." : "Continue with Google"}
                </Button>

                <p className="text-sm text-center mt-6 text-muted">
                  Already have an account?{" "}
                  <Link
                    href="/auth/signin"
                    className="hover:underline transition-colors font-medium text-primary"
                  >
                    Sign in
                  </Link>
                </p>

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
              </>
            )}
        </div>
      </div>
    </div>
  );
}

export default function SignUpPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <SignUpContent />
    </Suspense>
  );
}
