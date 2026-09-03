# @superserve/mcp

[Model Context Protocol](https://modelcontextprotocol.io) server for [Superserve](https://superserve.ai) sandboxes. Create, run commands in, and manage isolated Firecracker microVMs from any MCP client — Claude, Cursor, VS Code, Windsurf, Codex.

Runs locally over stdio via `npx`. Authenticates with your Superserve API key. Targets a sandbox per call by id.

## Install

Add to your MCP client and set `SUPERSERVE_API_KEY` in its `env` (clients do not inherit it from your shell). Create a key at [console.superserve.ai](https://console.superserve.ai).

**Claude Code:**

```bash
claude mcp add superserve \
  --env SUPERSERVE_API_KEY=ss_live_xxxxxxxxxxxxxxxx \
  -- npx -y @superserve/mcp
```

**Claude Desktop / Cursor / Windsurf** (`claude_desktop_config.json`, `.cursor/mcp.json`, `mcp_config.json`):

```json
{
  "mcpServers": {
    "superserve": {
      "command": "npx",
      "args": ["-y", "@superserve/mcp"],
      "env": { "SUPERSERVE_API_KEY": "ss_live_xxxxxxxxxxxxxxxx" }
    }
  }
}
```

**VS Code** (`.vscode/mcp.json`, prompts for the key):

```json
{
  "inputs": [
    {
      "id": "superserve-key",
      "type": "promptString",
      "description": "Superserve API key",
      "password": true
    }
  ],
  "servers": {
    "superserve": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@superserve/mcp"],
      "env": { "SUPERSERVE_API_KEY": "${input:superserve-key}" }
    }
  }
}
```

**Codex** (`~/.codex/config.toml`) — `env_vars` forwards the key from your environment instead of storing it in the file:

```toml
[mcp_servers.superserve]
command = "npx"
args = ["-y", "@superserve/mcp"]
env_vars = ["SUPERSERVE_API_KEY"]
```

## Hosted (remote)

A hosted instance runs at `https://mcp.superserve.ai` (Streamable HTTP) — no local install. Send your Superserve API key as a bearer token; the server is stateless and account-scoped (the key already maps to your team).

> Bearer auth works in Claude Code, Cursor, VS Code, and the Anthropic Messages API connector. Claude.ai, Claude Desktop's Custom Connector UI, and ChatGPT developer mode expect OAuth (no static-bearer field), which the hosted endpoint does not support yet.

**Claude Code:**

```bash
claude mcp add --transport http superserve https://mcp.superserve.ai \
  --header "Authorization: Bearer ss_live_xxxxxxxxxxxxxxxx"
```

**Cursor / VS Code** (`.cursor/mcp.json`, `.vscode/mcp.json`):

```json
{
  "servers": {
    "superserve": {
      "type": "http",
      "url": "https://mcp.superserve.ai",
      "headers": { "Authorization": "Bearer ss_live_xxxxxxxxxxxxxxxx" }
    }
  }
}
```

### Running the hosted server

The same package ships the hosted server. Run it standalone (self-host / staging):

```bash
PORT=8080 SUPERSERVE_BASE_URL=https://api.superserve.ai \
  npx -y -p @superserve/mcp superserve-mcp-http
```

Or mount the Web-standard handler in any `fetch` runtime (e.g. a Next.js route handler):

```ts
import { handleMcpRequest } from "@superserve/mcp/http"

export const POST = (req: Request) => handleMcpRequest(req)
```

It serves the MCP endpoint at `/` (POST) and a `GET /health` liveness probe. Config: `PORT` (default `8080`), `SUPERSERVE_BASE_URL` (optional). The API key is read per request from the bearer header and never logged.

## Tools

| Tool                         | Description                                                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `sandbox_create`             | Create a sandbox; returns its `id`. Accepts `secrets` bindings and egress rules.                                                    |
| `sandbox_update`             | Change a sandbox's metadata or egress (`allow_out`/`deny_out`) rules after creation.                                                |
| `sandbox_list`               | List sandboxes (active and paused), filterable by metadata.                                                                         |
| `sandbox_info`               | Get a sandbox's status, resources, metadata, network rules, and secret bindings.                                                    |
| `sandbox_exec`               | Run a shell command; returns stdout, stderr, exit code. Auto-resumes a paused sandbox.                                              |
| `sandbox_computer`           | Drive a GUI desktop sandbox: screenshot, mouse, keyboard, scroll, resize, live viewer URL. Input actions return a fresh screenshot. |
| `sandbox_files_read`         | Read a file (UTF-8 text or base64). Rejects files over 1 MiB.                                                                       |
| `sandbox_files_write`        | Create or overwrite a file (inline content capped at 8 MiB).                                                                        |
| `sandbox_files_list`         | List a directory.                                                                                                                   |
| `sandbox_files_download_dir` | Download a directory as a base64 ZIP (symlinks skipped). Capped at 10 MiB.                                                          |
| `sandbox_pause`              | Pause a sandbox (state preserved).                                                                                                  |
| `sandbox_resume`             | Resume a paused sandbox (usually unnecessary — exec auto-resumes).                                                                  |
| `sandbox_kill`               | Delete a sandbox.                                                                                                                   |
| `sandbox_preview_url`        | Publish a port and return a public or private signed preview URL.                                                                   |
| `sandbox_network_log`        | Audit a sandbox's outbound connections.                                                                                             |
| `sandbox_template_list`      | List the templates (prebuilt base images) your team can create sandboxes from.                                                      |
| `sandbox_template_create`    | Build a custom template (vCPU/memory/disk shape, preinstalled software). Async.                                                     |
| `secret_list`                | List bindable team secrets (metadata only — never values).                                                                          |
| `sandbox_attach_secret`      | Bind a stored secret to a sandbox under an env var.                                                                                 |
| `sandbox_detach_secret`      | Remove a secret binding from a sandbox.                                                                                             |

All tools take a `sandbox_id` except `sandbox_create`, `sandbox_list`, `sandbox_template_list`, `sandbox_template_create`, and `secret_list`. Secret _creation_ is intentionally not exposed (the raw value belongs on the SDK/console, not an agent transcript); the server only binds existing secrets.

## Configuration

| Variable              | Required | Default                     |
| --------------------- | -------- | --------------------------- |
| `SUPERSERVE_API_KEY`  | Yes      | —                           |
| `SUPERSERVE_BASE_URL` | No       | `https://api.superserve.ai` |

## Development

```bash
bun install
bunx turbo run build     --filter=@superserve/mcp
bunx turbo run typecheck --filter=@superserve/mcp
bunx turbo run test      --filter=@superserve/mcp        # unit + in-memory integration (no credentials)
SUPERSERVE_API_KEY=ss_live_... bunx turbo run e2e --filter=@superserve/mcp   # live round-trip
```

The server is a thin adapter over [`@superserve/sdk`](https://www.npmjs.com/package/@superserve/sdk); the per-sandbox data-plane access token is managed by the SDK and never exposed to the model.

## License

Apache-2.0
