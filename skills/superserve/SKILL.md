---
name: superserve
description: Run AI agents and code in persistent, isolated Firecracker microVM sandboxes with the Superserve TypeScript SDK (@superserve/sdk) or Python SDK (superserve). Use when a task needs a runtime for an agent (run Claude Code or an agent loop inside a sandbox, or give a hosted agent a sandboxed shell or file tool), a persistent execution or dev environment that survives across sessions (pause/resume, reconnect by id), secrets or network-egress control for agent code, public preview URLs for a port or server running in the box, custom environment templates, or running untrusted or ephemeral LLM-generated code in isolation.
---

# Superserve

## Overview

Superserve runs **AI agents and code in persistent, isolated cloud sandboxes** backed by
Firecracker microVMs. A sandbox is a long-lived box you create once and reconnect to — run
commands, read/write files, and **pause/resume with full VM state preserved** — from
TypeScript or Python.

Two flagship uses:

- **Agent runtime** — run an AI agent _inside_ the box (e.g. boot `superserve/claude-code`
  and run `claude`), or give an agent _hosted elsewhere_ a sandboxed shell / file tool.
- **Persistent execution / dev environment** — a box that survives across processes and
  sessions; pause it to stop compute billing, and it auto-resumes on the next exec or connect.

It also runs plain ephemeral or untrusted code in isolation. Two planes exist but the SDK
hides both: the **control plane** (`api.superserve.ai`, API key) and the per-sandbox **data
plane** (rotating access token) — you never build data-plane URLs or manage tokens.

## When this skill wins

- **Agent runtime** — run an AI coding agent (Claude Code, OpenClaw, a custom loop) _inside_ a sandbox
- **Sandboxed tool for a hosted agent** — back a Claude Agent SDK / OpenAI Agents SDK `bash` or file tool with the box
- **Persistent execution / dev environment** — create once, reconnect by id across sessions, pause/resume with full state
- A remote shell / command runner with file I/O and controlled network egress
- Running untrusted or ephemeral LLM-generated code in isolation

## Hand off elsewhere

- Long-running production web services → use a web app hosting provider
- GPU clusters / heavy model training → not a sandbox use case
- Plain LLM calls with no code execution → no sandbox needed

## Before you start

1. **Install the SDK**
   - TypeScript: `npm install @superserve/sdk` (Node ≥ 18; bun/pnpm/yarn also work)
   - Python: `pip install superserve` (Python ≥ 3.9; uv/poetry also work)
2. **Set `SUPERSERVE_API_KEY`** (key prefix `ss_live_`) in the environment — get it
   from the Superserve console. With it set, `create()` needs no other config.
3. _(Optional)_ Override the API base with `SUPERSERVE_BASE_URL` (default `https://api.superserve.ai`).

## Quickstart

Create a sandbox, run a command, read its output, write/read a file, then delete it.

```ts
import { Sandbox } from "@superserve/sdk"
// Reads SUPERSERVE_API_KEY from the environment.

const sandbox = await Sandbox.create({ name: "demo" }) // ready when create() resolves
try {
  const { stdout, exitCode } = await sandbox.commands.run("echo hello")
  console.log(stdout, exitCode) // "hello\n", 0

  await sandbox.files.write("/app/data.txt", "content")
  const text = await sandbox.files.readText("/app/data.txt")
  console.log(text) // "content"
} finally {
  await sandbox.kill() // no `await using`; always clean up explicitly
}
```

```python
from superserve import Sandbox  # reads SUPERSERVE_API_KEY from the environment

sandbox = Sandbox.create(name="demo")  # ready when create() returns
try:
    result = sandbox.commands.run("echo hello")
    print(result.stdout, result.exit_code)  # "hello\n", 0

    sandbox.files.write("/app/data.txt", "content")
    text = sandbox.files.read_text("/app/data.txt")
    print(text)  # "content"
finally:
    sandbox.kill()  # no context manager; always clean up explicitly
```

For async Python, use `AsyncSandbox` and `await` every call.

## Run an agent in a sandbox

