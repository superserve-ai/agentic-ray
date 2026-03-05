"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { Button, Input, useToast } from "@superserve/ui";
import { Spinner } from "@/components/icons";
import { sendPasswordResetEmail } from "./action";

const AUTH_INPUT_CLASS =
  "h-auto px-4 py-3.5 bg-surface text-foreground border-border focus:ring-0 focus:border-primary";

function ForgotPasswordContent() {
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const { addToast } = useToast();

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      addToast("Please enter your email address.", "error");
      return;
    }
    setIsLoading(true);
    try {
      await sendPasswordResetEmail(email);
      setEmailSent(true);
    } catch (err) {
      console.error("Reset password error:", err);
      addToast("Error sending reset email. Please try again.", "error");
    } finally {
      setIsLoading(false);
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
                  We&apos;ve sent a password reset link to{" "}
                  <strong className="text-foreground">{email}</strong>. Please
                  check your inbox and click the link to reset your password.
                </p>
                <p className="text-sm text-center text-muted">
                  <Link
                    href="/auth/signin"
                    className="hover:underline transition-colors font-medium text-primary"
                  >
                    Back to sign in
                  </Link>
                </p>
              </>
            ) : (
              <>
                <h1 className="font-display text-2xl font-semibold tracking-tight text-center mb-2 text-foreground">
                  Forgot Password
                </h1>
                <p className="text-center mb-8 text-sm text-muted">
                  Enter your email and we&apos;ll send you a reset link
                </p>

                <form onSubmit={handleResetPassword} className="space-y-4">
                  <Input
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={AUTH_INPUT_CLASS}
                  />
                  <Button
                    type="submit"
                    disabled={isLoading}
                    className="w-full h-auto py-3.5 bg-primary text-white hover:bg-primary-hover duration-300"
                  >
                    {isLoading ? <Spinner /> : null}
                    {isLoading ? "Sending..." : "Send Reset Link"}
                  </Button>
                </form>

                <p className="text-sm text-center mt-6 text-muted">
                  <Link
                    href="/auth/signin"
                    className="hover:underline transition-colors font-medium text-primary"
                  >
                    Back to sign in
                  </Link>
                </p>
              </>
            )}
        </div>
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <ForgotPasswordContent />
    </Suspense>
  );
}
