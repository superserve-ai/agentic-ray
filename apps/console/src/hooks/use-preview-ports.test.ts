import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { listPreviewPorts, publishPreviewPort, unpublishPreviewPort } =
  vi.hoisted(() => ({
    listPreviewPorts: vi.fn(),
    publishPreviewPort: vi.fn(),
    unpublishPreviewPort: vi.fn(),
  }))

vi.mock("@/lib/api/sandboxes", () => ({
  listSandboxPreviewPorts: listPreviewPorts,
  publishSandboxPreviewPort: publishPreviewPort,
  unpublishSandboxPreviewPort: unpublishPreviewPort,
}))

import {
  isValidPreviewPort,
  MAX_PREVIEW_PORT,
  MAX_PREVIEW_PORTS,
  MIN_PREVIEW_PORT,
  usePreviewPorts,
} from "./use-preview-ports"

const SANDBOX_ID = "sbx-1"

describe("isValidPreviewPort", () => {
  it("pins the port range to the SDK / edge-proxy contract", () => {
    expect(MIN_PREVIEW_PORT).toBe(1024)
    expect(MAX_PREVIEW_PORT).toBe(65535)
  })

  it("accepts integers within [MIN, MAX]", () => {
    expect(isValidPreviewPort(MIN_PREVIEW_PORT)).toBe(true)
    expect(isValidPreviewPort(3000)).toBe(true)
    expect(isValidPreviewPort(MAX_PREVIEW_PORT)).toBe(true)
  })

  it("rejects privileged, out-of-range, and non-integer ports", () => {
    expect(isValidPreviewPort(80)).toBe(false)
    expect(isValidPreviewPort(MIN_PREVIEW_PORT - 1)).toBe(false)
    expect(isValidPreviewPort(MAX_PREVIEW_PORT + 1)).toBe(false)
    expect(isValidPreviewPort(3000.5)).toBe(false)
  })
})

describe("usePreviewPorts", () => {
  beforeEach(() => {
    listPreviewPorts.mockReset()
    listPreviewPorts.mockResolvedValue({
      preview_access: "public",
      ports: [],
    })
    publishPreviewPort.mockReset()
    publishPreviewPort.mockImplementation((_id: string, port: number) =>
      Promise.resolve({ port, token_version: 1, access: "public" }),
    )
    unpublishPreviewPort.mockReset()
    unpublishPreviewPort.mockResolvedValue(undefined)
  })

  it("loads published ports and policy from the server", async () => {
    listPreviewPorts.mockResolvedValue({
      preview_access: "private",
      ports: [
        { port: 3000, token_version: 2, access: "private" },
        { port: 8080, token_version: 1, access: "public" },
      ],
    })
    const { result } = renderHook(() =>
      usePreviewPorts(SANDBOX_ID, "legacy_public"),
    )

    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.ports).toEqual([
      { port: 3000, token_version: 2, access: "private" },
      { port: 8080, token_version: 1, access: "public" },
    ])
    expect(result.current.previewAccess).toBe("private")
    expect(listPreviewPorts).toHaveBeenCalledWith(SANDBOX_ID)
  })

  it("publishes a valid port before adding it locally", async () => {
    const { result } = renderHook(() => usePreviewPorts(SANDBOX_ID, "public"))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let response: Awaited<ReturnType<typeof result.current.addPort>>
    await act(async () => {
      response = await result.current.addPort(3000)
    })

    expect(response!.ok).toBe(true)
    expect(publishPreviewPort).toHaveBeenCalledWith(SANDBOX_ID, 3000, undefined)
    expect(result.current.ports).toEqual([
      { port: 3000, token_version: 1, access: "public" },
    ])
  })

  it("rejects invalid and duplicate ports without a request", async () => {
    listPreviewPorts.mockResolvedValue({
      preview_access: "public",
      ports: [{ port: 3000, token_version: 1, access: "public" }],
    })
    const { result } = renderHook(() => usePreviewPorts(SANDBOX_ID, "public"))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(result.current.addPort(80)).resolves.toMatchObject({
      ok: false,
    })
    await expect(result.current.addPort(3000)).resolves.toEqual({
      ok: false,
      error: "Port 3000 is already published.",
    })
    expect(publishPreviewPort).not.toHaveBeenCalled()
  })

  it("enforces the published-port cap", async () => {
    listPreviewPorts.mockResolvedValue({
      preview_access: "public",
      ports: Array.from({ length: MAX_PREVIEW_PORTS }, (_, index) => ({
        port: MIN_PREVIEW_PORT + index,
        token_version: 1,
        access: "public" as const,
      })),
    })
    const { result } = renderHook(() => usePreviewPorts(SANDBOX_ID, "public"))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.canAddPort).toBe(false)
    await expect(result.current.addPort(60000)).resolves.toMatchObject({
      ok: false,
    })
    expect(publishPreviewPort).not.toHaveBeenCalled()
  })

  it("unpublishes a port before removing it locally", async () => {
    listPreviewPorts.mockResolvedValue({
      preview_access: "public",
      ports: [{ port: 3000, token_version: 1, access: "public" }],
    })
    const { result } = renderHook(() => usePreviewPorts(SANDBOX_ID, "public"))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      expect(await result.current.removePort(3000)).toEqual({ ok: true })
    })
    expect(unpublishPreviewPort).toHaveBeenCalledWith(SANDBOX_ID, 3000)
    expect(result.current.ports).toEqual([])
  })

  it("keeps local state unchanged when publication fails", async () => {
    publishPreviewPort.mockRejectedValue(new Error("offline"))
    const { result } = renderHook(() => usePreviewPorts(SANDBOX_ID, "public"))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let response: Awaited<ReturnType<typeof result.current.addPort>>
    await act(async () => {
      response = await result.current.addPort(3000)
    })
    expect(response!).toMatchObject({ ok: false })
    expect(result.current.ports).toEqual([])
  })

  it("does not apply a stale response after the sandbox id changes", async () => {
    let resolveFirst!: (value: {
      preview_access: "public"
      ports: { port: number; token_version: number; access: "public" }[]
    }) => void
    listPreviewPorts
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
      )
      .mockResolvedValueOnce({
        preview_access: "public",
        ports: [{ port: 8080, token_version: 1, access: "public" }],
      })

    const { result, rerender } = renderHook(
      ({ id }) => usePreviewPorts(id, "public"),
      { initialProps: { id: "sbx-a" } },
    )
    rerender({ id: "sbx-b" })
    await waitFor(() =>
      expect(result.current.ports).toEqual([
        { port: 8080, token_version: 1, access: "public" },
      ]),
    )

    resolveFirst({
      preview_access: "public",
      ports: [{ port: 3000, token_version: 1, access: "public" }],
    })
    await act(async () => Promise.resolve())
    expect(result.current.ports).toEqual([
      { port: 8080, token_version: 1, access: "public" },
    ])
  })
})
