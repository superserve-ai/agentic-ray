import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// Silence console.error/warn in tests — the error-path tests intentionally
// trigger catch blocks that call console.error in the source code.
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Stub environment variables used by auth and supabase clients
process.env.NEXT_PUBLIC_ENABLE_DEV_AUTH = "true";

// Stub environment variables used by supabase clients
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.NEXT_PUBLIC_WEBSITE_URL = "https://superserve.ai";
process.env.NEXT_PUBLIC_APP_URL = "https://console.superserve.ai";
process.env.NEXT_PUBLIC_API_URL = "https://api.superserve.ai";
