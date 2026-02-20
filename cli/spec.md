# Superserve CLI — TypeScript Rewrite Spec

## Context

The Superserve CLI has been rewritten from Python to TypeScript using **OpenTUI** (the terminal UI framework that powers OpenCode). The goal is to have the best CLI UX in the agent deployment space — think Railway CLI / Vercel CLI level polish.

---

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Runtime | **Bun** | Fast, built-in TS, single-binary compilation |
| TUI Framework | **@opentui/react** v0.1.0 | React reconciler for terminal — JSX, hooks, flexbox via Yoga |
| CLI Parsing | **Commander.js** v14 | For command routing and flag parsing |
| HTTP Client | **Bun native fetch** | No extra deps needed |
| Streaming | **SSE / ReadableStream** | For `superserve run` real-time agent responses |
| Config | **js-yaml** v4 | Reads/validates `superserve.yaml` (existing format) |
| Auth Storage | **JSON file** | `~/.superserve/auth.json` with `0o600` permissions |
| Analytics | **posthog-node** v5 | Anonymous CLI usage tracking (opt-out supported) |
| Linter | **Biome** v2 | Linting, formatting, and import organization |
| Build | **`bun build --compile`** | Single binary, no runtime deps on user machine |

---

## Project Structure

```
cli/
├── src/
│   ├── index.ts                     # Entry point — Commander.js program, global flags, error handler
│   ├── analytics.ts                 # PostHog event tracking (anonymous, opt-out)
│   ├── commands/
│   │   ├── login.ts                 # OAuth device flow + API key auth
│   │   ├── logout.ts               # Clear stored credentials
│   │   ├── init.ts                  # Generate superserve.yaml (auto-detect .env.example)
│   │   ├── deploy.ts               # Package + upload + poll dependency installation
│   │   ├── run.ts                   # Create session → launch TUI or imperative stream
│   │   ├── agents/
│   │   │   ├── index.ts             # agents subcommand group
│   │   │   ├── list.ts
│   │   │   ├── get.ts
│   │   │   └── delete.ts
│   │   ├── secrets/
│   │   │   ├── index.ts
│   │   │   ├── set.ts
│   │   │   ├── list.ts
│   │   │   └── delete.ts
│   │   └── sessions/
│   │       ├── index.ts
│   │       ├── list.ts
│   │       ├── get.ts
│   │       └── end.ts
│   ├── tui/
│   │   ├── theme.ts                 # Teal palette (#2dd4bf), NO_COLOR support
│   │   ├── App.tsx                  # Root TUI component — header + scrollbox + input
│   │   ├── components/
│   │   │   ├── ChatMessage.tsx      # Single message bubble (user/agent role coloring)
│   │   │   ├── ChatInput.tsx        # Input with Enter to send
│   │   │   ├── AgentOutput.tsx      # Streaming text with block cursor indicator
│   │   │   ├── Spinner.tsx          # TUI animated loading indicator (React component)
│   │   │   ├── StatusBar.tsx        # Bottom bar: agent name, session, elapsed
│   │   │   ├── ToolCallView.tsx     # Collapsible tool call display
│   │   │   └── ErrorDisplay.tsx     # Red-bordered error with suggestion
│   │   └── hooks/
│   │       └── useSession.ts        # Session state management + message streaming hook
│   ├── api/
│   │   ├── client.ts                # createClient() factory — typed fetch, auth headers, agent cache
│   │   ├── types.ts                 # Credentials, AgentResponse, RunEvent, DeviceCodeResponse
│   │   ├── errors.ts                # PlatformAPIError + ERROR_HINTS map
│   │   └── streaming.ts             # SSE ReadableStream → AsyncIterableIterator<RunEvent>
│   ├── config/
│   │   ├── auth.ts                  # Read/write/clear ~/.superserve/auth.json (0o600 perms)
│   │   ├── project.ts              # Read/validate superserve.yaml
│   │   └── constants.ts             # API URLs, config dir, timeouts, env overrides
│   └── utils/
│       ├── logger.ts                # Styled console output (✓/✗, colors) for imperative cmds
│       ├── format.ts                # formatTimestamp, formatDuration, formatElapsed, formatSize
│       ├── sanitize.ts              # ANSI escape sequence stripper
│       ├── fs.ts                    # Tarball creation with built-in exclusions
│       └── spinner.ts              # Imperative spinner (createSpinner factory) for non-TUI cmds
├── tests/
│   ├── api/
│   │   ├── auth.test.ts
│   │   ├── client.test.ts
│   │   └── streaming.test.ts
│   ├── commands/
│   │   ├── deploy.test.ts
│   │   ├── login.test.ts
│   │   └── run.test.ts
│   └── utils/
│       ├── format.test.ts
│       └── sanitize.test.ts
├── scripts/
│   └── build.ts                     # Multi-platform bun compile
├── package.json
├── tsconfig.json
├── biome.json
├── bunfig.toml
└── .gitignore
```

