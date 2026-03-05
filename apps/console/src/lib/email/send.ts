import { resend } from "./resend";

interface SendEmailOptions {
  to: string;
  subject: string;
  react: React.ReactElement;
}

export const sendEmail = async ({ to, subject, react }: SendEmailOptions) => {
  const from = process.env.RESEND_FROM_ADDRESS;

  if (!resend) {
    console.warn("Resend not configured — skipping email send");
    return { success: false };
  }

  if (!from) {
    console.error("RESEND_FROM_ADDRESS is not configured");
    return { success: false };
  }

  try {
    const { error } = await resend.emails.send({ from, to, subject, react });

    if (error) {
      console.error("Failed to send email:", error);
      return { success: false };
    }

    return { success: true };
  } catch (err) {
    console.error("Error sending email:", err);
    return { success: false };
  }
};
