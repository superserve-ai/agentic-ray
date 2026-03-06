/**
 * Minimal chatbot built with OpenAI Agents SDK deployed on Superserve.
 */

import { Agent, run } from "@openai/agents"
import { createInterface } from "readline"

const agent = new Agent({
  name: "assistant",
  instructions: "You are a helpful assistant.",
})

const rl = createInterface({ input: process.stdin })
rl.on("line", async (line) => {
  const result = await run(agent, line)
  console.log(result.finalOutput)
})
