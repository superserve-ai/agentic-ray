#!/usr/bin/env node
import "./env.mjs"
import { Template } from "@superserve/sdk"

const TEMPLATE_NAME = process.env.CURSOR_WORKER_TEMPLATE || "cursor-worker"

const STEPS = [
  {
    run:
      "apt-get update && apt-get install -y --no-install-recommends " +
      "ca-certificates curl git jq procps unzip && rm -rf /var/lib/apt/lists/*",
  },
  // Installs to /root/.local/bin/agent; the symlink puts it on every PATH.
  { run: "curl -fsS https://cursor.com/install | HOME=/root bash" },
  {
    run: "ln -sf /root/.local/bin/agent /usr/local/bin/agent && agent --version",
  },
  { run: "mkdir -p /workspace /var/lib/cursor-worker" },
  { workdir: "/workspace" },
]

const onLog = (ev) => {
  if (ev.stream !== "system") process.stdout.write(ev.text)
}

// Template names are unique per team, so a rerun must pick up the existing
// template: reuse a ready one, wait on an in-flight build, rebuild a failed one.
const existing = (await Template.list()).find((t) => t.name === TEMPLATE_NAME)
let template
if (existing) {
  template = await Template.connect(existing.id)
  if (existing.status === "ready") {
    console.log(
      `template '${TEMPLATE_NAME}' already exists and is ready (id: ${existing.id})`,
    )
    process.exit(0)
  }
  if (existing.status === "failed") {
    console.log(
      `template '${TEMPLATE_NAME}' has a failed build (id: ${existing.id}), rebuilding...`,
    )
    await template.rebuild()
    // Reconnect so waitUntilReady() tracks the new build, not the failed one.
    template = await Template.connect(existing.id)
  } else {
    console.log(
      `template '${TEMPLATE_NAME}' is ${existing.status} (id: ${existing.id}), waiting...`,
    )
  }
} else {
  console.log(`creating template '${TEMPLATE_NAME}'...`)
  template = await Template.create({
    name: TEMPLATE_NAME,
    from: "ubuntu:24.04",
    vcpu: 2,
    memoryMib: 2048,
    diskMib: 8192,
    steps: STEPS,
  })
  console.log(`template created (id: ${template.id}), waiting for build...`)
}

await template.waitUntilReady({ onLog })

console.log(`\ntemplate '${TEMPLATE_NAME}' is ready (id: ${template.id})`)
