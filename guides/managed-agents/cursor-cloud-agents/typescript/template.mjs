// The worker template: Ubuntu 24.04 with the Cursor CLI on PATH, git, and a
// /workspace directory. Shared by build-template.mjs and the e2e suite so the
// image under test is the image the guide ships.
import { Template } from "@superserve/sdk"

export const TEMPLATE_NAME =
  process.env.CURSOR_WORKER_TEMPLATE || "cursor-worker"

export const TEMPLATE_SPEC = {
  from: "ubuntu:24.04",
  vcpu: 2,
  memoryMib: 2048,
  diskMib: 8192,
  steps: [
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
  ],
}

// Template names are unique per team, so a rerun must pick up the existing
// template: reuse a ready one, wait on an in-flight build, rebuild a failed one.
// Returns the ready Template.
export async function ensureTemplate({
  name = TEMPLATE_NAME,
  onLog,
  log = console.log,
} = {}) {
  const existing = (await Template.list()).find((t) => t.name === name)
  let template
  if (existing) {
    template = await Template.connect(existing.id)
    if (existing.status === "ready") {
      log(`template '${name}' already exists and is ready (id: ${existing.id})`)
      return template
    }
    if (existing.status === "failed") {
      log(
        `template '${name}' has a failed build (id: ${existing.id}), rebuilding...`,
      )
      await template.rebuild()
      // Reconnect so waitUntilReady() tracks the new build, not the failed one.
      template = await Template.connect(existing.id)
    } else {
      log(
        `template '${name}' is ${existing.status} (id: ${existing.id}), waiting...`,
      )
    }
  } else {
    log(`creating template '${name}'...`)
    template = await Template.create({ name, ...TEMPLATE_SPEC })
    log(`template created (id: ${template.id}), waiting for build...`)
  }
  await template.waitUntilReady({ onLog })
  log(`template '${name}' is ready (id: ${template.id})`)
  return template
}
