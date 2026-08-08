/**
 * `sandbox_computer` — drive a GUI desktop sandbox: screenshot, mouse,
 * keyboard, scroll. One action per call, mirroring the action vocabulary
 * computer-use models are trained on, so an agent loop needs zero glue code.
 *
 * Input actions return a fresh screenshot by default (`screenshot_after`),
 * collapsing the model's act-then-look turn into one tool call.
 */

import type { DesktopAction, MouseButton } from "@superserve/sdk"
import { z } from "zod"

import type { SandboxClient } from "../client.js"
import { formatSdkError } from "../lib/errors.js"
import { toolError, toolOk } from "../lib/result.js"
import type { CallToolResult, McpServer } from "../lib/sdk.js"
import { defineTool } from "../lib/tool.js"

/** Local wait cap — `wait` exists for UI settling, not scheduling. */
const MAX_WAIT_MS = 10_000

/**
 * Pause before a post-action screenshot so the application has repainted.
 * ponytail: fixed settle delay; replace with server-side changed-frame
 * detection when it lands.
 */
const SETTLE_MS = 300

const COMPUTER_ACTIONS = [
  "screenshot",
  "left_click",
  "right_click",
  "middle_click",
  "double_click",
  "triple_click",
  "left_click_drag",
  "left_mouse_down",
  "left_mouse_up",
  "mouse_move",
  "key",
  "type",
  "scroll",
  "wait",
  "resize",
  "stream_url",
] as const

type ComputerAction = (typeof COMPUTER_ACTIONS)[number]

interface ComputerArgs {
  sandbox_id: string
  action: ComputerAction
  coordinate?: [number, number]
  start_coordinate?: [number, number]
  text?: string
  scroll_direction?: "up" | "down" | "left" | "right"
  scroll_amount?: number
  duration_ms?: number
  width?: number
  height?: number
  screenshot_after?: boolean
}

const CLICK_BUTTONS: Partial<Record<ComputerAction, MouseButton>> = {
  left_click: "left",
  right_click: "right",
  middle_click: "middle",
}

function need<T>(value: T | undefined, what: string, action: string): T {
  if (value === undefined) {
    throw new Error(`${action} requires ${what}`)
  }
  return value
}

/** Lower one tool call into the SDK's batch-action shape. */
function toDesktopActions(args: ComputerArgs): DesktopAction[] {
  const action = args.action
  const coord = () => {
    const [x, y] = need(args.coordinate, "coordinate [x, y]", action)
    return { x, y }
  }
  switch (action) {
    case "left_click":
    case "right_click":
    case "middle_click":
      return [{ type: "click", ...coord(), button: CLICK_BUTTONS[action] }]
    case "double_click":
      return [{ type: "doubleClick", ...coord() }]
    case "triple_click": {
      const c = coord()
      return [
        { type: "click", ...c },
        { type: "click", ...c },
        { type: "click", ...c },
      ]
    }
    case "left_click_drag": {
      const [sx, sy] = need(
        args.start_coordinate,
        "start_coordinate [x, y]",
        action,
      )
      const { x, y } = coord()
      return [
        { type: "mouseDown", x: sx, y: sy },
        { type: "move", x, y },
        { type: "mouseUp", x, y },
      ]
    }
    case "left_mouse_down":
      return [{ type: "mouseDown", ...coord() }]
    case "left_mouse_up":
      return [{ type: "mouseUp", ...coord() }]
    case "mouse_move":
      return [{ type: "move", ...coord() }]
    case "key":
      return [{ type: "press", key: need(args.text, "text", action) }]
    case "type":
      return [{ type: "write", text: need(args.text, "text", action) }]
    case "scroll": {
      const direction = need(args.scroll_direction, "scroll_direction", action)
      const amount = args.scroll_amount ?? 3
      const scroll: DesktopAction = {
        type: "scroll",
        dx: direction === "left" ? -amount : direction === "right" ? amount : 0,
        dy: direction === "up" ? -amount : direction === "down" ? amount : 0,
      }
      // With a coordinate, position the pointer first — scroll targets
      // whatever is under it.
      return args.coordinate ? [{ type: "move", ...coord() }, scroll] : [scroll]
    }
    default:
      throw new Error(`${action} is not an input action`)
  }
}

