"use server";

import { z } from "zod";
import { sendEmail } from "@/lib/email/send";
import { PasswordResetEmail } from "@/lib/email/templates/password-reset";
import { createAdminClient } from "@/lib/supabase/admin";

const resetSchema = z.object({
  email: z.string().email(),
});

export const sendPasswordResetEmail = async (email: string) => {
  const parsed = resetSchema.safeParse({ email });
  if (!parsed.success) {
    return { success: true }; // Always return success to prevent email enumeration
  }

  try {
    const supabase = createAdminClient();

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://console.superserve.ai";
    const redirectTo = `${appUrl}/auth/callback?next=/auth/reset-password`;

    const { data, error } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email: parsed.data.email,
      options: { redirectTo },
    });

    if (error || !data?.properties?.hashed_token) {
      console.error("Error generating reset link:", error?.message);
      return { success: true }; // Always return success to prevent email enumeration
    }

    const resetUrlObj = new URL(redirectTo);
    resetUrlObj.searchParams.set("token_hash", data.properties.hashed_token);
    resetUrlObj.searchParams.set("type", "recovery");

    await sendEmail({
      to: parsed.data.email,
      subject: "Reset your Superserve password",
      react: PasswordResetEmail({ email: parsed.data.email, resetUrl: resetUrlObj.toString() }),
    });

    return { success: true };
  } catch (error) {
    console.error("Error sending password reset email:", error);
    return { success: true }; // Always return success to prevent email enumeration
  }
};
