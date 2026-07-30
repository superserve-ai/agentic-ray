import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { createAdminClient } from "@/lib/supabase/admin"

// Cell registry. Each region ("cell") runs a full stack: its own Supabase
// project for team-scoped data and its own control-plane API. Auth stays on
// the global Supabase project, so this registry only covers admin (service
// role) access and API routing.
//
// A cell is offered only when its env vars are present. Without the
// SUPABASE_USWEST_* vars the registry collapses to the single default cell
// and every code path behaves exactly like the single-cell console.

export const DEFAULT_REGION = "use"

export interface Cell {
  region: string
  apiBaseUrl: string
  createAdminClient(): SupabaseClient
}

// The default cell reuses the existing admin client and SANDBOX_API_URL so
// nothing changes for code paths that only ever touch "use".
function defaultCell(): Cell {
  return {
    region: DEFAULT_REGION,
    apiBaseUrl: process.env.SANDBOX_API_URL ?? "https://api.superserve.ai",
    createAdminClient,
  }
}

// One client per credential set, reused across calls — a fresh client per
// call would bypass HTTP agent reuse and risk socket exhaustion under load.
// Keyed by url+key (not a singleton) so tests that swap env, and future key
// rotations, get a matching client instead of a stale one.
const clientCache = new Map<string, SupabaseClient>()

function cachedClient(url: string, serviceRoleKey: string): SupabaseClient {
  const cacheKey = `${url}\n${serviceRoleKey}`
  let client = clientCache.get(cacheKey)
  if (!client) {
    client = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    clientCache.set(cacheKey, client)
  }
  return client
}

function uswCell(): Cell | null {
  const url = process.env.SUPABASE_USWEST_URL
  const serviceRoleKey = process.env.SUPABASE_USWEST_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) return null

  return {
    region: "usw",
    apiBaseUrl:
      process.env.SANDBOX_API_URL_USWEST ?? "https://api-usw.superserve.ai",
    createAdminClient: () => cachedClient(url, serviceRoleKey),
  }
}

// Env is read per call (not at module load) so a cell can be enabled without
// touching code, and tests can toggle configuration.
function configuredCells(): Cell[] {
  const usw = uswCell()
  return usw ? [defaultCell(), usw] : [defaultCell()]
}

export function configuredRegions(): string[] {
  return configuredCells().map((cell) => cell.region)
}

export function cellFor(region: string): Cell {
  const cell = configuredCells().find((c) => c.region === region)
  if (!cell) throw new Error(`Region ${region} is not configured`)
  return cell
}