The primary use case, in two shapes.

**A — Agent runs _inside_ the box.** Boot a template with the agent preinstalled and pass its
model key as a secret; its shell commands and edits stay isolated, and `pause()` / `resume()`
checkpoint and restore the whole session.

```ts
const sandbox = await Sandbox.create({
  name: "claude-code",
  fromTemplate: "superserve/claude-code", // also: superserve/openclaw, superserve/hermes
  secrets: { ANTHROPIC_API_KEY: "anthropic-prod" }, // bound secret: real key injected at egress, never in the box
})
const session = await sandbox.commands.spawn("claude") // run the preinstalled CLI interactively
// … later: await sandbox.pause() → resume() restores the session exactly where it left off
```

```python
sandbox = Sandbox.create(
    name="claude-code",
    from_template="superserve/claude-code",
    secrets={"ANTHROPIC_API_KEY": "anthropic-prod"},
)
```

**B — Agent _hosted elsewhere_ calls into the box.** Expose `sandbox.commands.run` as a single
`bash` tool, so every command the model emits runs in the VM, not on your machine (Claude
Agent SDK shown; OpenAI Agents SDK is analogous):

```ts
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"
// assumes an active Sandbox instance `sandbox`
const bash = tool(
  "bash",
  "Run a shell command in the sandbox.",
  { command: z.string() },
  async ({ command }) => {
    const r = await sandbox.commands.run(command, { timeoutMs: 60_000 })
    return { content: [{ type: "text", text: `${r.stdout}\n${r.stderr}` }] }
  },
)
const superserve = createSdkMcpServer({
  name: "superserve",
  version: "1.0.0",
  tools: [bash],
})
// query(..., { mcpServers: { superserve }, allowedTools: ["mcp__superserve__bash"] })
```

Deliver model keys as bound **secrets** (`secrets: { ENV: "name" }`) so the real value is
injected at egress and never lives in the box (see Secrets); use plain `envVars` only for
non-sensitive config. Constrain what the agent can reach with **network egress rules** (see
Networking). Per-framework guides are linked under More integrations.

## Lifecycle

States: **active ↔ paused → deleted**. Two are long-lived; two are transient signals:

- `active` — running, compute billed. `paused` — state on disk, **no compute billed**.
- `resuming` — transient; a paused sandbox is being restored, retry shortly.
- `failed` — couldn't boot or resume; the entry persists until you `kill()` it.

Key behaviors:

- `create()` is **synchronous** — the sandbox is ready to use the moment it resolves.
- `pause()` checkpoints the full VM (memory, processes, filesystem); `resume()` restores it
  and processes pick up where they left off.
- **Exec auto-resumes.** Running a command or file op (or `connect()`) on a `paused`
  sandbox transparently resumes it first — you do **not** call `resume()` yourself.
- **`timeoutSeconds` / `timeout_seconds` caps active lifetime, then auto-_pauses_** —
  state is preserved, it is **not** deleted. (Bounded by an API-side upper limit.)
- **`autoDeleteSeconds` / `auto_delete_seconds` garbage-collects paused sandboxes** — the box
  is deleted once continuously paused for that long (resume cancels the countdown; `0` =
  delete on pause; unset = kept forever). Set it for scratch work you won't `kill()` yourself,
  and pair it with `timeoutSeconds` so the box actually pauses. Both are settable after
  creation via `update()`; pass `null`/`None` to clear.
- `resume()` rotates the per-sandbox access token; the SDK re-injects it into
  `sandbox.files` for you — keep using the **same** object after resume.
- `kill()` is **idempotent** (a 404 is swallowed). `pause()`/`resume()`/`kill()` return nothing.
- The instance's `status` and `metadata` are **read-only snapshots from construction**.
  Call `getInfo()` / `get_info()` for fresh server state.

## Persist & reconnect across sessions

A sandbox is durable — it outlives the process that created it. Save `sandbox.id`, `pause()` the
box (or let `timeoutSeconds` auto-pause it) when you're done for now, and pick it back up later
from anywhere: the first exec auto-resumes it with files, processes, and memory intact. This is
what makes a sandbox a **persistent execution / dev environment**, not throwaway compute.

