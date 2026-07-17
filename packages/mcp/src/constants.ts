/**
 * Server identity and output-shaping limits for the Superserve MCP server.
 */

/** MCP server name advertised in the initialize handshake. */
export const SERVER_NAME = "superserve"

/**
 * Server-level `instructions` returned in the initialize handshake. Codex (and
 * other clients) surface this as server-wide guidance, so the cross-tool rules
 * that are easy to miss from individual tool descriptions live here. The first
 * paragraph is kept self-contained (~the first 512 chars) so a client that only
 * reads the head still gets the core workflow and the file-read limit.
 */
export const SERVER_INSTRUCTIONS =
  "Superserve runs code in isolated Firecracker microVMs. Get a sandbox id first — call " +
  "sandbox_create (or sandbox_list for existing ones), then pass sandbox_id to every other tool. " +
  "sandbox_exec and the file tools auto-resume a paused sandbox, so never call sandbox_resume first. " +
  "Use sandbox_pause to keep state cheaply; sandbox_kill deletes permanently. sandbox_files_read " +
  "rejects files over 1 MiB — read a slice with sandbox_exec (e.g. `head -c`) instead of a full read.\n" +
  "\n" +
  "Templates: call sandbox_template_list before passing from_template to sandbox_create; build a custom " +
  "base image with sandbox_template_create, then poll sandbox_template_list until its status is ready. " +
  "Secrets: bind stored credentials via the secrets argument on sandbox_create or sandbox_attach_secret " +
  "instead of putting raw keys in env_vars; discover them with secret_list. Network: allow_out adds allowed " +
  "destinations and deny_out blocks CIDRs (on sandbox_create or sandbox_update) — for a strict allowlist " +
  "combine allow_out with deny_out:['0.0.0.0/0']; audit egress with sandbox_network_log. Publish a listening " +
  "port and get a browser-ready link with sandbox_preview_url; private sandboxes receive an expiring signed URL."

/**
 * Server version. Kept in sync with `package.json` `version`
 * (enforced by `tests/version.test.ts`).
 */
export const SERVER_VERSION = "0.1.1"

/** Default per-command timeout when a tool call omits `timeout_ms`. */
export const DEFAULT_EXEC_TIMEOUT_MS = 60_000

/**
 * Hard ceiling on a single `sandbox_exec` command timeout (ms). A caller cannot
 * ask the hosted server to hold a request open longer than this, which would
 * otherwise tie up serverless/container concurrency until an outer timeout wins.
 */
export const MAX_EXEC_TIMEOUT_MS = 10 * 60_000

/** Cap stdout returned to the model (bytes); larger output is truncated head+tail. */
export const MAX_STDOUT_BYTES = 32 * 1024

/** Cap stderr returned to the model (bytes); larger output is truncated head+tail. */
export const MAX_STDERR_BYTES = 32 * 1024

/**
 * Hard cap on a single `sandbox_files_read` download (bytes). The SDK defaults
 * to a 2 GiB ceiling; the MCP server reads with this much smaller cap so a
 * hostile or accidental large file (logs, artifacts, archives) cannot balloon
 * the hosted, multi-tenant process memory. Files larger than this are rejected
 * with guidance to read a slice via `sandbox_exec`.
 */
export const MAX_FILE_BYTES = 1024 * 1024

/**
 * Max decoded bytes accepted by `sandbox_files_write` (inline content). Inline
 * tool-call content is for code, config, and small assets; larger transfers
 * belong on the SDK/CLI upload path, not a JSON-RPC body held in memory.
 */
export const MAX_WRITE_BYTES = 8 * 1024 * 1024

/**
 * Hard cap on a `sandbox_files_download_dir` zip (bytes). Like {@link MAX_FILE_BYTES},
 * the cap is pushed to the SDK so a hostile/large directory is rejected mid-stream
 * rather than buffered (the zip is base64-encoded into the response, so the host
 * holds ~1.33× this in memory). Directories larger than this must use the SDK/CLI
 * `files.downloadDir`.
 */
export const MAX_DOWNLOAD_DIR_BYTES = 10 * 1024 * 1024

/**
 * Max JSON-RPC request body the hosted HTTP server will buffer (bytes). Sized
 * above {@link MAX_WRITE_BYTES} (base64 expands ~4/3) so a legitimate max-size
 * write still fits, while an authenticated-but-untrusted caller cannot exhaust
 * memory with a giant body before tool validation runs.
 */
export const MAX_REQUEST_BYTES = 16 * 1024 * 1024

/** Default number of egress rows returned by `sandbox_network_log`. */
export const DEFAULT_NETWORK_LOG_LIMIT = 50

/** Hard cap on `sandbox_network_log` rows per call (bounds output + API load). */
export const MAX_NETWORK_LOG_LIMIT = 200

/**
 * Hard caps for lifecycle windows, mirroring the control-plane API limits so an
 * over-limit value is rejected at the tool boundary instead of after a round
 * trip. Keep in sync with the API (`auto_delete_seconds` ≤ 30d, `timeout_seconds`
 * ≤ 7d); the API remains the source of truth and re-validates.
 */
export const MAX_AUTO_DELETE_SECONDS = 30 * 24 * 60 * 60 // 2592000 (30 days)
export const MAX_TIMEOUT_SECONDS = 7 * 24 * 60 * 60 // 604800 (7 days)
