import { Sandbox } from "@superserve/sdk"

import type { SandboxProvider } from "./types.js"

export const defaultSandboxProvider: SandboxProvider = {
  create: (options) => Sandbox.create(options),
  connect: (sandboxId, options) => Sandbox.connect(sandboxId, options),
  list: (options) => Sandbox.list(options),
  killById: (sandboxId, options) => Sandbox.killById(sandboxId, options),
}
