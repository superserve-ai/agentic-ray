/**
 * `sandbox.desktop` - control a GUI desktop inside a sandbox.
 *
 * Requires a desktop-enabled template (one whose image runs an X server and
 * exposes boxd's DesktopService). Every action is a single authenticated
 * data-plane RPC: a coordinate click is one round trip, a drag is one batched
 * request, and typing has no artificial per-character pacing.
 *
 * A paused sandbox is transparently resumed on first use, like `commands`
 * and `files`.
 *
 * Accessed as `sandbox.desktop.screenshot()`, `sandbox.desktop.click(x, y)`, …
 */

import { dataPlaneTarget } from "./config.js"
import { request } from "./http.js"
import { withTokenRetry } from "./tokenRetry.js"

/** @internal */
export interface DesktopDeps {
  sandboxId: string
  sandboxHost: string
  getAccessToken: () => string
  refreshActivate: () => Promise<string>
  /** Publish the noVNC port and build its public URL (from the Sandbox). */
  publishStreamPort: () => Promise<void>
  streamBaseUrl: () => string
}

const RPC_BASE = "/superserve.boxd.v1.DesktopService"

/** Port the desktop template serves noVNC (websockify) on. */
export const DESKTOP_STREAM_PORT = 6080

/**
 * Cap on a buffered screenshot RPC response. boxd caps a frame at 32 MiB of
 * PNG; base64 in the JSON envelope inflates that by 4/3.
 */
export const MAX_SCREENSHOT_RESPONSE_BYTES = 48 * 1024 * 1024

export type MouseButton = "left" | "right" | "middle"

/** One step of a `desktop.actions()` batch. */
export type DesktopAction =
  | { type: "click"; x: number; y: number; button?: MouseButton }
  | { type: "doubleClick"; x: number; y: number }
  | { type: "move"; x: number; y: number }
  | { type: "mouseDown"; x: number; y: number; button?: MouseButton }
  | { type: "mouseUp"; x: number; y: number; button?: MouseButton }
  | { type: "press"; key: string | string[] }
  | { type: "write"; text: string }
  | { type: "scroll"; dx?: number; dy?: number }

export interface Screenshot {
  /** PNG bytes. */
  data: Uint8Array
  width: number
  height: number
}

export interface StreamUrlOptions {
  /**
   * Open the viewer read-only (viewer-side flag on the noVNC client;
   * interactive control stays available to anyone else with the URL).
   */
  viewOnly?: boolean
}

/**
 * Friendly key names → X keysyms, so agent-facing code can say "enter" or
 * "ctrl". Unlisted names pass through verbatim (all X keysyms stay usable).
 */
const KEYSYMS: Record<string, string> = {
  enter: "Return",
  return: "Return",
  esc: "Escape",
  escape: "Escape",
  tab: "Tab",
  space: "space",
  backspace: "BackSpace",
  delete: "Delete",
  insert: "Insert",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  home: "Home",
  end: "End",
  pageup: "Page_Up",
  pagedown: "Page_Down",
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  shift: "shift",
  cmd: "super",
  win: "super",
  super: "super",
}

function toKeysym(key: string): string {
  return KEYSYMS[key.toLowerCase()] ?? key
}

/**
 * Split a chord into (modifiers, final key) for the KeyEvent RPC.
 * `press("ctrl+c")` and `press(["ctrl", "c"])` are equivalent.
 */
function chordParts(key: string | string[]): {
  modifiers: string[]
  key: string
} {
  const parts = (Array.isArray(key) ? key : key.split("+")).map(toKeysym)
  if (parts.length === 0 || parts.some((p) => p === "")) {
    throw new Error("press: empty key")
  }
  return { modifiers: parts.slice(0, -1), key: parts[parts.length - 1] }
}

function buttonEnum(button: MouseButton = "left"): string {
  switch (button) {
    case "left":
      return "POINTER_BUTTON_LEFT"
    case "right":
      return "POINTER_BUTTON_RIGHT"
    case "middle":
      return "POINTER_BUTTON_MIDDLE"
  }
}

