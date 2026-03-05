import { Button, Heading, Text } from "@react-email/components";
import { EmailLayout } from "./components/email-layout";

interface ConfirmationEmailProps {
  confirmationUrl: string;
}

export const ConfirmationEmail = ({
  confirmationUrl,
}: ConfirmationEmailProps) => (
  <EmailLayout preview="Confirm your Superserve account">
    <Heading style={heading}>Confirm your account</Heading>
    <Text style={paragraph}>
      We are excited for you to try Superserve! Verify your email below to get
      started.
    </Text>
    <Button style={button} href={confirmationUrl}>
      Confirm Email Address
    </Button>
    <Text style={disclaimer}>
      You can ignore this email if you did not create a Superserve account
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

export default ConfirmationEmail;
