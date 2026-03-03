/**
 * Minimal chatbot built with Mastra deployed on Superserve.
 */

import { Agent } from "@mastra/core/agent"
import { createInterface } from "readline"

const agent = new Agent({
  name: "assistant",
  instructions: "You are a helpful assistant.",
  model: "openai/gpt-4o",
})

const rl = createInterface({ input: process.stdin })
rl.on("line", async (line) => {
  const result = await agent.generate(line)
  console.log(result.text)
})