function screenshotResult(
  shot: { data: Uint8Array; width: number; height: number },
  note: string,
): CallToolResult {
  return {
    content: [
      { type: "text", text: `${note} (${shot.width}x${shot.height})` },
      {
        type: "image",
        data: Buffer.from(shot.data).toString("base64"),
        mimeType: "image/png",
      },
    ],
    structuredContent: { width: shot.width, height: shot.height },
  }
}

export function registerComputerTool(
  server: McpServer,
  client: SandboxClient,
): void {
  defineTool<ComputerArgs>(
    server,
    "sandbox_computer",
    {
      title: "Control a desktop sandbox (computer use)",
      description:
        "Drive a GUI desktop in a Superserve sandbox (requires a desktop template, e.g. superserve/desktop): " +
        "capture screenshots and send mouse/keyboard input. One action per call. " +
        "Input actions return a fresh screenshot of the result by default. " +
        "Screen coordinates are [x, y] pixels with the origin at the top-left. " +
        "Paused sandboxes are resumed automatically.",
      inputSchema: {
        sandbox_id: z.string().describe("ID of the desktop sandbox."),
        action: z
          .enum(COMPUTER_ACTIONS)
          .describe(
            "screenshot: capture the screen. " +
              "left_click / right_click / middle_click / double_click / triple_click: click at `coordinate`. " +
              "left_click_drag: drag from `start_coordinate` to `coordinate`. " +
              "left_mouse_down / left_mouse_up: press/release at `coordinate`. " +
              "mouse_move: move the pointer to `coordinate`. " +
              "key: press a key or chord from `text` (e.g. 'Return', 'ctrl+s'). " +
              "type: type the literal `text`. " +
              "scroll: scroll `scroll_direction` by `scroll_amount` clicks (optionally at `coordinate`). " +
              "wait: pause `duration_ms` for the UI to settle. " +
              "resize: set the display to `width` x `height`. " +
              "stream_url: get a live browser viewer URL for the desktop.",
          ),
        coordinate: z
          .tuple([z.number().int().min(0), z.number().int().min(0)])
          .optional()
          .describe("[x, y] target pixel for pointer actions."),
        start_coordinate: z
          .tuple([z.number().int().min(0), z.number().int().min(0)])
          .optional()
          .describe("[x, y] drag origin (left_click_drag only)."),
        text: z
          .string()
          .optional()
          .describe("Key/chord for `key`, literal text for `type`."),
        scroll_direction: z.enum(["up", "down", "left", "right"]).optional(),
        scroll_amount: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Scroll wheel clicks (default 3)."),
        duration_ms: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(`Wait duration in ms (clamped to ${MAX_WAIT_MS}).`),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        screenshot_after: z
          .boolean()
          .optional()
          .describe(
            "Return a screenshot after input actions (default true). " +
              "Set false when batching several actions back-to-back.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const { sandbox_id, action } = args
      try {
        switch (action) {
          case "screenshot":
            return screenshotResult(
              await client.desktopScreenshot(sandbox_id),
              "screenshot",
            )
          case "wait": {
            const ms = Math.min(args.duration_ms ?? 1000, MAX_WAIT_MS)
            // Local sleep — never a round trip to the sandbox.
            await new Promise((resolve) => setTimeout(resolve, ms))
            return toolOk(`waited ${ms}ms`, { waited_ms: ms })
          }
          case "resize": {
            const width = need(args.width, "width", action)
            const height = need(args.height, "height", action)
            await client.desktopResize(sandbox_id, width, height)
            return toolOk(`resized to ${width}x${height}`, { width, height })
          }
          case "stream_url": {
            const url = await client.desktopStreamUrl(sandbox_id)
            return toolOk(url, { url })
          }
          default: {
            await client.desktopActions(sandbox_id, toDesktopActions(args))
            if (args.screenshot_after === false) {
              return toolOk(`${action} done`, { action })
            }
            await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
            return screenshotResult(
              await client.desktopScreenshot(sandbox_id),
              `${action} done`,
            )
          }
        }
      } catch (e) {
        return toolError(formatSdkError(e))
      }
    },
  )
}
