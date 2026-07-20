"use client"

import { useCallback, useEffect, useState } from "react"

import { ApiError } from "@/lib/api/client"
import {
  listSandboxPreviewPorts,
  publishSandboxPreviewPort,
  unpublishSandboxPreviewPort,
} from "@/lib/api/sandboxes"
import type {
  PreviewAccess,
  PreviewAccessPolicy,
  PublishedPreviewPort,
} from "@/lib/api/types"

export const MIN_PREVIEW_PORT = 1024
export const MAX_PREVIEW_PORT = 65535
export const MAX_PREVIEW_PORTS = 12

export interface AddPortResult {
  ok: boolean
  error?: string
}

export interface UsePreviewPortsApi {
  ports: PublishedPreviewPort[]
  previewAccess: PreviewAccess
  canAddPort: boolean
  isLoading: boolean
  addPort: (
    port: number,
    access?: PreviewAccessPolicy,
  ) => Promise<AddPortResult>
  removePort: (port: number) => Promise<AddPortResult>
  setPreviewAccess: (access: PreviewAccess) => void
}

export function isValidPreviewPort(port: number): boolean {
  return (
    Number.isInteger(port) &&
    port >= MIN_PREVIEW_PORT &&
    port <= MAX_PREVIEW_PORT
  )
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

/**
 * Server-backed preview publication state. The backend is the authorization
 * source of truth; localStorage must never imply that an unpublished port is
 * reachable. The owning component is keyed by sandbox id, so request and UI
 * state cannot leak across detail-page navigation.
 */
export function usePreviewPorts(
  sandboxId: string,
  initialAccess: PreviewAccess,
): UsePreviewPortsApi {
  const [ports, setPorts] = useState<PublishedPreviewPort[]>([])
  const [previewAccess, setPreviewAccess] =
    useState<PreviewAccess>(initialAccess)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    void listSandboxPreviewPorts(sandboxId)
      .then((result) => {
        if (cancelled) return
        setPreviewAccess(result.preview_access)
        setPorts(result.ports)
      })
      .catch(() => {
        // The backend endpoint may not be deployed yet. Keep the section
        // usable for legacy sandboxes, but do not invent published ports.
        if (!cancelled) setPorts([])
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sandboxId])

  const addPort = useCallback<UsePreviewPortsApi["addPort"]>(
    async (port, access) => {
      if (!isValidPreviewPort(port)) {
        return {
          ok: false,
          error: `Enter a port between ${MIN_PREVIEW_PORT} and ${MAX_PREVIEW_PORT}.`,
        }
      }
      if (ports.some((item) => item.port === port)) {
        return { ok: false, error: `Port ${port} is already published.` }
      }
      if (ports.length >= MAX_PREVIEW_PORTS) {
        return {
          ok: false,
          error: `You can preview at most ${MAX_PREVIEW_PORTS} ports.`,
        }
      }
      try {
        const published = await publishSandboxPreviewPort(
          sandboxId,
          port,
          access,
        )
        setPorts((current) =>
          current.some((item) => item.port === published.port)
            ? current
            : [...current, published],
        )
        return { ok: true }
      } catch (error) {
        return {
          ok: false,
          error: errorMessage(error, `Could not publish port ${port}.`),
        }
      }
    },
    [ports, sandboxId],
  )

  const removePort = useCallback<UsePreviewPortsApi["removePort"]>(
    async (port) => {
      try {
        await unpublishSandboxPreviewPort(sandboxId, port)
        setPorts((current) => current.filter((item) => item.port !== port))
        return { ok: true }
      } catch (error) {
        return {
          ok: false,
          error: errorMessage(error, `Could not unpublish port ${port}.`),
        }
      }
    },
    [sandboxId],
  )

  return {
    ports,
    previewAccess,
    canAddPort: !isLoading && ports.length < MAX_PREVIEW_PORTS,
    isLoading,
    addPort,
    removePort,
    setPreviewAccess,
  }
}
