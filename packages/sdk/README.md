# @superserve/sdk

TypeScript SDK for the Superserve sandbox API — run code in isolated Firecracker MicroVMs.

## Installation

```bash
npm install @superserve/sdk
# or
bun add @superserve/sdk
# or
pnpm add @superserve/sdk
```

Zero runtime dependencies. Requires Node.js ≥ 18 or any modern browser/runtime with `fetch`.

## Quick Start

```typescript
import { Sandbox } from "@superserve/sdk"

// Sandbox is ready to use when create() returns.
const sandbox = await Sandbox.create({ name: "my-sandbox" })

const result = await sandbox.commands.run("echo hello")
console.log(result.stdout)

await sandbox.files.write("/app/data.txt", "content")
const text = await sandbox.files.readText("/app/data.txt")

await sandbox.kill()
```

## Preview URLs

Choose the default access for new ports, publish only the ports you intend to
expose, and request a signed link for private browser access:

```typescript
const sandbox = await Sandbox.create({
  name: "private-preview",
  previewAccess: "private",
})
await sandbox.publishPreviewPort(3000, { access: "private" })

const browserUrl = await sandbox.getSignedPreviewUrl(3000, {
  expiresInSeconds: 300,
})
const credential = await sandbox.getPreviewToken(3000)
// Machine clients: credential.header: credential.token
```

Each published port keeps its own `public` or `private` mode; `previewAccess`
is only the default for newly published ports. Omitting it defaults a new
sandbox to strict `public`. `legacy_public` is returned only for pre-migration
sandboxes.
See the [preview URL guide](https://docs.superserve.ai/sandbox/preview-urls).

## Desktop (computer use)

Control a GUI desktop inside a sandbox — screenshot, mouse, keyboard, and a
live browser viewer. Requires a desktop-enabled template.

```typescript
const sandbox = await Sandbox.create({ template: "superserve/desktop" })

const shot = await sandbox.desktop.screenshot() // PNG bytes + dimensions
await sandbox.desktop.click(640, 400)
await sandbox.desktop.write("hello") // no per-character pacing
await sandbox.desktop.press("ctrl+l")
await sandbox.desktop.drag([10, 10], [200, 200]) // one atomic request

// Several model-emitted actions in a single round trip:
await sandbox.desktop.actions([
  { type: "click", x: 640, y: 32 },
  { type: "write", text: "https://example.com" },
  { type: "press", key: "enter" },
])

await sandbox.desktop.resize(1920, 1080) // live, no restart
const viewer = await sandbox.desktop.getStreamUrl() // noVNC URL
```

## Authentication

Set the `SUPERSERVE_API_KEY` environment variable:

```bash
export SUPERSERVE_API_KEY=ss_live_...
```

Or pass it explicitly:

```typescript
const sandbox = await Sandbox.create({
  name: "my-sandbox",
  apiKey: "ss_live_...",
  baseUrl: "https://api.superserve.ai", // optional
})
```

## Streaming command output

```typescript
const result = await sandbox.commands.run("npm install", {
  onStdout: (data) => process.stdout.write(data),
  onStderr: (data) => process.stderr.write(data),
  timeoutMs: 120_000,
})
```

## Cancellation

Every network operation accepts an `AbortSignal`:

```typescript
const controller = new AbortController()
setTimeout(() => controller.abort(), 5000)

await sandbox.commands.run("sleep 100", { signal: controller.signal })
```

## Error handling

```typescript
import {
  SandboxError,
  AuthenticationError, // 401
  ValidationError, // 400
  NotFoundError, // 404
  ConflictError, // 409 — invalid state for operation
  TimeoutError, // request timed out
  ServerError, // 500
} from "@superserve/sdk"

try {
  await sandbox.pause()
} catch (err) {
  if (err instanceof ConflictError) {
    // Sandbox is not in a pausable state
  }
}
```

## Full documentation

[docs.superserve.ai](https://docs.superserve.ai/sdk/typescript/sandbox?utm_source=npm&utm_medium=readme)

## Development

```bash
# From repo root:
bunx turbo run build --filter=@superserve/sdk
bunx turbo run typecheck --filter=@superserve/sdk
```

## License

Apache License 2.0.