function assertCoordinate(x: number, y: number): void {
  // 0 is a valid coordinate — validate with integer checks, never truthiness.
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) {
    throw new Error(`Invalid coordinates (${x}, ${y}): must be integers >= 0`)
  }
}

/** Proto-JSON shapes for the DesktopService RPCs. @internal */
type PointerEventBody = {
  x: number
  y: number
  button?: string
  action: string
}
type KeyEventBody = { key?: string; text?: string; modifiers?: string[] }
type ScrollEventBody = { dx?: number; dy?: number }
type ActionBody =
  | { pointer: PointerEventBody }
  | { key: KeyEventBody }
  | { scroll: ScrollEventBody }

function pointerBody(
  x: number,
  y: number,
  action: string,
  button?: MouseButton,
): PointerEventBody {
  assertCoordinate(x, y)
  return { x, y, button: buttonEnum(button), action }
}

function actionBody(action: DesktopAction): ActionBody {
  switch (action.type) {
    case "click":
      return {
        pointer: pointerBody(
          action.x,
          action.y,
          "POINTER_ACTION_CLICK",
          action.button,
        ),
      }
    case "doubleClick":
      return {
        pointer: pointerBody(action.x, action.y, "POINTER_ACTION_DOUBLE_CLICK"),
      }
    case "move":
      return {
        pointer: pointerBody(action.x, action.y, "POINTER_ACTION_MOVE"),
      }
    case "mouseDown":
      return {
        pointer: pointerBody(
          action.x,
          action.y,
          "POINTER_ACTION_DOWN",
          action.button,
        ),
      }
    case "mouseUp":
      return {
        pointer: pointerBody(
          action.x,
          action.y,
          "POINTER_ACTION_UP",
          action.button,
        ),
      }
    case "press": {
      const { modifiers, key } = chordParts(action.key)
      return { key: { key, modifiers } }
    }
    case "write":
      return { key: { text: action.text } }
    case "scroll":
      return { scroll: { dx: action.dx ?? 0, dy: action.dy ?? 0 } }
  }
}

export class Desktop {
  private readonly _dataPlaneBaseUrl: string
  private readonly _routingHeaders: Record<string, string>

  /** @internal */
  constructor(private readonly _deps: DesktopDeps) {
    const target = dataPlaneTarget(_deps.sandboxId, _deps.sandboxHost)
    this._dataPlaneBaseUrl = target.url
    this._routingHeaders = target.headers
  }

  /**
   * Capture the current screen as a PNG.
   *
   * One round trip; safe to call while a live stream viewer is open.
   *
   * @example
   * ```typescript
   * const shot = await sandbox.desktop.screenshot()
   * await fs.writeFile("screen.png", shot.data)
   * ```
   */
  async screenshot(): Promise<Screenshot> {
    const raw = await this._rpc<{
      image?: string
      width?: number
      height?: number
    }>("Screenshot", {}, { maxBytes: MAX_SCREENSHOT_RESPONSE_BYTES })
    if (raw.image === undefined) {
      throw new Error("Screenshot response missing image data")
    }
    return {
      data: Uint8Array.from(atob(raw.image), (c) => c.charCodeAt(0)),
      width: raw.width ?? 0,
      height: raw.height ?? 0,
    }
  }

  /** Click at (x, y). One RPC — move and click are a single action. */
  async click(
    x: number,
    y: number,
    options: { button?: MouseButton } = {},
  ): Promise<void> {
    await this._pointer(
      pointerBody(x, y, "POINTER_ACTION_CLICK", options.button),
    )
  }

  /** Double-click at (x, y). */
  async doubleClick(x: number, y: number): Promise<void> {
    await this._pointer(pointerBody(x, y, "POINTER_ACTION_DOUBLE_CLICK"))
  }

  /** Right-click at (x, y). */
  rightClick(x: number, y: number): Promise<void> {
    return this.click(x, y, { button: "right" })
  }

  /** Middle-click at (x, y). */
  middleClick(x: number, y: number): Promise<void> {
    return this.click(x, y, { button: "middle" })
  }

