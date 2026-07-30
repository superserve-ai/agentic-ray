import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach, beforeEach, vi } from "vitest"

// Silence console.error/warn in tests — the error-path tests intentionally
// trigger catch blocks that call console.error in the source code.
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// Stub environment variables used by supabase clients + api proxy
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co"
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key"
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key"
process.env.NEXT_PUBLIC_WEBSITE_URL = "https://www.superserve.ai"
process.env.NEXT_PUBLIC_APP_URL = "https://console.superserve.ai"
process.env.SANDBOX_API_URL = "https://api.test.superserve.ai"
process.env.INTERNAL_API_TOKEN = "test-internal-api-token"
process.env.NEXT_PUBLIC_SANDBOX_HOST = "sandbox.test.superserve.ai"
process.env.CONSOLE_PROXY_SECRET =
  "test-secret-must-be-at-least-thirty-two-chars-long-abcdef"