---

## Commands — Full Reference

### `superserve login`
- `--api-key <key>` — Direct API key authentication (skips browser flow)
- Without `--api-key`: Initiates OAuth device-code flow — prints verification URL + user code, opens browser, polls for token
- Checks for existing valid credentials first (prints "Already logged in" if still valid)
- Stores credentials in `~/.superserve/auth.json` with `0o600` permissions
- Tracks `cli_login` analytics event
- **No TUI needed** — styled console output

### `superserve logout`
- Clears `~/.superserve/auth.json`
- Checks if user was logged in first (prints appropriate message if not)
- Tracks `cli_logout` analytics event
- **No TUI needed**

### `superserve init`
- `--name <name>` — Agent name (defaults to current directory name, sanitized to lowercase alphanumeric + hyphens)
- Detects `.env.example` to auto-populate `secrets:` block
- Generates `superserve.yaml` template with name, command placeholder, and detected secrets
- Skips if `superserve.yaml` already exists
- Prints next-steps guidance
- **No TUI needed**

### `superserve deploy`
- `--dir <path>` — Project directory (default: current directory)
- `--json` — Output raw JSON result
- Reads and validates `superserve.yaml`
- Packages project as tarball (excludes built-in set + `ignore:` from config)
- Uploads via multipart FormData
- Polls dependency installation status (every 3s, up to 5 minutes)
- Reports packaging size, upload status, dependency progress with animated spinner
- Checks for missing required secrets after deploy, prints `secrets set` commands
- **Uses imperative spinner** for progress

### `superserve run AGENT [PROMPT]`
- `--single` — Exit after a single response (no interactive loop)
- `--json` — Output raw JSON SSE events
- **THIS IS THE HERO FEATURE — full TUI mode when interactive**
- Pre-flight: checks agent exists, required secrets are set
- Creates a new session with 30-day idle timeout
- When interactive TTY (no `--json`, no `--single`): launches `@opentui/react` TUI, falls back to imperative streaming if TUI deps unavailable
- When non-interactive or `--single` or `--json`: uses imperative streaming mode
- Imperative interactive mode: prompts for follow-up messages in a loop (type `exit` or Ctrl+D to quit)
- **Full @opentui/react TUI** for interactive mode

### `superserve secrets set AGENT KEY=VALUE [KEY2=VALUE2 ...]`
- Sets one or more encrypted environment variables
- Shows count of secrets set, then current full list of key names
- **No TUI needed**

### `superserve secrets list AGENT`
- Lists secret key names (values are never shown)
- **No TUI needed**

### `superserve secrets delete AGENT KEY`
- `-y, --yes` — Skip confirmation prompt
- Prompts `Delete secret 'KEY' from agent 'AGENT'? (y/N)` unless `-y`
- Shows remaining secret keys after deletion
- **No TUI needed**

### `superserve agents list`
- `--json` — Output as JSON
- Table columns: NAME, ID, CREATED
- **No TUI needed**

### `superserve agents get AGENT`
- `--json` — Output as JSON
- Shows: ID, Name, Command, Created, Updated
- **No TUI needed**

### `superserve agents delete AGENT`
- `-y, --yes` — Skip confirmation prompt
- Prompts `Delete agent 'AGENT'? (y/N)` unless `-y`
- **No TUI needed**

### `superserve sessions list`
- `--agent <name>` — Filter by agent name or ID
- `--status <status>` — Filter by session status
- `--json` — Output as JSON
- Table columns: ID (short 12-char prefix), AGENT, STATUS, MSGS, CREATED
- Returns last 20 sessions by default
- **No TUI needed**