```ts
const { id } = await Sandbox.create({ name: "dev-box", timeoutSeconds: 3600 })
// pause() to stop billing now, or the box auto-pauses once timeoutSeconds elapses

// hours later, a different process — fresh token, auto-resumes if paused:
const sandbox = await Sandbox.connect(id)
await sandbox.commands.run("git pull && npm test")
```

```python
box_id = Sandbox.create(name="dev-box", timeout_seconds=3600).id
# later, elsewhere:
sandbox = Sandbox.connect(box_id)
sandbox.commands.run("git pull && pytest")
```

Call `pause()` explicitly to stop compute billing between bursts, and `list({ metadata })`
to rediscover boxes you created earlier.

## System specs & defaults

A sandbox **inherits its VM shape from its template** — there is **no `vcpu`, `memory`,
or `disk` argument on `create()`**. To change the shape, boot from (or build) a different
template. The default template `superserve/base` (`ubuntu:24.04`) is **1 vCPU · 1024 MiB
memory · 4096 MiB disk**.

| Shape field | Min  | Max (platform ceiling) | Default |
| ----------- | ---- | ---------------------- | ------- |
| `vcpu`      | 1    | 4                      | 1       |
| `memoryMib` | 256  | 4096                   | 1024    |
| `diskMib`   | 1024 | 8192                   | 4096    |

- **New teams are capped at 2 vCPU / 2048 MiB** — email support@superserve.ai to raise it.
- Heavier system templates (`superserve/python-ml`, `code-interpreter`, `claude-code`,
  `openclaw`, `hermes`) ship at 2 vCPU / 2048 MiB. See the full catalog in the docs.
- Live shape and timestamps (`vcpuCount`, `memoryMib`, `createdAt`, `network`) live on
  **`SandboxInfo`** (from `getInfo()` / `list()`), not on the sandbox instance.

## Common operations

| Task                | TypeScript                                                                 | Python (sync)                                                                             | Returns / notes                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Create              | `Sandbox.create({ name })`                                                 | `Sandbox.create(name=...)`                                                                | `Sandbox`; opts: `timeoutSeconds`, `autoDeleteSeconds`, `metadata`, `envVars`, `network`, `fromTemplate`, `fromSnapshot` (snapshot UUID) |
| Reconnect           | `Sandbox.connect(id)`                                                      | `Sandbox.connect(id)`                                                                     | `Sandbox`; auto-resumes if paused                                                                                                        |
| List                | `Sandbox.list({ metadata })`                                               | `Sandbox.list(metadata=...)`                                                              | `SandboxInfo[]` (no live instance); metadata filters combine with AND                                                                    |
| Delete by id        | `Sandbox.killById(id)`                                                     | `Sandbox.kill_by_id(id)`                                                                  | idempotent                                                                                                                               |
| Fresh info          | `sandbox.getInfo()`                                                        | `sandbox.get_info()`                                                                      | `SandboxInfo`                                                                                                                            |
| Pause               | `sandbox.pause()`                                                          | `sandbox.pause()`                                                                         | —                                                                                                                                        |
| Resume              | `sandbox.resume()`                                                         | `sandbox.resume()`                                                                        | rotates access token                                                                                                                     |
| Delete              | `sandbox.kill()`                                                           | `sandbox.kill()`                                                                          | idempotent                                                                                                                               |
| Update              | `sandbox.update({ metadata, network, autoDeleteSeconds, timeoutSeconds })` | `sandbox.update(metadata=..., network=..., auto_delete_seconds=..., timeout_seconds=...)` | patches tags / egress / auto-delete / timeout; **metadata is replaced, not merged**; pass `null`/`None` to clear auto-delete or timeout  |
| Run command         | `sandbox.commands.run(cmd, opts)`                                          | `sandbox.commands.run(cmd, ...)`                                                          | `{ stdout, stderr, exitCode }` / `CommandResult`; opts: `cwd`, `env`, timeout                                                            |
| Stream output       | `run(cmd, { onStdout, onStderr })`                                         | `run(cmd, on_stdout=..., on_stderr=...)`                                                  | chunks via callbacks; result still holds full buffer                                                                                     |
| Interactive process | `sandbox.commands.spawn(cmd, opts)`                                        | `AsyncSandbox(...).commands.spawn(...)`                                                   | full-duplex session (sync Python raises — use async)                                                                                     |
| Write file          | `sandbox.files.write(path, content)`                                       | `sandbox.files.write(path, content)`                                                      | parent dirs auto-created                                                                                                                 |
| Read bytes          | `sandbox.files.read(path)`                                                 | `sandbox.files.read(path)`                                                                | `Uint8Array` / `bytes`                                                                                                                   |
| Read text           | `sandbox.files.readText(path)`                                             | `sandbox.files.read_text(path)`                                                           | UTF-8 string                                                                                                                             |

