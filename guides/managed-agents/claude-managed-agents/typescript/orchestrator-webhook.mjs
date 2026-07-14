import "dotenv/config"
import Anthropic from "@anthropic-ai/sdk"
import { createServer } from "node:http"
import { handleWork } from "./orchestrator.mjs"

const ENVIRONMENT_KEY = process.env.ANTHROPIC_ENVIRONMENT_KEY
const ENVIRONMENT_ID = process.env.ANTHROPIC_ENVIRONMENT_ID
const WEBHOOK_SECRET = process.env.ANTHROPIC_WEBHOOK_SECRET
const PORT = parseInt(process.env.PORT || "5051")

if (!WEBHOOK_SECRET) {
  console.error("ANTHROPIC_WEBHOOK_SECRET is not set")
  process.exit(1)
}

const client = new Anthropic({ authToken: ENVIRONMENT_KEY })
let draining = false

async function drainWork() {
  if (draining) return
  draining = true
  try {
    for await (const work of client.beta.environments.work.poller({
      environmentId: ENVIRONMENT_ID,
      environmentKey: ENVIRONMENT_KEY,
      blockMs: null,
      reclaimOlderThanMs: 2000,
      drain: true,
      autoStop: false,
    })) {
      try {
        await handleWork(work)
      } catch (e) {
        console.error(`failed work=${work.id}: ${e.message}`)
      }
    }
  } finally {
    draining = false
  }
}

function fallbackDrainLoop() {
  setInterval(() => {
    drainWork().catch((e) => console.warn(`fallback drain error: ${e.message}`))
  }, 30_000)
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ ok: true, environment_id: ENVIRONMENT_ID }))
    return
  }

  if (req.method !== "POST") {
    res.writeHead(405)
    res.end()
    return
  }

  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = Buffer.concat(chunks).toString()

  let event
  try {
    event = client.beta.webhooks.unwrap(body, {
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
      ),
      key: WEBHOOK_SECRET,
    })
  } catch {
    res.writeHead(401, { "content-type": "application/json" })
    res.end(JSON.stringify({ error: "signature verification failed" }))
    return
  }

  if (event.data.type !== "session.status_run_started") {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ status: "ignored" }))
    return
  }

  drainWork().catch((e) => console.error("drain error:", e.message))

  res.writeHead(200, { "content-type": "application/json" })
  res.end(JSON.stringify({ status: "queued" }))
})

fallbackDrainLoop()

server.listen(PORT, () => {
  console.log(`webhook orchestrator listening on :${PORT} env=${ENVIRONMENT_ID}`)
})
