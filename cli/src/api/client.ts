import { getCredentials } from "../config/auth"
import {
  DEFAULT_TIMEOUT,
  PLATFORM_API_URL,
  USER_AGENT,
} from "../config/constants"
import { PlatformAPIError, toUserMessage } from "./errors"
import { parseSSEStream } from "./streaming"
import type {
  AgentResponse,
  Credentials,
  DeviceCodeResponse,
  DeviceTokenPollResponse,
  RunEvent,
  SessionData,
} from "./types"

export type SuperserveClient = ReturnType<typeof createClient>

export function createClient(
  baseUrl = PLATFORM_API_URL,
  timeout = DEFAULT_TIMEOUT,
) {
  const normalizedUrl = baseUrl.replace(/\/+$/, "")
  const agentNameCache = new Map<string, string>()
  let cachedToken: string | null = null

  function getHeaders(authenticated = true): Record<string, string> {
    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
    }
    if (authenticated) {
      if (!cachedToken) {
        const creds = getCredentials()
        if (!creds) {
          throw new PlatformAPIError(
            401,
            "Not authenticated. Run `superserve login` first.",
          )
        }
        cachedToken = creds.token
      }
      headers.Authorization = `Bearer ${cachedToken}`
    }
    return headers
  }

  async function request(
    method: string,
    endpoint: string,
    options: {
      json?: unknown
      formData?: FormData
      params?: Record<string, string>
      stream?: boolean
      authenticated?: boolean
    } = {},
  ): Promise<Response> {
    const {
      json,
      formData,
      params,
      stream = false,
      authenticated = true,
    } = options

    let url = `${normalizedUrl}/v1${endpoint}`
    if (params) {
      const searchParams = new URLSearchParams(params)
      url += `?${searchParams.toString()}`
    }

    const headers = getHeaders(authenticated)

    // Remove Content-Type for FormData (browser sets it with boundary)
    if (formData) {
      delete headers["Content-Type"]
    }

    const controller = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    if (!stream) {
      timeoutId = setTimeout(() => controller.abort(), timeout)
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: formData ?? (json ? JSON.stringify(json) : undefined),
        signal: controller.signal,
      })

      if (timeoutId) clearTimeout(timeoutId)

      if (response.status >= 400) {
        // Invalidate cached token on auth failure
        if (response.status === 401) {
          cachedToken = null
        }

        let errorData: Record<string, unknown> = {}
        try {
          errorData = (await response.json()) as Record<string, unknown>
        } catch {}

        let detail = (errorData.detail ?? errorData.message) as unknown
        if (detail && typeof detail !== "string") {
          detail = JSON.stringify(detail)
        }

        const rawMessage = (detail as string) ?? response.statusText
        throw new PlatformAPIError(
          response.status,
          toUserMessage(response.status, rawMessage),
          (errorData.details as Record<string, unknown>) ?? undefined,
        )
      }

      return response
    } catch (e) {
      if (timeoutId) clearTimeout(timeoutId)

      if (e instanceof PlatformAPIError) throw e

      if (e instanceof DOMException && e.name === "AbortError") {
        throw new PlatformAPIError(0, "Request timed out")
      }
      if (
        e instanceof TypeError &&
        (e.message.includes("fetch") || e.message.includes("connect"))
      ) {
        throw new PlatformAPIError(0, "Cannot connect to Superserve API")
      }
      throw new PlatformAPIError(0, "Network request failed")
    }
  }

  async function safeJson<T>(response: Response): Promise<T> {
    try {
      return (await response.json()) as T
    } catch {
      throw new PlatformAPIError(
        response.status,
        "Unexpected response from server. Please try again.",
      )
    }
  }

  // ==================== AUTH ====================

  async function validateToken(): Promise<boolean> {
    try {
      const resp = await request("GET", "/auth/validate")
      const data = await safeJson<{ valid?: boolean }>(resp)
      return Boolean(data.valid)
    } catch {
      return false
    }
  }

  async function getDeviceCode(): Promise<DeviceCodeResponse> {
    const resp = await request("POST", "/auth/device-code", {
      authenticated: false,
    })
    return safeJson<DeviceCodeResponse>(resp)
  }

  async function pollDeviceToken(deviceCode: string): Promise<Credentials> {
    const resp = await request("POST", "/auth/device-token", {
      json: { device_code: deviceCode },
      authenticated: false,
    })
    const data = await safeJson<DeviceTokenPollResponse>(resp)

    if ("error" in data) {
      const error = data.error
      if (error === "authorization_pending") {
        throw new PlatformAPIError(428, "Authorization pending", {
          oauth_error: "authorization_pending",
        })
      }
      if (error === "slow_down") {
        throw new PlatformAPIError(400, "Slow down", {
          oauth_error: "slow_down",
        })
      }
      if (error === "expired_token") {
        throw new PlatformAPIError(410, "Device code expired", {
          oauth_error: "expired_token",
        })
      }
      if (error === "access_denied") {
        throw new PlatformAPIError(403, "Access denied by user", {
          oauth_error: "access_denied",
        })
      }
      throw new PlatformAPIError(400, "Authentication failed. Please try again.")
    }

    const token = data.access_token ?? data.token
    if (!token) {
      throw new PlatformAPIError(
        500,
        "Invalid response from auth server: missing token.",
      )
    }

    return {
      token,
      expires_at: data.expires_at,
      refresh_token: data.refresh_token,
    }
  }

  // ==================== AGENTS ====================

  async function deployAgent(
    name: string,
    command: string,
    config: Record<string, unknown>,
    tarballPath: string,
  ): Promise<AgentResponse> {
    const file = Bun.file(tarballPath)
    const formData = new FormData()
    formData.append("file", file, "agent.tar.gz")
    formData.append("name", name)
    formData.append("command", command)
    formData.append("config", JSON.stringify(config))

    const resp = await request("POST", "/agents", { formData })
    return safeJson<AgentResponse>(resp)
  }

  async function listAgents(): Promise<AgentResponse[]> {
    const resp = await request("GET", "/agents")
    const data = await safeJson<{ agents?: AgentResponse[] }>(resp)
    return data.agents ?? []
  }

  async function resolveAgentId(nameOrId: string): Promise<string> {
    if (nameOrId.startsWith("agt_")) return nameOrId

    const cached = agentNameCache.get(nameOrId)
    if (cached) return cached

    const agents = await listAgents()
    for (const agent of agents) {
      agentNameCache.set(agent.name, agent.id)
    }

    const resolved = agentNameCache.get(nameOrId)
    if (resolved) return resolved

    throw new PlatformAPIError(404, `Agent '${nameOrId}' not found`)
  }

  async function getAgent(nameOrId: string): Promise<AgentResponse> {
    const agentId = await resolveAgentId(nameOrId)
    const resp = await request("GET", `/agents/${agentId}`)
    return safeJson<AgentResponse>(resp)
  }

  async function deleteAgent(nameOrId: string): Promise<void> {
    const agentId = await resolveAgentId(nameOrId)
    await request("DELETE", `/agents/${agentId}`)

    for (const [name, id] of agentNameCache) {
      if (id === agentId) {
        agentNameCache.delete(name)
        break
      }
    }
  }

  // ==================== ID RESOLUTION ====================

  async function resolveId(
    entityId: string,
    prefix: string,
    endpoint: string,
    entityName: string,
  ): Promise<string> {
    const clean = entityId.replace(`${prefix}_`, "").replace(/-/g, "")

    if (clean.length >= 32) {
      if (!entityId.startsWith(`${prefix}_`)) {
        return `${prefix}_${entityId}`
      }
      return entityId
    }

    const resp = await request("GET", endpoint, {
      params: { id_prefix: clean },
    })
    const data = await safeJson<{ ids?: string[] }>(resp)
    const ids = data.ids ?? []

    if (ids.length === 0) {
      throw new PlatformAPIError(
        404,
        `No ${entityName} found matching '${entityId}'`,
      )
    }
    if (ids.length > 1) {
      const shortIds = ids.map((i) =>
        i.replace(`${prefix}_`, "").replace(/-/g, "").slice(0, 12),
      )
      throw new PlatformAPIError(
        409,
        `Ambiguous ID '${entityId}' \u2014 matches: ${shortIds.join(", ")}`,
      )
    }
    return ids[0]
  }

  async function resolveSessionId(sessionId: string): Promise<string> {
    return resolveId(sessionId, "ses", "/sessions/resolve", "session")
  }

  // ==================== SECRETS ====================

  async function getAgentSecrets(nameOrId: string): Promise<string[]> {
    const agentId = await resolveAgentId(nameOrId)
    const resp = await request("GET", `/agents/${agentId}/secrets`)
    const data = await safeJson<{ keys?: string[] }>(resp)
    return data.keys ?? []
  }

  async function setAgentSecrets(
    nameOrId: string,
    secrets: Record<string, string>,
  ): Promise<string[]> {
    const agentId = await resolveAgentId(nameOrId)
    const resp = await request("PATCH", `/agents/${agentId}/secrets`, {
      json: { secrets },
    })
    const data = await safeJson<{ keys?: string[] }>(resp)
    return data.keys ?? []
  }

  async function deleteAgentSecret(
    nameOrId: string,
    key: string,
  ): Promise<string[]> {
    const agentId = await resolveAgentId(nameOrId)
    const resp = await request("DELETE", `/agents/${agentId}/secrets/${key}`)
    const data = await safeJson<{ keys?: string[] }>(resp)
    return data.keys ?? []
  }

  // ==================== SESSIONS ====================

  async function createSession(
    agentNameOrId: string,
    title?: string,
    idleTimeoutSeconds = 30 * 24 * 60 * 60, // 30 days
  ): Promise<SessionData> {
    const agentId = await resolveAgentId(agentNameOrId)
    const resp = await request("POST", "/sessions", {
      json: {
        agent_id: agentId,
        title,
        idle_timeout_seconds: idleTimeoutSeconds,
      },
    })
    return safeJson<SessionData>(resp)
  }

  async function listSessions(
    agentId?: string,
    status?: string,
    limit = 20,
  ): Promise<SessionData[]> {
    const params: Record<string, string> = { limit: String(limit) }
    if (agentId) params.agent_id = await resolveAgentId(agentId)
    if (status) params.status = status
    const resp = await request("GET", "/sessions", { params })
    const data = await safeJson<{ sessions?: SessionData[] }>(resp)
    return data.sessions ?? []
  }

  async function getSession(sessionId: string): Promise<SessionData> {
    const resolved = await resolveSessionId(sessionId)
    const resp = await request("GET", `/sessions/${resolved}`)
    return safeJson<SessionData>(resp)
  }

  async function endSession(sessionId: string): Promise<SessionData> {
    const resolved = await resolveSessionId(sessionId)
    const resp = await request("POST", `/sessions/${resolved}/end`)
    return safeJson<SessionData>(resp)
  }

  async function* streamSessionMessage(
    sessionId: string,
    prompt: string,
  ): AsyncIterableIterator<RunEvent> {
    const resp = await request("POST", `/sessions/${sessionId}/messages`, {
      json: { prompt },
      stream: true,
    })
    yield* parseSSEStream(resp)
  }

  return {
    validateToken,
    getDeviceCode,
    pollDeviceToken,
    deployAgent,
    listAgents,
    getAgent,
    deleteAgent,
    getAgentSecrets,
    setAgentSecrets,
    deleteAgentSecret,
    createSession,
    listSessions,
    getSession,
    endSession,
    streamSessionMessage,
  }
}
