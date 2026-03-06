"use server";

import { z } from "zod";
import sendToSlackHook from "@/lib/slack/send-to-webhook";

const earlyAccessSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(254),
  company: z.string().max(200).optional().default(""),
  role: z.string().max(200).optional().default(""),
  useCase: z.string().max(2000).optional().default(""),
});

export const sendEarlyAccessToSlack = async (
  name: string,
  email: string,
  company: string,
  role: string,
  useCase: string,
) => {
  try {
    const input = earlyAccessSchema.safeParse({ name, email, company, role, useCase });
    if (!input.success) return;
    await sendToSlackHook({
      text: "New Early Access Request",
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "New Early Access Request",
            emoji: true,
          },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Name:* ${name}` },
            { type: "mrkdwn", text: `*Email:* ${email}` },
            { type: "mrkdwn", text: `*Company:* ${company || "N/A"}` },
            { type: "mrkdwn", text: `*Role:* ${role || "N/A"}` },
          ],
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Use Case:*\n${useCase || "N/A"}`,
          },
        },
        { type: "divider" },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Submitted on ${new Date().toLocaleString()}`,
            },
          ],
        },
      ],
    });
  } catch (error) {
    console.error("Error sending Slack message:", error);
  }
};
