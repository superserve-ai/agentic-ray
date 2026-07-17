export const GUEST_WORKSPACE = "/workspace"
export const SESSION_ENTRY_TYPE = "superserve-sandbox"
export const SESSION_ENTRY_VERSION = 1 as const
export const CREATED_BY = "@superserve/pi"
export const DEFAULT_TEMPLATE = "superserve/node-22"
export const DEFAULT_TIMEOUT_SECONDS = 3_600
export const DEFAULT_AUTO_DELETE_SECONDS = 86_400
export const DEFAULT_COMMAND_TIMEOUT_SECONDS = 600
export const MAX_COMMAND_TIMEOUT_SECONDS = 3_600
export const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024
export const MAX_FILE_READ_BYTES = 10 * 1024 * 1024
export const MAX_BRIDGE_OUTPUT_BYTES = 2 * 1024 * 1024
export const MAX_SYNC_ARCHIVE_BYTES = 100 * 1024 * 1024
export const MAX_WORKSPACE_DOWNLOAD_BYTES = 250 * 1024 * 1024
export const MAX_SYNC_FILES = 10_000
export const MAX_LS_RESULTS = 1_000
export const MAX_FIND_RESULTS = 5_000
export const MAX_GREP_RESULTS = 1_000
export const MAX_GREP_CONTEXT = 10
export const BRIDGE_PATH = "/tmp/superserve-pi-bridge-v1.mjs"
export const WORKSPACE_ARCHIVE_PATH = "/tmp/superserve-pi-workspace.tar.gz"

export const ROUTED_TOOL_NAMES = [
  "read",
  "write",
  "edit",
  "bash",
  "grep",
  "find",
  "ls",
] as const

export const ROUTED_TOOLS = new Set<string>(ROUTED_TOOL_NAMES)
