import type {
  ConnectionOptions,
  Sandbox,
  SandboxCreateOptions,
  SandboxInfo,
  SandboxListOptions,
} from "@superserve/sdk"

import type { GUEST_WORKSPACE, SESSION_ENTRY_VERSION } from "./constants.js"

export type SandboxHandle = Pick<
  Sandbox,
  | "id"
  | "name"
  | "status"
  | "metadata"
  | "commands"
  | "files"
  | "getInfo"
  | "pause"
  | "resume"
  | "kill"
>

export interface SandboxProvider {
  create(options: SandboxCreateOptions): Promise<SandboxHandle>
  connect(
    sandboxId: string,
    options?: ConnectionOptions,
  ): Promise<SandboxHandle>
  list(options?: SandboxListOptions): Promise<SandboxInfo[]>
  killById(sandboxId: string, options?: ConnectionOptions): Promise<void>
}

export type SandboxBindingState =
  | "provisioning"
  | "attaching"
  | "active"
  | "paused"
  | "missing"
  | "destroyed"

export interface SandboxBinding {
  version: typeof SESSION_ENTRY_VERSION
  ownerSessionId: string
  clientId: string
  bindingId: string
  state: SandboxBindingState
  managed: boolean
  sandboxId?: string
  workspacePath: typeof GUEST_WORKSPACE
  guestHome?: string
  template?: string
  timeoutSeconds?: number
  autoDeleteSeconds?: number
  sync: "tracked" | "none"
  createdAt: string
  updatedAt: string
}

export interface ActiveSandbox {
  sandbox: SandboxHandle
  binding: SandboxBinding
  guestHome: string
}

export interface SandboxRuntimeOptions {
  template: string
  timeoutSeconds: number
  autoDeleteSeconds: number | undefined
  sync: "tracked" | "none"
}

export interface SandboxBootstrapOptions {
  localCwd: string
  sync: "tracked" | "none"
  uploadWorkspace: boolean
  signal?: AbortSignal
}

export interface SandboxBootstrapResult {
  guestHome: string
  syncedFiles: number
  syncedBytes: number
}

export type SandboxBootstrap = (
  sandbox: SandboxHandle,
  options: SandboxBootstrapOptions,
) => Promise<SandboxBootstrapResult>