  /** Move the pointer to (x, y) without clicking. */
  async moveMouse(x: number, y: number): Promise<void> {
    await this._pointer(pointerBody(x, y, "POINTER_ACTION_MOVE"))
  }

  /**
   * Drag from one point to another. Executes as one atomic batch
   * (down → move → up) under the sandbox's input lock, so no other input
   * can interleave mid-drag.
   */
  async drag(
    from: [number, number],
    to: [number, number],
    options: { button?: MouseButton } = {},
  ): Promise<void> {
    await this.actions([
      { type: "mouseDown", x: from[0], y: from[1], button: options.button },
      { type: "move", x: to[0], y: to[1] },
      { type: "mouseUp", x: to[0], y: to[1], button: options.button },
    ])
  }

  /**
   * Scroll the viewport under the pointer. Positive `dy` scrolls down,
   * negative up; `dx` scrolls horizontally. Both axes in one call.
   */
  async scroll(options: { dx?: number; dy?: number }): Promise<void> {
    await this._rpc("Scroll", { dx: options.dx ?? 0, dy: options.dy ?? 0 })
  }

  /**
   * Type literal text. Fast by default — no per-character pacing, so long
   * strings land in well under a second.
   */
  async write(text: string): Promise<void> {
    if (text.length === 0) return
    await this._rpc("SendKey", { text })
  }

  /**
   * Press a key or chord: `press("enter")`, `press("ctrl+c")`,
   * `press(["ctrl", "shift", "p"])`. Friendly names (enter, esc, cmd, …)
   * map to X keysyms; unrecognized names pass through verbatim.
   */
  async press(key: string | string[]): Promise<void> {
    const { modifiers, key: finalKey } = chordParts(key)
    await this._rpc("SendKey", { key: finalKey, modifiers })
  }

  /**
   * Execute an ordered batch of actions in a single request.
   *
   * The whole batch is validated before anything runs, then executed under
   * the sandbox's input lock — no other input can interleave. Execution
   * stops at the first failing action. This is the fast path for models
   * that emit several actions per turn.
   *
   * @example
   * ```typescript
   * await sandbox.desktop.actions([
   *   { type: "click", x: 640, y: 32 },
   *   { type: "write", text: "https://example.com" },
   *   { type: "press", key: "enter" },
   * ])
   * ```
   */
  async actions(actions: DesktopAction[]): Promise<void> {
    if (actions.length === 0) return
    await this._rpc("SendActions", { actions: actions.map(actionBody) })
  }

  /**
   * Resize the virtual display. Width must be a multiple of 8 between 320
   * and 8192; height between 200 and 8192. Takes effect live — no restart.
   */
  async resize(width: number, height: number): Promise<void> {
    await this._rpc("Resize", { width, height })
  }

  /**
   * Publish the live desktop viewer (noVNC) and return its browser URL.
   *
   * The URL goes through the sandbox's preview-port access policy — under a
   * private policy, viewers also need a preview token.
   */
  async getStreamUrl(options: StreamUrlOptions = {}): Promise<string> {
    await this._deps.publishStreamPort()
    const base = this._deps.streamBaseUrl()
    const params = new URLSearchParams({ autoconnect: "1", resize: "scale" })
    if (options.viewOnly) params.set("view_only", "1")
    return `${base}/vnc.html?${params.toString()}`
  }

  private async _pointer(body: PointerEventBody): Promise<void> {
    await this._rpc("SendPointer", body)
  }

  /**
   * One unary DesktopService call, Connect JSON protocol: a plain POST of
   * proto-JSON to the procedure path. Paused sandboxes resume via the shared
   * token-retry path.
   */
  private async _rpc<T = Record<string, never>>(
    method: string,
    body: unknown,
    opts: { maxBytes?: number } = {},
  ): Promise<T> {
    const send = (token: string) =>
      request<T>({
        method: "POST",
        url: `${this._dataPlaneBaseUrl}${RPC_BASE}/${method}`,
        headers: { ...this._routingHeaders, "X-Access-Token": token },
        body,
        maxBytes: opts.maxBytes,
      })
    return withTokenRetry(this._deps, send)
  }
}
