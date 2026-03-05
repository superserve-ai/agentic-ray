import { Button, Heading, Text } from "@react-email/components";
import { EmailLayout } from "./components/email-layout";

interface PasswordResetEmailProps {
  email: string;
  resetUrl: string;
}

export const PasswordResetEmail = ({
  email,
  resetUrl,
}: PasswordResetEmailProps) => (
  <EmailLayout preview="Reset your Superserve password">
    <Heading style={heading}>Reset Your Password</Heading>
    <Text style={paragraph}>
      We received a request to reset the password for the account associated
      with <strong>{email}</strong>.
    </Text>
    <Text style={paragraph}>
      Click the button below to set a new password. This link will expire in 1
      hour.
    </Text>
    <Button style={button} href={resetUrl}>
      Reset Password
    </Button>
    <Text style={disclaimer}>
      If you didn&apos;t request a password reset, you can safely ignore this
      email. Your password will remain unchanged.
    </Text>
  </EmailLayout>
);

const heading = {
  fontFamily: "Inter, Helvetica, Arial, sans-serif",
  color: "#3d3d3d",
  fontSize: "22px",
  fontWeight: "600" as const,
  letterSpacing: "-0.02em",
  textAlign: "center" as const,
  margin: "0 0 24px 0",
};

const paragraph = {
  color: "#5c5c5c",
  fontSize: "14px",
  lineHeight: "24px",
  margin: "0 0 16px 0",
};

const button = {
  backgroundColor: "#105C60",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: "500" as const,
  textDecoration: "none",
  textAlign: "center" as const,
  display: "block",
  padding: "14px 24px",
  margin: "24px 0 0 0",
};

const disclaimer = {
  color: "#8a8a8a",
  fontSize: "12px",
  lineHeight: "20px",
  margin: "24px 0 0 0",
};

export default PasswordResetEmail;