### `superserve sessions get SESSION_ID`
- `--json` — Output as JSON
- Shows: Session (full ID), Agent, Status, Messages, Created, Title
- Supports short prefix resolution (ambiguous prefix returns error with matches)
- **No TUI needed**

### `superserve sessions end SESSION_ID`
- Ends an active session
- Supports short prefix resolution
- **No TUI needed**

### Global Flags (all commands)
- `-v, --version` — Show CLI version
- `--no-color` — Disable ANSI colors
- `--json` — Output as JSON (where supported)
- `-h, --help` — Auto-generated help text (Commander.js)

---

## Two Rendering Modes

### 1. Imperative Mode (most commands)
For commands like `login`, `deploy`, `agents list`, etc. — these are fire-and-forget. Use **styled console output** via `logger.ts` (colored ✓/✗ messages) and `spinner.ts` (braille animation on stderr). No React reconciler needed.

### 2. Full TUI Mode (`superserve run`)
Only the `run` command uses the **@opentui/react** reconciler with JSX components, flexbox layout, and interactive input handling. Falls back to imperative streaming if TUI dependencies are unavailable.

This separation keeps the CLI fast for simple commands while giving maximum power for the chat experience.

---

## The `run` TUI — Detailed Spec

### Layout
```
┌──────────────────────────────────────────┐
│  superserve → my-agent  (session: abc123)│  ← Header
├──────────────────────────────────────────┤
│                                          │
│  You: What is the capital of France?     │  ← ScrollBox
│                                          │
│  Agent: The capital of France is Paris.  │
│         Completed in 1.2s                │
│                                          │
│  You: And what's its population?         │
│                                          │
│  Agent: Paris has approximately 2.1      │
│         million people in the city       │
│         proper.                          │
│         Completed in 0.8s                │
│                                          │
├──────────────────────────────────────────┤
│  > Type a message... (Enter to send)     │  ← Input
│  my-agent | ses:abc12345 | 0:42          │  ← StatusBar
└──────────────────────────────────────────┘
```

### Streaming Behavior
- As the agent streams tokens, render them in real-time with a block cursor indicator
- Show "Thinking..." spinner while waiting for first token
- When agent uses tools, show them inline (collapsible):
  ```
  ▸ Running: web_search("Paris population 2024")     ← tool call
  ✓ web_search (0.3s)                                ← tool completed
  ```

### Keyboard Handling
- `Enter` — send message
- `Esc` — cancel current streaming response
- `Ctrl+C` — exit (via `exitOnCtrlC: true` on renderer)

### Components
- **ChatMessage** — User messages (teal) vs agent messages (white), role indicator + content + optional timing
- **ChatInput** — Text input with submit handler, disabled during streaming
- **AgentOutput** — Streaming markdown content with block cursor indicator
- **ToolCallView** — Tool name, input preview, status (running/completed), and duration
- **Spinner** — Animated braille spinner for "thinking" state
- **StatusBar** — Agent name, session ID (short), elapsed time
- **ErrorDisplay** — Red-bordered error box with message

### useSession Hook
React hook managing session state:
- `messages` array (role, content, timing, toolCalls)
- `isStreaming` / `streamingContent` / `streamingToolCalls` for in-progress responses
- `sendMessage(prompt)` — sends message and processes SSE stream
- `cancelStream()` — aborts via ref flag
- Processes events: `message.delta`, `tool.start`, `tool.end`, `run.completed`, `run.failed`, `run.cancelled`

---

## API Client

The client is a **factory function** (`createClient()`) returning a flat object of methods. Agent name-to-ID resolution is cached per client instance. Session IDs support short prefix resolution.

```typescript
// createClient(baseUrl?, timeout?) returns:
{
  // Auth
  validateToken(): Promise<boolean>
  getDeviceCode(): Promise<DeviceCodeResponse>
  pollDeviceToken(deviceCode: string): Promise<Credentials>

  // Agents
  deployAgent(name, command, config, tarballPath): Promise<AgentResponse>
  listAgents(): Promise<AgentResponse[]>
  getAgent(nameOrId): Promise<AgentResponse>
  deleteAgent(nameOrId): Promise<void>

  // Secrets
  getAgentSecrets(nameOrId): Promise<string[]>
  setAgentSecrets(nameOrId, secrets): Promise<string[]>
  deleteAgentSecret(nameOrId, key): Promise<string[]>

  // Sessions
  createSession(agentNameOrId, title?, idleTimeoutSeconds?): Promise<Record<string, unknown>>
  listSessions(agentId?, status?, limit?): Promise<Record<string, unknown>[]>
  getSession(sessionId): Promise<Record<string, unknown>>
  endSession(sessionId): Promise<Record<string, unknown>>
  streamSessionMessage(sessionId, prompt): AsyncIterableIterator<RunEvent>
}
```

