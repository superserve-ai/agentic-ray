/**
 * PreviewSection — the per-sandbox preview surface.
 *
 * Covers the status gate, the multi-port add/validate/remove flow, copy,
 * the safe open-in-new-tab link + analytics, and the on-demand iframe.
 * URLs use the test host from src/test/setup.ts (sandbox.test.superserve.ai).
 */

import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { SandboxResponse } from "@/lib/api/types"

const {
  addToast,
  capture,
  clipboardWrite,
  listPreviewPorts,
  mintPreviewToken,
  patchSandbox,
  publishPreviewPort,
  unpublishPreviewPort,
} = vi.hoisted(() => ({
  addToast: vi.fn(),
  capture: vi.fn(),
  clipboardWrite: vi.fn(() => Promise.resolve()),
  listPreviewPorts: vi.fn(),
  mintPreviewToken: vi.fn(),
  patchSandbox: vi.fn(),
  publishPreviewPort: vi.fn(),
  unpublishPreviewPort: vi.fn(),
}))

vi.mock("@superserve/ui", () => ({
  Alert: ({ children }: { children?: React.ReactNode }) => (
    <div role="alert">{children}</div>
  ),
  cn: (...classes: Array<string | false | undefined>) =>
    classes.filter(Boolean).join(" "),
  Button: (props: React.JSX.IntrinsicElements["button"]) => (
    <button type="button" {...props} />
  ),
  // Force a text input: the component reads the draft as a string regardless,
  // and happy-dom's number input drops below-`min` values (a JSDOM-ish quirk
  // that doesn't happen in a real browser, where `min` doesn't block typing).
  Input: (props: React.JSX.IntrinsicElements["input"]) => (
    <input {...props} type="text" />
  ),
  useToast: () => ({ addToast }),
}))

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture }),
}))

// Icons render nothing so accessible names come from text / aria-label only.
vi.mock("@phosphor-icons/react", () => ({
  ArrowSquareOutIcon: () => null,
  BrowserIcon: () => null,
  CaretRightIcon: () => null,
  CopyIcon: () => null,
  LockKeyIcon: () => null,
  PlusIcon: () => null,
  TrashIcon: () => null,
}))

vi.mock("@/lib/api/sandboxes", () => ({
  listSandboxPreviewPorts: listPreviewPorts,
  mintSandboxPreviewToken: mintPreviewToken,
  patchSandbox,
  publishSandboxPreviewPort: publishPreviewPort,
  unpublishSandboxPreviewPort: unpublishPreviewPort,
}))

import { PreviewSection } from "./preview-section"

// happy-dom would otherwise fetch the iframe `src` and log an aborted-fetch
// NetworkError during cleanup; we assert on attributes, not loaded content.
const happyDOM = (
  globalThis as {
    happyDOM?: { settings: { disableIframePageLoading: boolean } }
  }
).happyDOM
if (happyDOM) {
  happyDOM.settings.disableIframePageLoading = true
}

const HOST = "sandbox.test.superserve.ai" // set in src/test/setup.ts

function makeSandbox(
  status: SandboxResponse["status"] = "active",
  id = "sbx-1",
): SandboxResponse {
  return {
    id,
    name: "my-box",
    status,
    vcpu_count: 2,
    memory_mib: 512,
    metadata: {},
    preview_access: "public",
    created_at: "2026-01-01T00:00:00.000Z",
    access_token: "tok",
  }
}

function url(port: number, id = "sbx-1"): string {
  return `https://${port}-${id}.${HOST}`
}

beforeEach(() => {
  addToast.mockClear()
  capture.mockClear()
  clipboardWrite.mockClear()
  listPreviewPorts.mockReset()
  listPreviewPorts.mockResolvedValue({
    preview_access: "public",
    ports: [],
  })
  mintPreviewToken.mockReset()
  mintPreviewToken.mockResolvedValue({
    token: "signed-token",
    port: 3000,
    header: "X-Superserve-Preview-Token",
    query_param: "superserve_preview_token",
    token_version: 1,
    preview_access: "private",
  })
  patchSandbox.mockReset()
  patchSandbox.mockResolvedValue(undefined)
  publishPreviewPort.mockReset()
  publishPreviewPort.mockImplementation((_id: string, port: number) =>
    Promise.resolve({ port, token_version: 1 }),
  )
  unpublishPreviewPort.mockReset()
  unpublishPreviewPort.mockResolvedValue(undefined)
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: clipboardWrite },
    configurable: true,
    writable: true,
  })
})

async function addPort(
  user: ReturnType<typeof userEvent.setup>,
  port: string,
): Promise<void> {
  await waitFor(() =>
    expect(screen.getByLabelText("Port to preview")).toBeEnabled(),
  )
  await user.type(screen.getByLabelText("Port to preview"), port)
  expect(screen.getByRole("button", { name: /add port/i })).toBeEnabled()
  await user.click(screen.getByRole("button", { name: /add port/i }))
}

