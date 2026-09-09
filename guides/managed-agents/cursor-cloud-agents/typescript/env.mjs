import { fileURLToPath } from "node:url"

import dotenv from "dotenv"

// Load .env next to the scripts, not from the controller's cwd, so the spawn
// hook works no matter where `agent worker controller` is started from.
// Variables already set by the controller (CURSOR_POOL, CURSOR_AGENT_WORKER_ID, ...)
// take precedence: dotenv never overrides existing values.
dotenv.config({
  path: fileURLToPath(new URL(".env", import.meta.url)),
  quiet: true,
})
