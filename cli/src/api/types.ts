// ==================== AUTH ====================

export interface Credentials {
  token: string
  token_type?: string
  expires_at?: string | null
  refresh_token?: string | null
}

export interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete: string
  expires_in: number
  interval: number
}

export interface TokenValidation {
  valid?: boolean
}

export type DeviceTokenPollResponse =
  | { error: string; error_description?: string }
  | {
      access_token?: string
      token?: string
      expires_at?: string
      refresh_token?: string
    }

// ==================== AGENTS ====================

export interface AgentResponse {
  id: string
  name: string
  command: string | null
  environment_keys: string[]
  required_secrets: string[]
  deps_status: string
  deps_error: string | null
  created_at: string
  updated_at: string
}

// ==================== SESSIONS ====================

export interface SessionData {
  id: string
  agent_id: string
  agent_name?: string
  status: string
  title?: string
  message_count: number
  created_at: string
}

// ==================== SECRETS ====================

export interface SecretKeysResponse {
  keys?: string[]
}

// ==================== ID RESOLUTION ====================

export interface ResolveIdsResponse {
  ids?: string[]
}

// ==================== RUN EVENTS (discriminated union) ====================

export type RunEvent =
  | { type: "message.delta"; data: { content?: string } }
  | { type: "tool.start"; data: { tool?: string; input?: unknown } }
  | { type: "tool.end"; data: { duration_ms?: number } }
  | {
      type: "run.completed"
      data: {
        duration_ms?: number
        max_turns_reached?: boolean
        max_turns_message?: string
      }
    }
  | { type: "run.failed"; data: { error?: { message?: string } } }
  | { type: "run.cancelled"; data: Record<string, unknown> }
  | { type: "status"; data: Record<string, unknown> }
  | { type: "run.started"; data: Record<string, unknown> }
  | { type: "heartbeat"; data: Record<string, unknown> }

// ==================== PROJECT CONFIG ====================

export interface ProjectConfig {
  name: string
  command: string
  secrets?: string[]
  ignore?: string[]
  [key: string]: unknown
}
