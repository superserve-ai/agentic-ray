import {
  Body,
  Container,
  Font,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

interface EmailLayoutProps {
  preview: string;
  children: React.ReactNode;
}

export const EmailLayout = ({ preview, children }: EmailLayoutProps) => (
  <Html>
    <Head>
      <Font
        fontFamily="Inter"
        fallbackFontFamily="Helvetica"
        webFont={{
          url: "https://fonts.gstatic.com/s/inter/v18/UcCo3FwrK3iLTcviYwY.woff2",
          format: "woff2",
        }}
        fontWeight={400}
        fontStyle="normal"
      />
    </Head>
    <Preview>{preview}</Preview>
    <Body style={body}>
      <Container style={container}>
        <Section style={header}>
          <Img
            src="https://superserve.ai/assets/logo.png"
            width="173"
            height="32"
            alt="Superserve"
          />
        </Section>
        <Section style={card}>{children}</Section>
        <Section style={footer}>
          <Text style={footerText}>Superserve</Text>
          <Text style={footerSubtext}>
            455 Market St Ste 1940 PMB 924076, San Francisco, California
            94105-2448 US.
          </Text>
          <Text style={footerSubtext}>
            If you have any questions, we're happy to help. Contact{" "}
            <Link href="mailto:support@superserve.ai" style={footerSubtextLink}>support@superserve.ai</Link>
          </Text>
        </Section>
      </Container>
    </Body>
  </Html>
);

const body = {
  backgroundColor: "#faf8f5",
  fontFamily: "Inter, Helvetica, Arial, sans-serif",
  margin: "0",
  padding: "0",
};

const container = { maxWidth: "520px", margin: "0 auto", padding: "40px 20px" };
const header = { textAlign: "center" as const, padding: "0 0 32px 0" };
const card = {
  backgroundColor: "#fffefb",
  border: "1px dashed #e8e4df",
  padding: "40px 32px",
};
const footer = { padding: "32px 0 0 0", textAlign: "center" as const };
const footerText = {
  color: "#8a8a8a",
  fontSize: "13px",
  lineHeight: "20px",
  margin: "0 0 8px 0",
};
const footerSubtext = {
  color: "#b0b0b0",
  fontSize: "11px",
  lineHeight: "18px",
  margin: "0",
};
const footerSubtextLink = {
  color: "#105C60",
  fontSize: "11px",
  lineHeight: "18px",
  margin: "0",
};