describe("PreviewSection — inactive sandbox", () => {
  const user = userEvent.setup()

  it("shows an empty state and offers Start for a paused sandbox", async () => {
    const onStart = vi.fn()
    render(<PreviewSection sandbox={makeSandbox("paused")} onStart={onStart} />)

    expect(screen.getByText("No preview available")).toBeInTheDocument()
    expect(screen.queryByLabelText("Port to preview")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Start sandbox" }))
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it("does not offer Start for a failed sandbox", () => {
    render(<PreviewSection sandbox={makeSandbox("failed")} />)
    expect(screen.getByText("No preview available")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Start sandbox" }),
    ).not.toBeInTheDocument()
  })
})

describe("PreviewSection — active sandbox", () => {
  const user = userEvent.setup()

  it("shows the add-port form and an empty-list prompt", async () => {
    render(<PreviewSection sandbox={makeSandbox()} />)
    expect(screen.getByLabelText("Port to preview")).toBeInTheDocument()
    expect(
      await screen.findByText(/add the port your dev server runs on/i),
    ).toBeInTheDocument()
  })

  it("adds a port and renders its preview URL", async () => {
    render(<PreviewSection sandbox={makeSandbox()} />)
    await addPort(user, "3000")
    expect(screen.getByText(url(3000))).toBeInTheDocument()
    expect(screen.getByText(":3000")).toBeInTheDocument()
  })

  it("rejects an invalid (privileged) port with a toast and adds nothing", async () => {
    render(<PreviewSection sandbox={makeSandbox()} />)
    await addPort(user, "80")
    expect(addToast).toHaveBeenCalledWith(
      expect.stringContaining("between"),
      "error",
    )
    expect(screen.queryByText(url(80))).not.toBeInTheDocument()
  })

  it("rejects a duplicate port with a toast and keeps a single row", async () => {
    render(<PreviewSection sandbox={makeSandbox()} />)
    await addPort(user, "3000")
    await addPort(user, "3000")
    expect(addToast).toHaveBeenCalledWith(
      expect.stringContaining("already published"),
      "error",
    )
    expect(screen.getAllByText(url(3000))).toHaveLength(1)
  })

  it("copies the preview URL to the clipboard", async () => {
    render(<PreviewSection sandbox={makeSandbox()} />)
    await addPort(user, "3000")
    await user.click(screen.getByRole("button", { name: "Copy preview URL" }))
    expect(clipboardWrite).toHaveBeenCalledWith(url(3000))
    expect(addToast).toHaveBeenCalledWith("Preview URL copied", "success")
  })

  it("exposes a safe open-in-new-tab link and tracks the open", async () => {
    render(<PreviewSection sandbox={makeSandbox()} />)
    await addPort(user, "3000")

    const link = screen.getByRole("link", { name: "Open preview in new tab" })
    expect(link).toHaveAttribute("href", url(3000))
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
    expect(link).toHaveClass("ph-no-capture")

    await user.click(link)
    expect(capture).toHaveBeenCalledWith("sandbox_preview_opened", {
      sandbox_id: "sbx-1",
      port: 3000,
    })
  })

  it("removes a port", async () => {
    render(<PreviewSection sandbox={makeSandbox()} />)
    await addPort(user, "3000")
    await user.click(screen.getByRole("button", { name: "Remove port 3000" }))
    expect(screen.queryByText(url(3000))).not.toBeInTheDocument()
  })

  it("mounts the iframe only when a row is expanded", async () => {
    render(<PreviewSection sandbox={makeSandbox()} />)
    await addPort(user, "3000")
    expect(screen.queryByTitle("Preview of port 3000")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Expand preview" }))
    const frame = screen.getByTitle("Preview of port 3000")
    expect(frame).toHaveAttribute("src", url(3000))

    // The framed app is untrusted: it must be sandboxed, and must NOT be able
    // to navigate the console's top-level tab (phishing). This fails if anyone
    // drops the sandbox attribute or grants top-navigation.
    const sandboxAttr = frame.getAttribute("sandbox") ?? ""
    expect(sandboxAttr).toContain("allow-scripts")
    expect(sandboxAttr).not.toContain("allow-downloads")
    expect(sandboxAttr).not.toContain("allow-top-navigation")
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer")
    expect(frame).toHaveClass("ph-no-capture")
  })

  it("supports previewing several ports at once", async () => {
    render(<PreviewSection sandbox={makeSandbox()} />)
    await addPort(user, "3000")
    await addPort(user, "8080")
    expect(screen.getByText(url(3000))).toBeInTheDocument()
    expect(screen.getByText(url(8080))).toBeInTheDocument()
  })

  it("mints a signed URL for private previews without displaying the token", async () => {
    listPreviewPorts.mockResolvedValue({
      preview_access: "private",
      ports: [{ port: 3000, token_version: 1 }],
    })
    render(
      <PreviewSection
        sandbox={{ ...makeSandbox(), preview_access: "private" }}
      />,
    )

    expect(await screen.findByText(url(3000))).toBeInTheDocument()
    expect(screen.getByLabelText("Authentication required")).toBeInTheDocument()
    const link = await screen.findByRole("link", {
      name: "Open preview in new tab",
    })
    expect(link).toHaveAttribute(
      "href",
      `${url(3000)}/?superserve_preview_token=signed-token`,
    )
    expect(link).toHaveClass("ph-no-capture")
    expect(screen.queryByText(/signed-token/)).not.toBeInTheDocument()
    expect(mintPreviewToken).toHaveBeenCalledWith("sbx-1", 3000, 3600)
  })

  it("updates the preview policy from the settings toggle", async () => {
    render(<PreviewSection sandbox={makeSandbox()} />)
    await screen.findByText(/only published ports are reachable/i)
    await user.click(
      screen.getByRole("button", { name: "Require authentication" }),
    )

    expect(patchSandbox).toHaveBeenCalledWith("sbx-1", {
      preview_access: "private",
    })
    expect(addToast).toHaveBeenCalledWith(
      "Preview authentication enabled",
      "success",
    )
  })
})
