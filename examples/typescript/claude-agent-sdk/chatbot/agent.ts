/**
 * Minimal chatbot built with Claude Agent SDK deployed on Superserve.
 */

import { query } from "@anthropic-ai/claude-agent-sdk"
import { createInterface } from "readline"

const rl = createInterface({ input: process.stdin })
rl.on("line", async (line) => {
  for await (const message of query({
    prompt: line,
    options: {
      model: "claude-sonnet-4-5",
      systemPrompt: "You are a helpful assistant.",
      continue: true,
    },
  })) {
    if ("result" in message) {
      console.log(message.result)
    }
  }
})