**Unit footgun:** the command timeout is **`timeoutMs` (milliseconds) in TS** but
**`timeout_seconds` (seconds) in Python**. `run("…", { timeoutMs: 10000 })` ≈ `run("…", timeout_seconds=10)`.
Porting `60_000` straight into `timeout_seconds` is ~16.7 hours, not 60 seconds.

File paths must be **absolute** (start with `/`) and must not contain `..` segments.

## Streaming & interactive commands

`run()` returns once the command finishes. For long jobs, pass `onStdout` / `onStderr`
callbacks to watch output live — **the returned result still holds the complete buffer.**

```ts
const r = await sandbox.commands.run("npm run build", {
  onStdout: (data) => process.stdout.write(data),
  timeoutMs: 300_000,
})
console.log(`exited ${r.exitCode}`, r.stdout.length) // full stdout captured too
```

```python
import sys
r = sandbox.commands.run("npm run build",
    on_stdout=lambda data: sys.stdout.write(data), timeout_seconds=300)
print(f"exited {r.exit_code}", len(r.stdout))
```

Streaming uses an **idle timeout** that resets on each chunk (a chatty command never trips
it; a silent one still must finish in time). If the stream drops before the `finished`
event, `run()` **throws** — but the command keeps running in the sandbox, so reconnect with
`Sandbox.connect(id)` if you saved the ID.

Use **`spawn()`** when you need to send stdin, signal the process, or keep a REPL open. It
resolves once the process is _running_ and hands back a session: `stdin.write(data)`,
`stdin.close()` (EOF), `kill(signal?)` (default `SIGTERM`), `wait()` (resolves on exit;
rejects if the socket drops first). `spawn()` is **async-only in Python** (`AsyncSandbox`;
sync raises and points you there) and needs **Node 22+** in TS (or a `ws` polyfill).

```ts
const session = await sandbox.commands.spawn("python -i", {
  onStdout: (data) => process.stdout.write(data),
})
session.stdin.write("print(2 + 2)\n")
session.stdin.close() // EOF, so the REPL exits
console.log((await session.wait()).exitCode)
```

```python
# spawn is async only → use AsyncSandbox; `async with` kills + closes on exit
session = await sandbox.commands.spawn("python -i",
    on_stdout=lambda data: print(data, end=""))
async with session:
    await session.stdin.write("print(2 + 2)\n")
    await session.stdin.close()  # EOF, so the REPL exits
    print((await session.wait()).exit_code)
```

## Templates — reusable base images

A **template** is a Linux filesystem snapshot (base image + build steps) that sandboxes
boot from. Use one to pre-install dependencies once and launch identically-configured
sandboxes in seconds, or to change the VM shape. Every sandbox boots from a template;
omit `fromTemplate` and you get `superserve/base`.

Flow: **`Template.create()` (queues an async build) → `waitUntilReady()` → `Sandbox.create({ fromTemplate })`.**

