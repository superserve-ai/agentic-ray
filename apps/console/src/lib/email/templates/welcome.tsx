import { Button, Heading, Text } from "@react-email/components";
import { EmailLayout } from "./components/email-layout";

interface WelcomeEmailProps {
  name: string;
  dashboardUrl: string;
}

export const WelcomeEmail = ({ name, dashboardUrl }: WelcomeEmailProps) => (
  <EmailLayout preview={`Welcome to Superserve, ${name}!`}>
    <Heading style={heading}>Welcome to Superserve</Heading>
    <Text style={paragraph}>Hi {name},</Text>
    <Text style={paragraph}>
      Thanks for signing up! Your account is ready. You can start deploying AI
      agents right away from the dashboard.
    </Text>
    <Button style={button} href={dashboardUrl}>
      Go to Dashboard
    </Button>
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

export default WelcomeEmail;