### Internals
- Base URL: `https://api.superserve.ai` (overridable via `SUPERSERVE_API_URL`)
- All endpoints prefixed with `/v1`
- Default timeout: 30s (streaming requests have no timeout)
- `User-Agent: superserve-cli/<version>` header on all requests
- `Authorization: Bearer <token>` header on authenticated requests
- Agent name-to-ID resolved via list + cache (`Map<string, string>`)
- Session short-prefix resolved via `GET /v1/sessions/resolve?id_prefix=...`
- Ambiguous prefix returns HTTP 409 with matching IDs

### SSE Streaming
Custom async generator in `streaming.ts` that:
- Reads `Response.body` ReadableStream with a reader
- Buffers newline-delimited SSE frames
- Parses `event:` and `data:` fields
- Yields `{ type: string, data: Record<string, unknown> }` objects
- Event types: `status`, `run.started`, `heartbeat`, `message.delta`, `tool.start`, `tool.end`, `run.completed`, `run.failed`, `run.cancelled`

---

## Config Files

### `~/.superserve/auth.json`
```json
{
  "token": "ss_...",
  "token_type": "Bearer",
  "expires_at": "2026-01-01T00:00:00Z",
  "refresh_token": "..."
}
```
- Written with `0o600` file permissions
- Auto-deleted if corrupted/unparseable on read
- `token` is required; other fields are optional

### `superserve.yaml` (project config)
```yaml
# Agent name (required)
name: my-agent

# Command to start your agent (required)
command: python main.py

# Environment variables your agent needs (optional)
secrets:
  - ANTHROPIC_API_KEY
  - OPENAI_API_KEY

# Files/directories to exclude from upload (optional)
ignore:
  - .venv
  - data/
```

Validation:
- Must be a YAML mapping (not a list or scalar)
- `name` is required
- `command` is required
- `secrets` and `ignore` are optional arrays
- Additional fields are passed through as config JSON to the API

### File Packaging Exclusions
The following are always excluded from deploy tarballs (hardcoded in `utils/fs.ts`):
- **Directories**: `__pycache__`, `.git`, `.venv`, `venv`, `node_modules`, `.mypy_cache`, `.pytest_cache`, `.ruff_cache`, `dist`, `build`, `*.egg-info`
- **Files**: anything starting with `.env` (`.env`, `.env.local`, `.env.production`, etc.)
- **User-specified**: entries in the `ignore:` list in `superserve.yaml`

### Other Config Paths
| Path | Description |
|------|-------------|
| `~/.superserve/` | Config directory |
| `~/.superserve/auth.json` | Stored credentials |
| `~/.superserve/anonymous_id` | UUID for anonymous analytics |
| `~/.superserve/.analytics_disabled` | Presence disables analytics |

---

## Constants & Environment Variables

| Constant | Default | Env Override |
|----------|---------|-------------|
| `PLATFORM_API_URL` | `https://api.superserve.ai` | `SUPERSERVE_API_URL` |
| `DASHBOARD_URL` | `https://console.superserve.ai` | `SUPERSERVE_DASHBOARD_URL` |
| `DEFAULT_TIMEOUT` | 30000ms | — |
| `DEVICE_POLL_INTERVAL` | 5000ms | — |

| Env Variable | Effect |
|-------------|--------|
| `SUPERSERVE_DO_NOT_TRACK` | Disables PostHog analytics |
| `DO_NOT_TRACK` | Disables PostHog analytics (standard) |
| `NO_COLOR` | Disables ANSI color output |

---

## Analytics

Anonymous CLI usage tracking via PostHog:
- Public API key hardcoded, host at `https://us.i.posthog.com`
- Anonymous UUID generated on first use, stored in `~/.superserve/anonymous_id`
- Disabled if `SUPERSERVE_DO_NOT_TRACK`, `DO_NOT_TRACK` env vars are set, or `~/.superserve/.analytics_disabled` file exists
- Failures are silently swallowed — analytics never breaks the CLI
- Currently tracked events: `cli_login`, `cli_logout`