```ts
import { Template, Sandbox } from "@superserve/sdk"

const template = await Template.create({
  name: "my-python-env",
  from: "python:3.11", // linux/amd64 OCI image; Alpine & distroless are rejected
  vcpu: 2,
  memoryMib: 2048,
  steps: [{ run: "pip install numpy pandas" }, { workdir: "/app" }],
}) // resolves once the build is QUEUED, not finished
await template.waitUntilReady() // blocks until the build finishes (throws BuildError on failure)
const sandbox = await Sandbox.create({ name: "run-1", fromTemplate: template })
```

```python
from superserve import Template, Sandbox, RunStep, WorkdirStep

template = Template.create(
    name="my-python-env",
    from_="python:3.11",
    vcpu=2,
    memory_mib=2048,
    steps=[RunStep(run="pip install numpy pandas"), WorkdirStep(workdir="/app")],
)
template.wait_until_ready()
sandbox = Sandbox.create(name="run-1", from_template=template)
```

- **Build steps:** a list where each step sets **exactly one** of `run`, `env`
  (`{ key, value }`), `workdir`, or `user` (`{ name, sudo? }`). `env`/`workdir`/`user` also
  become runtime defaults (caller `envVars` / per-exec `cwd` override them). Optional
  `startCmd` (long-running process captured in the snapshot) and `readyCmd` (readiness probe,
  polled every 2s up to 10 min).
- `Template.create` / `rebuild` may raise **`RateLimitError`** (`too_many_builds` /
  `too_many_templates`); `waitUntilReady()` raises **`BuildError`** with a machine-readable
  `code` (`step_failed`, `image_pull_failed`, …) on build failure.
- `fromTemplate` accepts a `Template` instance, a name (`my-python-env`), or a UUID.
- Full surface (`rebuild`, `listBuilds`, `getBuild`, `cancelBuild`, `streamBuildLogs`, the
  system-template catalog, and every build-error code) is in the docs — link below.

## Authentication & environment

- Auth via **`SUPERSERVE_API_KEY`** (prefix `ss_live_`, scoped to one team). **Never hardcode it** —
  read it from the environment. Per-call override: `apiKey` (TS) / `api_key=` (Python).
- `SUPERSERVE_BASE_URL` overrides the control-plane URL (default `https://api.superserve.ai`).
- **Env vars:** `envVars` (TS) / `env_vars` (Python) on `create()` inject variables into
  **every** process; they **persist across `pause()`/`resume()`**. A per-command `env`
  overrides for that one call only. Values pass through **unmodified** — no shell expansion,
  so escape `$` yourself. For **credentials, use Secrets** (below), not `envVars`.
- **Cancellation/timeout:** TS — every network op accepts `signal` (`AbortSignal`);
  Python — pass `timeout` (seconds) to file ops, `timeout_seconds` to command ops.
- **Auto-retry:** GET/DELETE requests retry transient failures (429, 502/503/504,
  network) with exponential backoff + jitter. Creates and other mutations (POST/PATCH)
  do **not** auto-retry.

## Secrets — credentials the box never sees

For anything that authenticates (API keys, tokens, passwords), bind a **secret** instead of
passing a raw `envVars` value. The credential is stored once with the platform; inside the box
the env var holds only a **stand-in token**. Superserve swaps that token for the real value as
each request leaves the box — and only on requests to the secret's allowed hosts. A `printenv`,
a prompt-injected agent, or a leaked log exposes nothing usable.

```ts
import { Secret, Sandbox } from "@superserve/sdk"

// 1. Store the credential once — a provider shortcut sets the auth scheme + allowed hosts.
await Secret.create({
  name: "anthropic-prod",
  value: process.env.ANTHROPIC_API_KEY!,
  provider: "anthropic",
})

// 2. Bind it: env var → secret name. Pair with egress lockdown for defense in depth.
const sandbox = await Sandbox.create({
  name: "research-agent",
  secrets: { ANTHROPIC_API_KEY: "anthropic-prod" },
  network: { allowOut: ["api.anthropic.com"], denyOut: ["0.0.0.0/0"] },
})
```

