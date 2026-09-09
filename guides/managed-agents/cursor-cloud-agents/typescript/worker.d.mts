// Type declarations for worker.mjs, so TypeScript callers (the repo's e2e
// suite) get a typed surface without the guide itself needing a build step.
import type { Sandbox, SandboxInfo } from "@superserve/sdk"

export const META_MANAGED: "cursor.managed"
export const META_WORKER_ID: "cursor.worker_id"
export const META_POOL: "cursor.pool"
export const META_REQUEST_ID: "cursor.request_id"
export const META_REPO: "cursor.repo"
export const STATE_DIR: "/var/lib/cursor-worker"

export const config: {
  templateName: string
  idleReleaseTimeout: string
  cloneGitRepos: boolean
  hibernate: boolean
  autoDeleteSeconds: number
  allowOut: string[]
  cursorEndpoint: string
}

export interface WorkerState {
  state: "running" | "exited" | "dead" | "no_pidfile" | "unknown"
  pid: number | null
  exit_code: number | null
}

export type LaunchResult =
  | { ok: true; pid: number; state: WorkerState }
  | { ok: false; state: WorkerState; log: string }

export interface PendingRequest {
  id: string
  claimedWorkerId?: string
  wakeTimeoutMs?: number
  [key: string]: unknown
}

export function workerCommand(pool: string): string
export function workerEnv(opts: {
  workerId: string
  workerName?: string
}): Record<string, string>
export function workerState(sandbox: Sandbox): Promise<WorkerState>
export function stopWorker(sandbox: Sandbox): Promise<void>
export function readLog(sandbox: Sandbox): Promise<string>
export function launchWorker(
  sandbox: Sandbox,
  opts: { pool: string; env: Record<string, string>; command?: string },
): Promise<LaunchResult>
export function findSandboxForWorker(
  workerId: string,
): Promise<SandboxInfo | null>
export function releaseClaim(requestId: string): Promise<unknown>
export function listPendingRequests(pool?: string): Promise<PendingRequest[]>
