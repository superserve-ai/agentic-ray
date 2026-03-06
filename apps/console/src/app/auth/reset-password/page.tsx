"use client";

import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { Button, Input, useToast } from "@superserve/ui";
import { Spinner } from "@/components/icons";
import { createBrowserClient } from "@superserve/supabase";

const AUTH_INPUT_CLASS =
  "h-auto px-4 py-3.5 bg-surface text-foreground border-border focus:ring-0 focus:border-primary";

function ResetPasswordContent() {
  const [isLoading, setIsLoading] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const router = useRouter();
  const { addToast } = useToast();

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      addToast("Please enter a new password.", "error");
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
      const supabase = createBrowserClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        console.error("Reset password error:", error.message);
        addToast("Failed to update password. Please try again.", "error");
        return;
      }
      addToast("Password updated successfully.", "success");
      router.push("/auth/signin");
    } catch (err) {
      console.error("Reset password error:", err);
      addToast("Error resetting password. Please try again.", "error");
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
            <h1 className="font-display text-2xl font-semibold tracking-tight text-center mb-2 text-foreground">
              Reset Password
            </h1>
            <p className="text-center mb-8 text-sm text-muted">
              Enter your new password
            </p>

            <form onSubmit={handleResetPassword} className="space-y-4">
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="New Password"
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
                placeholder="Confirm New Password"
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
                {isLoading ? "Updating..." : "Update Password"}
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
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