```python
import os
from superserve import Secret, Sandbox, NetworkConfig

Secret.create(name="anthropic-prod", value=os.environ["ANTHROPIC_API_KEY"], provider="anthropic")
sandbox = Sandbox.create(
    name="research-agent",
    secrets={"ANTHROPIC_API_KEY": "anthropic-prod"},
    network=NetworkConfig(allow_out=["api.anthropic.com"], deny_out=["0.0.0.0/0"]),
)
```

- **Provider shortcuts** preconfigure auth + allowed hosts for common services (Anthropic,
  OpenAI, Gemini, GitHub, Vercel, Stripe, …) — `Provider.list()` for the catalog, or pass a
  custom `auth`. Manage with `Secret.get` / `list` / `deleteByName`; rotate with `secret.rotate(value)`.
- **`secrets` vs `envVars`:** both set env vars and a name can't come from both — `secrets` for
  credentials, `envVars` for non-sensitive config.
- **Attach/detach on a live box:** `sandbox.attachSecret(env, name)` / `detachSecret(env)`
  (Python `attach_secret` / `detach_secret`), on `active` or `paused`; applies to processes
  started after the call. `sandbox.secrets` lists bindings (`revoked` flips when the secret is deleted).
- **Host-scoped + audited:** a secret for `api.anthropic.com` attaches only on requests to that
  host; elsewhere the stand-in token is useless. Every injected request shows in the secret
  audit log / sandbox network log — see `docs.superserve.ai/secrets`.

## Network egress control

By default a sandbox reaches any **public** IP; the platform **always** blocks private,
link-local, and loopback ranges (non-overridable). `network` rules only _narrow_ egress —
ideal for restricting what an agent or untrusted code can reach.

| Field                    | Accepts             | Notes                                                                                                      |
| ------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `allowOut` / `allow_out` | CIDRs **+ domains** | Wildcards (`*.example.com`) match subdomains at any depth but **not the apex** — list both if you need it. |
| `denyOut` / `deny_out`   | **CIDRs only**      | `0.0.0.0/0` denies the whole internet; allow exceptions via `allowOut`.                                    |

Allow rules win over deny on overlap, so the strict pattern is **deny-all + allowlist**.
Egress is editable live via `update({ network })`. **Never block `*.superserve.ai`** — it
breaks the SDK↔sandbox connection.

```ts
await Sandbox.create({
  name: "restricted",
  network: {
    allowOut: ["api.openai.com", "*.github.com", "140.82.112.0/20"],
    denyOut: ["0.0.0.0/0"],
  },
})
```

```python
from superserve import Sandbox, NetworkConfig

Sandbox.create(name="restricted", network=NetworkConfig(
    allow_out=["api.openai.com", "*.github.com", "140.82.112.0/20"], deny_out=["0.0.0.0/0"]))
```

## Preview URLs — expose a port publicly

