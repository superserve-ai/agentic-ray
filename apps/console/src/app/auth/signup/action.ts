"use server";

import { sendEmail } from "@/lib/email/send";
import { ConfirmationEmail } from "@/lib/email/templates/confirmation";
import { WelcomeEmail } from "@/lib/email/templates/welcome";
import { notifySlackOfNewUser } from "@/app/auth/signin/action";
import { createAdminClient } from "@/lib/supabase/admin";

export const signUpWithEmail = async (
  email: string,
  password: string,
  fullName: string,
) => {
  try {
    const supabase = createAdminClient();

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://console.superserve.ai";
    const redirectTo = `${appUrl}/auth/callback`;

    const { data, error } = await supabase.auth.admin.generateLink({
      type: "signup",
      email,
      password,
      options: {
        data: { full_name: fullName },
        redirectTo,
      },
    });

    if (error) {
      if (error.message.includes("already registered")) {
        return {
          success: false,
          error: "An account with this email already exists.",
        };
      }
      return { success: false, error: error.message };
    }

    const tokenHash = data?.properties?.hashed_token;
    if (!tokenHash) {
      return { success: false, error: "Failed to generate confirmation link." };
    }

    const confirmationUrl = `${redirectTo}?token_hash=${tokenHash}&type=signup`;

    await sendEmail({
      to: email,
      subject: "Confirm your Superserve account",
      react: ConfirmationEmail({ confirmationUrl }),
    });

    notifySlackOfNewUser(email, fullName, "email").catch(() => {});

    return { success: true };
  } catch (err) {
    console.error("Signup error:", err);
    return {
      success: false,
      error: "Error creating account. Please try again.",
    };
  }
};

export const sendWelcomeEmail = async (email: string, name: string) => {
  try {
    const dashboardUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://console.superserve.ai";

    await sendEmail({
      to: email,
      subject: "Welcome to Superserve!",
      react: WelcomeEmail({ name: name || "there", dashboardUrl }),
    });
  } catch (error) {
    console.error("Error sending welcome email:", error);
  }
};

