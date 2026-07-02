export const sandboxKeys = {
  all: ["sandboxes"] as const,
  lists: () => [...sandboxKeys.all, "list"] as const,
  list: (filters: { status?: string; search?: string }) =>
    [...sandboxKeys.lists(), filters] as const,
  details: () => [...sandboxKeys.all, "detail"] as const,
  detail: (id: string) => [...sandboxKeys.details(), id] as const,
}

export const fileKeys = {
  all: ["sandbox-files"] as const,
  listings: (sandboxId: string) => [...fileKeys.all, sandboxId] as const,
  listing: (sandboxId: string, path: string) =>
    [...fileKeys.listings(sandboxId), path] as const,
}

export const apiKeyKeys = {
  all: ["api-keys"] as const,
  lists: () => [...apiKeyKeys.all, "list"] as const,
  list: (filters?: { search?: string }) =>
    [...apiKeyKeys.lists(), filters] as const,
}

export const snapshotKeys = {
  all: ["snapshots"] as const,
  lists: () => [...snapshotKeys.all, "list"] as const,
  list: (filters?: { search?: string }) =>
    [...snapshotKeys.lists(), filters] as const,
  bySandbox: (sandboxId: string) =>
    [...snapshotKeys.all, "sandbox", sandboxId] as const,
}

export const auditLogKeys = {
  all: ["audit-logs"] as const,
  lists: () => [...auditLogKeys.all, "list"] as const,
  list: (filters?: { action?: string; search?: string }) =>
    [...auditLogKeys.lists(), filters] as const,
  bySandbox: (sandboxId: string) =>
    [...auditLogKeys.all, "sandbox", sandboxId] as const,
}

export const secretKeys = {
  all: ["secrets"] as const,
  lists: () => [...secretKeys.all, "list"] as const,
  list: (filters?: { search?: string }) =>
    [...secretKeys.lists(), filters ?? {}] as const,
  details: () => [...secretKeys.all, "detail"] as const,
  // Accepts undefined so disabled hooks (e.g. useSecret(undefined)) keep a
  // distinct cache key per call site instead of all aliasing to details().
  detail: (name: string | undefined) =>
    [...secretKeys.details(), name] as const,
  audit: (name: string | undefined, filters?: { status?: string }) =>
    [...secretKeys.detail(name), "audit", filters ?? {}] as const,
  sandboxes: (name: string | undefined) =>
    [...secretKeys.detail(name), "sandboxes"] as const,
}

export const providerKeys = {
  all: ["providers"] as const,
}

export const networkKeys = {
  sandbox: (sandboxId: string | undefined) =>
    ["network", "sandbox", sandboxId] as const,
}

export const billingKeys = {
  all: ["billing"] as const,
  settings: () => [...billingKeys.all, "settings"] as const,
  usage: (filters: { periodStart: string; periodEnd: string }) =>
    [...billingKeys.all, "usage", filters] as const,
}

export const templateKeys = {
  all: ["templates"] as const,
  lists: () => [...templateKeys.all, "list"] as const,
  list: (filters?: { name_prefix?: string }) =>
    [...templateKeys.lists(), filters ?? {}] as const,
  details: () => [...templateKeys.all, "detail"] as const,
  detail: (id: string) => [...templateKeys.details(), id] as const,
  builds: (templateId: string) =>
    [...templateKeys.detail(templateId), "builds"] as const,
  build: (templateId: string, buildId: string) =>
    [...templateKeys.builds(templateId), buildId] as const,
}

export const quotaKeys = {
  all: ["quota"] as const,
  usage: () => [...quotaKeys.all, "usage"] as const,
}