Run a server in the box (a dev server, the agent's web UI, an API) and hand out a **public
URL** (also called a _tunnel URL_) that routes to it. `getPreviewUrl(port)` / `get_preview_url(port)` is pure string
construction — no network call — returning `https://{port}-{id}.{host}`; the edge proxy
forwards that subdomain straight to the port on the VM.

```ts
// start a server in the box, then hand out its public URL
await sandbox.commands.spawn("python3 -m http.server 8000")
const url = sandbox.getPreviewUrl(8000) // https://8000-<id>.sandbox.superserve.ai
```

```python
await sandbox.commands.spawn("python3 -m http.server 8000")  # spawn is async-only (AsyncSandbox)
url = sandbox.get_preview_url(8000)  # https://8000-<id>.sandbox.superserve.ai
```

- **Port range 1024–65535** (integer). Privileged ports (< 1024) aren't proxied and throw
  `ValidationError`. Exported `MIN_PREVIEW_PORT` / `MAX_PREVIEW_PORT` constants and a
  standalone `previewUrl(id, host, port)` / `preview_url(...)` helper are available too.
- **Resolves only while it's live** — the sandbox must be running with a server listening on
  the port. Call it once per port to expose several services at once.
- **Public, no auth** — anyone with the URL can reach the port (unlike the data plane, it
  carries no access token). Don't expose anything you wouldn't put on the open internet; pair
  it with network egress rules when running untrusted code.

## Error handling

Every SDK call throws a typed error extending `SandboxError`. Catch the base, or
narrow to a subclass. A **non-zero `exitCode` is a normal result, not a thrown error.**

| Error                 | Thrown when                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `SandboxError`        | Base class for all SDK errors (carries `statusCode`, `code`)                                                                |
| `AuthenticationError` | API key missing / invalid / forbidden (401/403)                                                                             |
| `ValidationError`     | Bad request or invalid arguments (400)                                                                                      |
| `NotFoundError`       | Sandbox / template / resource does not exist (404)                                                                          |
| `ConflictError`       | Invalid state transition, e.g. an unsupported lifecycle change (409)                                                        |
| `TimeoutError`        | A request timed out — **Python: `SandboxTimeoutError`** (avoids shadowing the builtin)                                      |
| `RateLimitError`      | Quota / rate limit exceeded (429); `code` names which limit (`too_many_builds`, `too_many_templates`, `too_many_sandboxes`) |
| `ServerError`         | Platform error (500+)                                                                                                       |
| `BuildError`          | Template build failed (carries `buildId`, `templateId`, `code`)                                                             |

```ts
import { Sandbox, NotFoundError, AuthenticationError } from "@superserve/sdk"
try {
  const sandbox = await Sandbox.connect(id)
} catch (e) {
  if (e instanceof NotFoundError) {
    /* gone — create a fresh one */
  } else if (e instanceof AuthenticationError) {
    /* fix SUPERSERVE_API_KEY */
  } else throw e
}
```

## Gotchas & anti-patterns

**Gotchas**

- Don't call `resume()` before exec — a command/file op auto-resumes a paused sandbox.
- Check `exitCode`; the SDK only throws for transport/API failures, not command failures.
- Use `getInfo()` for current state — the instance `status`/`metadata` are stale snapshots.
- `update({ metadata })` **replaces** the whole map; omitted keys are dropped.
- No `vcpu`/`memory`/`disk` on `create()` — size the VM via the template.
- `Template.create()` returns when the build is _queued_; boot a sandbox only **after**
  `waitUntilReady()` resolves.
- Streaming `run()` uses an idle timeout (resets per chunk) and throws if the stream ends
  without a `finished` event; the command keeps running — reconnect via `connect(id)`.
- (Python) the sandbox holds a shared `httpx` client, closed on `kill()` — always
  `kill()` rather than just dropping the reference.

**Anti-patterns**

- Don't hardcode the API key in source — read `SUPERSERVE_API_KEY` from the env.
- Don't build data-plane URLs (`boxd-{id}.sandbox.superserve.ai`) or handle access
  tokens by hand — the SDK does this.
- Don't rely on `await using` / a `with` block on the sandbox — there is none; `kill()` in a `finally`.
- Don't trust `sandbox.status` after pause/resume — fetch `getInfo()`.
- Don't pass relative file paths — paths must be absolute.
- Don't deny `*.superserve.ai` in a network rule — it severs the SDK connection.

## More integrations

Ready-made guides (TS + Python) for running an agent inside a sandbox or backing a hosted
agent's tools with one — agent harnesses, coding agents, personal agents, managed agents,
and virtual filesystems — live at `docs.superserve.ai/integrations`.

## Reference

Method signatures and behavior can change between SDK versions. Fetch the live docs
rather than relying on memory:

- Docs & quickstart: https://docs.superserve.ai
- LLM-friendly docs corpus: https://docs.superserve.ai/llms.txt and https://docs.superserve.ai/llms-full.txt
- SDK reference: https://docs.superserve.ai/sdk-reference/sandbox (also `commands`, `files`, `template`)
- Guides: `/secrets/overview`, `/sandbox/networking`, `/sandbox/network-log`, `/sandbox/lifecycle`, `/commands/streaming`, `/commands/sessions`, `/templates/overview`, `/integrations`
- Packages: `@superserve/sdk` (npm), `superserve` (PyPI)