---

## Theme / Visual Identity

- **Primary color**: Teal (`#2dd4bf`)
- **Error**: Red
- **Warning**: Yellow/Amber
- **Success**: Green
- **Muted text**: Gray for secondary info
- **Borders**: Single-line box drawing characters, subtle

All color usage goes through `theme.ts`. Respects `--no-color` flag and `NO_COLOR` env var. Logger output writes to `stderr` to keep `stdout` clean for data/JSON output.

---

## Error Handling

All errors flow through a single `PlatformAPIError` class with `status_code`, `message`, and optional `details`. The global error handler in `index.ts` catches these and displays colored, actionable messages.

### Error Hint Map
| Status | Hint |
|--------|------|
| 401 | `Run \`superserve login\` to authenticate.` |
| 403 | `You don't have permission for this action.` |
| 404 | `Run \`superserve agents list\` to see your agents.` |
| 409 | `Use a different name or delete the existing resource first.` |
| 422 | `Check your input and try again.` |
| 429 | `Too many requests. Please wait and try again.` |
| 500 | `This is a server issue. Please try again later.` |
| 502/503 | `The server is temporarily unavailable. Please try again later.` |

### Error Examples
```
✗ Not authenticated. Run `superserve login` first.

✗ Agent "my-agent" not found.
  Run `superserve agents list` to see your agents.

✗ superserve.yaml not found in current directory. Run `superserve init` to create one.
```

Other errors: `AbortError` / `SIGINT` exits with code 130. Generic errors suggest `bun install -g superserve`.

---

## Build & Distribution

### Compile Script (`scripts/build.ts`)
```typescript
const targets = [
  "bun-linux-x64",
  "bun-linux-x64-baseline",
  "bun-linux-arm64",
  "bun-darwin-x64",
  "bun-darwin-arm64",
  "bun-windows-x64",
]
// Each target: bun build --compile --target=${target} --outfile=dist/superserve-${target}[.exe] src/index.ts
```

### Distribution Channels
1. **bun** — `bun install -g superserve` (runs directly via Bun shebang)
2. **Standalone binary** — `bun build --compile` produces self-contained executables
3. **brew** — `brew install superserve-ai/tap/superserve` (planned)
4. **curl** — `curl -fsSL https://superserve.ai/install.sh | sh` (planned)
5. **GitHub Releases** — binary downloads per platform (planned)

---

## Tests

Using `bun test` (44 tests across 8 files):

- `tests/utils/format.test.ts` — formatDuration, formatElapsed, formatSize, formatTimestamp
- `tests/utils/sanitize.test.ts` — ANSI escape sequence stripping
- `tests/api/auth.test.ts` — Credential file format, missing file, corrupted JSON
- `tests/api/client.test.ts` — PlatformAPIError construction, ERROR_HINTS
- `tests/api/streaming.test.ts` — SSE parser (single/multiple/chunked/multiline/empty/invalid events)
- `tests/commands/deploy.test.ts` — Config validation (valid, missing name/command/file, secrets+ignore)
- `tests/commands/run.test.ts` — Stream event processing
- `tests/commands/login.test.ts` — OAuth error type handling

---

## Implementation Notes

- **TypeScript strict mode** throughout
- **Functional style** — API client and spinner use factory functions with closures, not classes. `PlatformAPIError` is the only class (extending `Error` requires it).
- **Minimal dependencies** — Bun provides fetch, file I/O, spawn, sleep natively
- **Two rendering modes** keep the CLI fast for simple commands (no React overhead) while powering the chat TUI
- **Agent name→ID resolution** is cached within a client instance lifetime
- **Session ID prefix resolution** allows users to use short IDs (e.g., `abc123` instead of full UUIDs)

---

## Reference Material

- **Existing Python SDK**: Included in this repo for reference
- **OpenTUI docs**: https://opentui.com/docs/getting-started
- **OpenTUI GitHub**: https://github.com/anomalyco/opentui
- **OpenCode** (reference TUI app built on OpenTUI): https://github.com/anomalyco/opencode
- **Superserve docs**: https://docs.superserve.ai
- **Bun compile docs**: https://bun.sh/docs/bundler/executables
