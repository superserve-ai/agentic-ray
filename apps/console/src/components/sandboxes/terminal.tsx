"use client"

import { ClipboardAddon } from "@xterm/addon-clipboard"
import { FitAddon } from "@xterm/addon-fit"
import { ImageAddon } from "@xterm/addon-image"
import { SearchAddon } from "@xterm/addon-search"
import { SerializeAddon } from "@xterm/addon-serialize"
import { Unicode11Addon } from "@xterm/addon-unicode11"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { WebglAddon } from "@xterm/addon-webgl"
import { Terminal } from "@xterm/xterm"
import { usePostHog } from "posthog-js/react"
import { useCallback, useEffect, useRef, useState } from "react"

import { TERMINAL_EVENTS } from "@/lib/posthog/events"
import { sandboxHostFor } from "@/lib/sandbox-host"
import {
  clearTerminalBuffer,
  loadTerminalBuffer,
  loadTerminalFontSize,
  saveTerminalBuffer,
  saveTerminalFontSize,
  TERMINAL_FONT_SIZE_DEFAULT,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
} from "@/lib/terminal-tabs-storage"

import "@xterm/xterm/css/xterm.css"

export type TerminalConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error"

const encoder = new TextEncoder()
const TERMINAL_SUBPROTOCOL = "superserve.terminal.v1"
const RESIZE_DEBOUNCE_MS = 75
const RECONNECT_BASE_MS = 500
const RECONNECT_MAX_MS = 10_000
const RECONNECT_MAX_ATTEMPTS = 10
const SERIALIZE_SCROLLBACK_LINES = 1000
const MIN_TERMINAL_COLS = 2
const MIN_TERMINAL_ROWS = 1
const TERMINAL_LINE_HEIGHT = 1.12
const TERMINAL_LETTER_SPACING = 0
const TERMINAL_FONT_FAMILY_FALLBACK =
  '"Geist Mono", "SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace'

function usableFontFamily(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed === "inherit" || trimmed.includes("var(")) {
    return null
  }
  return trimmed
}

function resolveTerminalFontFamily(container: HTMLElement): string {
  // xterm's DOM renderer can inherit CSS variables, but the canvas/WebGL
  // renderers need a concrete font-family string for measurement + glyph
  // atlas generation. Resolve Tailwind/next-font variables before handing the
  // value to xterm; otherwise the browser can fall back to a tiny default font
  // while xterm still reserves the wider fallback cell size.
  const computed = window.getComputedStyle(container)
  const computedFamily = usableFontFamily(computed.fontFamily)
  if (computedFamily)
    return `${computedFamily}, ${TERMINAL_FONT_FAMILY_FALLBACK}`

  const scopedMono = usableFontFamily(computed.getPropertyValue("--mono-font"))
  if (scopedMono) return `${scopedMono}, ${TERMINAL_FONT_FAMILY_FALLBACK}`

  const rootMono = usableFontFamily(
    window
      .getComputedStyle(document.documentElement)
      .getPropertyValue("--mono-font"),
  )
  if (rootMono) return `${rootMono}, ${TERMINAL_FONT_FAMILY_FALLBACK}`

  return TERMINAL_FONT_FAMILY_FALLBACK
}

// Once WebGL fails to construct or loses its context, we skip it for every
// future terminal in this page session — matches VS Code / superset-sh.
let suggestedRenderer: "webgl" | "dom" | undefined

interface Props {
  sandboxId: string
  accessToken: string
  /**
   * Whether this terminal is the foreground tab. When true, the component
   * focuses xterm on connect and refits whenever it becomes active (the
   * container may have been hidden while inactive, leaving xterm with stale
   * dimensions). Defaults to true so single-tab usage is unchanged.
   */
  isActive?: boolean
  /**
   * Stable identifier used to persist scrollback across reloads. When set,
   * the terminal restores its buffer on mount and serializes on unmount.
   * Leave undefined to opt out.
   */
  bufferKey?: string
  /**
   * Called whenever the WebSocket lifecycle status changes. Used by the
   * multi-tab container to surface a status indicator per tab.
   */
  onStatusChange?: (status: TerminalConnectionStatus) => void
}

export function SandboxTerminal({
  sandboxId,
  accessToken,
  isActive = true,
  bufferKey,
  onStatusChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const webglRef = useRef<WebglAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const serializeRef = useRef<SerializeAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const isMountedRef = useRef(true)
  const isActiveRef = useRef(isActive)
  const bufferKeyRef = useRef(bufferKey)
  const posthog = usePostHog()
  const posthogRef = useRef(posthog)
  const onStatusChangeRef = useRef(onStatusChange)
  const [status, setStatus] = useState<TerminalConnectionStatus>("connecting")
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange
  }, [onStatusChange])

  useEffect(() => {
    onStatusChangeRef.current?.(status)
  }, [status])

  useEffect(() => {
    posthogRef.current = posthog
  }, [posthog])

  useEffect(() => {
    isActiveRef.current = isActive
  }, [isActive])

  useEffect(() => {
    bufferKeyRef.current = bufferKey
  }, [bufferKey])

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
  }, [])

  const sendResize = useCallback((term: Terminal) => {
    const ws = wsRef.current
    if (ws?.readyState !== WebSocket.OPEN) return

    const cols = Math.floor(term.cols)
    const rows = Math.floor(term.rows)
    if (cols < MIN_TERMINAL_COLS || rows < MIN_TERMINAL_ROWS) return

    ws.send(
      JSON.stringify({
        type: "resize",
        cols,
        rows,
      }),
    )
  }, [])

  const connectWebSocket = useCallback(
    (term: Terminal) => {
      clearReconnectTimer()
      wsRef.current?.close(1000, "reconnect")
      setStatus("connecting")

      try {
        const url = `wss://boxd-${sandboxId}.${sandboxHostFor(sandboxId)}/terminal`
        const ws = new WebSocket(url, [
          TERMINAL_SUBPROTOCOL,
          `token.${accessToken}`,
        ])
        ws.binaryType = "arraybuffer"
        wsRef.current = ws

        ws.onopen = () => {
          if (wsRef.current !== ws) return
          setStatus("connected")
          reconnectAttemptsRef.current = 0
          posthogRef.current.capture(TERMINAL_EVENTS.SESSION_STARTED, {
            sandbox_id: sandboxId,
          })
          sendResize(term)
          if (isActiveRef.current) term.focus()
        }

        ws.onmessage = (evt) => {
          if (wsRef.current !== ws) return
          if (typeof evt.data === "string") return
          term.write(new Uint8Array(evt.data))
        }

        ws.onerror = () => {
          if (wsRef.current !== ws) return
          term.write("\r\n\x1b[31m[connection error]\x1b[0m\r\n")
          setStatus("error")
        }

        ws.onclose = (evt) => {
          if (wsRef.current !== ws) return
          posthogRef.current.capture(TERMINAL_EVENTS.SESSION_ENDED, {
            sandbox_id: sandboxId,
            close_code: evt.code,
          })
          const closeReason = evt.reason?.trim() ?? ""
          const reasonSuffix = closeReason ? `: ${closeReason}` : ""
          const label =
            evt.code === 1000
              ? "\x1b[33m[session ended]\x1b[0m"
              : evt.code === 1001
                ? "\x1b[33m[sandbox going away]\x1b[0m"
                : evt.code === 1006
                  ? "\x1b[31m[connection lost]\x1b[0m"
                  : evt.code === 1011
                    ? `\x1b[31m[server error${reasonSuffix}]\x1b[0m`
                    : `\x1b[31m[disconnected: ${evt.code}${reasonSuffix}]\x1b[0m`
          term.write(`\r\n${label}\r\n`)
          setStatus("disconnected")

          // Auto-reconnect on abnormal closes. Code 1000 / 1001 are
          // intentional and stay disconnected until the user reconnects.
          const shouldRetry =
            isMountedRef.current && evt.code !== 1000 && evt.code !== 1001
          if (!shouldRetry) return
          if (reconnectAttemptsRef.current >= RECONNECT_MAX_ATTEMPTS) return

          const attempt = reconnectAttemptsRef.current
          const delay = Math.min(
            RECONNECT_BASE_MS * 2 ** attempt,
            RECONNECT_MAX_MS,
          )
          reconnectAttemptsRef.current = attempt + 1
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null
            if (!isMountedRef.current) return
            connectWebSocket(term)
          }, delay)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error"
        term.write(`\r\n\x1b[31m[error: ${message}]\x1b[0m\r\n`)
        setStatus("error")
      }
    },
    [sandboxId, accessToken, clearReconnectTimer, sendResize],
  )

  // Initialize terminal once on mount
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    isMountedRef.current = true

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      cursorInactiveStyle: "outline",
      fontFamily: resolveTerminalFontFamily(container),
      fontSize: loadTerminalFontSize(),
      fontWeight: 400,
      fontWeightBold: 600,
      lineHeight: TERMINAL_LINE_HEIGHT,
      letterSpacing: TERMINAL_LETTER_SPACING,
      minimumContrastRatio: 4.5,
      // Stop macOS Option from inserting diacritics into pastes/keystrokes.
      macOptionIsMeta: true,
      // Required by Unicode11Addon + vtExtensions.
      allowProposedApi: true,
      scrollback: 5000,
      // Kitty keyboard protocol — lets TUIs (Codex, Claude Code, opencode)
      // distinguish Shift+Enter / Ctrl+Enter from a bare Enter submit. Cast
      // to support the `vtExtensions` field which is in xterm 6.x but not yet
      // in @xterm/xterm@6.0.0 typings.
      ...({ vtExtensions: { kittyKeyboard: true } } as object),
      theme: {
        background: "#0a0a0a",
        foreground: "#e5e5e5",
        cursor: "#e5e5e5",
        selectionBackground: "#525252",
      },
    })

    // Order matters: Unicode11 must be activated before measuring any cells.
    const unicode11 = new Unicode11Addon()
    term.loadAddon(unicode11)
    term.unicode.activeVersion = "11"

    term.loadAddon(new ClipboardAddon())
    term.loadAddon(new ImageAddon())

    const searchAddon = new SearchAddon()
    term.loadAddon(searchAddon)
    searchRef.current = searchAddon

    term.loadAddon(new WebLinksAddon())

    // Ligatures are a pure enhancement; the addon's package.json has a broken
    // `main` field, so we dynamic-import it to avoid breaking SSR / tests, and
    // wrap construction in try/catch in case the runtime can't initialize it.
    import("@xterm/addon-ligatures")
      .then(({ LigaturesAddon }) => {
        if (!isMountedRef.current) return
        try {
          term.loadAddon(new LigaturesAddon())
        } catch {
          // Ligatures are optional — silently skip.
        }
      })
      .catch(() => {
        // Package failed to resolve at runtime — skip ligatures.
      })

    const serializeAddon = new SerializeAddon()
    term.loadAddon(serializeAddon)
    serializeRef.current = serializeAddon

    const fit = new FitAddon()
    term.loadAddon(fit)

    term.open(container)
    fit.fit()
    termRef.current = term
    fitRef.current = fit

    // Re-measure once Next/font finishes loading. Without this, xterm can
    // measure with the fallback font and keep a too-wide cell grid after Geist
    // Mono swaps in, which makes glyphs look tiny and overly spaced out.
    let fontReadyCancelled = false
    const refitAfterFontLoad = () => {
      if (fontReadyCancelled || !isMountedRef.current) return
      const rect = container.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      term.options.fontFamily = resolveTerminalFontFamily(container)
      term.options.lineHeight = TERMINAL_LINE_HEIGHT
      term.options.letterSpacing = TERMINAL_LETTER_SPACING
      try {
        fit.fit()
        term.refresh(0, term.rows - 1)
      } catch {
        // Terminal already disposed or hidden at an odd size.
      }
      sendResize(term)
    }
    const fontsReady = document.fonts?.ready
    if (fontsReady) {
      void fontsReady.then(refitAfterFontLoad).catch(() => {
        // Font loading is best-effort; the fallback stack is still usable.
      })
    }

    // WebGL is loaded one frame late so the post-open viewport sync settles
    // first — eager loading was the source of the "rendering issues" that
    // caused us to rip WebGL out previously. Context loss falls back to DOM
    // and is sticky for the rest of the session.
    let webglRafId: number | null = null
    if (suggestedRenderer !== "dom") {
      webglRafId = requestAnimationFrame(() => {
        webglRafId = null
        if (!isMountedRef.current || suggestedRenderer === "dom") return
        try {
          const webgl = new WebglAddon()
          webgl.onContextLoss(() => {
            try {
              webgl.dispose()
            } catch {
              // Already disposed.
            }
            webglRef.current = null
            suggestedRenderer = "dom"
            // Force a clean DOM repaint — without this, the buffer goes blank.
            try {
              term.refresh(0, term.rows - 1)
            } catch {
              // Terminal already disposed.
            }
          })
          term.loadAddon(webgl)
          webglRef.current = webgl
        } catch {
          suggestedRenderer = "dom"
        }
      })
    }

    // Restore previous scrollback before the WebSocket opens, so the user
    // sees their context immediately. The callback chains the WS connect so
    // restore writes complete before live output starts streaming in.
    const savedBuffer = bufferKeyRef.current
      ? loadTerminalBuffer(bufferKeyRef.current)
      : null
    if (savedBuffer) {
      term.write(savedBuffer, () => {
        if (isMountedRef.current) connectWebSocket(term)
      })
    } else {
      connectWebSocket(term)
    }

    // Forward keystrokes
    term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(encoder.encode(data))
      }
    })

    // Cmd+F / Ctrl+F opens the search overlay; Cmd+= / Cmd+- / Cmd+0 zoom.
    const applyFontSize = (size: number) => {
      const clamped = Math.min(
        TERMINAL_FONT_SIZE_MAX,
        Math.max(TERMINAL_FONT_SIZE_MIN, size),
      )
      term.options.fontSize = clamped
      saveTerminalFontSize(clamped)
      try {
        fit.fit()
        term.refresh(0, term.rows - 1)
      } catch {
        // Ignore — FitAddon can throw on weird dimensions.
      }
      sendResize(term)
    }
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true
      const modifier = event.metaKey || event.ctrlKey
      if (!modifier) return true

      const key = event.key.toLowerCase()
      if (key === "f") {
        event.preventDefault()
        setSearchOpen(true)
        requestAnimationFrame(() => searchInputRef.current?.focus())
        return false
      }
      // `=` shares a key with `+` on most layouts — accept both.
      if (key === "=" || key === "+") {
        event.preventDefault()
        const current =
          (term.options.fontSize as number | undefined) ??
          TERMINAL_FONT_SIZE_DEFAULT
        applyFontSize(current + 1)
        return false
      }
      if (key === "-" || key === "_") {
        event.preventDefault()
        const current =
          (term.options.fontSize as number | undefined) ??
          TERMINAL_FONT_SIZE_DEFAULT
        applyFontSize(current - 1)
        return false
      }
      if (key === "0") {
        event.preventDefault()
        applyFontSize(TERMINAL_FONT_SIZE_DEFAULT)
        return false
      }
      return true
    })

    // Resize handling — debounced, with 0×0 guard so hidden tabs don't
    // resize the remote shell down to nothing.
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect || rect.width === 0 || rect.height === 0) return
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
      resizeTimerRef.current = setTimeout(() => {
        try {
          fit.fit()
        } catch {
          return
        }
        sendResize(term)
      }, RESIZE_DEBOUNCE_MS)
    })
    ro.observe(container)
    roRef.current = ro

    // Persist scrollback on hard page unload too — useEffect cleanup doesn't
    // run on browser tab close / refresh.
    const handlePageHide = () => {
      const key = bufferKeyRef.current
      if (!key || !serializeRef.current) return
      try {
        const data = serializeRef.current.serialize({
          scrollback: SERIALIZE_SCROLLBACK_LINES,
        })
        saveTerminalBuffer(key, data)
      } catch {
        // Best-effort.
      }
    }
    window.addEventListener("pagehide", handlePageHide)

    return () => {
      isMountedRef.current = false
      fontReadyCancelled = true
      if (webglRafId !== null) cancelAnimationFrame(webglRafId)
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
      clearReconnectTimer()
      window.removeEventListener("pagehide", handlePageHide)
      ro.disconnect()
      wsRef.current?.close(1000, "unmount")

      // Serialize scrollback for next mount.
      const key = bufferKeyRef.current
      if (key && serializeRef.current) {
        try {
          const data = serializeRef.current.serialize({
            scrollback: SERIALIZE_SCROLLBACK_LINES,
          })
          saveTerminalBuffer(key, data)
        } catch {
          // Best-effort.
        }
      }

      try {
        webglRef.current?.dispose()
      } catch {
        // Already disposed.
      }
      webglRef.current = null
      searchRef.current = null
      serializeRef.current = null
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [connectWebSocket, clearReconnectTimer, sendResize])

  const isForegroundTerminal = isActive

  // When this terminal becomes the foreground tab, refit and focus.
  useEffect(() => {
    if (!isForegroundTerminal) return
    const term = termRef.current
    const fit = fitRef.current
    const container = containerRef.current
    if (!term || !fit || !container) return
    const rafId = requestAnimationFrame(() => {
      const rect = container.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) {
        term.focus()
        return
      }
      try {
        fit.fit()
      } catch {
        // FitAddon can throw if dimensions aren't sensible — skip.
      }
      sendResize(term)
      term.focus()
    })
    return () => cancelAnimationFrame(rafId)
  }, [isForegroundTerminal, sendResize])

  // Image-paste fallback for agent TUIs (Codex, Claude Code, opencode).
  // Bracketed paste sends `\x1b[200~\x1b[201~` for clipboards that contain
  // only a file — the TUI sees empty content and does nothing. Forwarding
  // a raw Ctrl+V (\x16) lets the TUI handle the image through its own
  // paste handler. We capture before xterm so its paste interception
  // doesn't fire first.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onPaste = (event: ClipboardEvent) => {
      const data = event.clipboardData
      if (!data) return
      const hasFile = data.files.length > 0
      const hasText = data.types.includes("text/plain")
      if (!hasFile || hasText) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(encoder.encode("\x16"))
      }
    }
    container.addEventListener("paste", onPaste, true)
    return () => container.removeEventListener("paste", onPaste, true)
  }, [])

  const handleReconnect = () => {
    const term = termRef.current
    if (!term) return
    reconnectAttemptsRef.current = 0
    posthogRef.current.capture(TERMINAL_EVENTS.RECONNECTED, {
      sandbox_id: sandboxId,
    })
    connectWebSocket(term)
  }

  const handleClearBuffer = useCallback(() => {
    const key = bufferKeyRef.current
    if (key) clearTerminalBuffer(key)
    termRef.current?.clear()
  }, [])

  const findNext = (query: string) => {
    if (!query) return
    searchRef.current?.findNext(query, { regex: false, caseSensitive: false })
  }
  const findPrevious = (query: string) => {
    if (!query) return
    searchRef.current?.findPrevious(query, {
      regex: false,
      caseSensitive: false,
    })
  }

  return (
    <div className="superserve-terminal relative flex h-full flex-col bg-background p-2">
      <div ref={containerRef} className="h-full w-full font-mono" />

      {searchOpen && (
        <div className="absolute top-4 right-4 flex items-center gap-1 border border-dashed border-border bg-surface p-1 shadow-lg">
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Find"
            aria-label="Search terminal"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                if (e.shiftKey) findPrevious(searchQuery)
                else findNext(searchQuery)
              } else if (e.key === "Escape") {
                e.preventDefault()
                setSearchOpen(false)
                setSearchQuery("")
                termRef.current?.focus()
              }
            }}
            className="w-48 bg-transparent px-2 py-1 font-mono text-xs text-foreground outline-none placeholder:text-muted"
          />
          <button
            type="button"
            onClick={() => findPrevious(searchQuery)}
            aria-label="Previous match"
            className="cursor-pointer px-1.5 py-1 font-mono text-xs text-muted uppercase hover:text-foreground"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => findNext(searchQuery)}
            aria-label="Next match"
            className="cursor-pointer px-1.5 py-1 font-mono text-xs text-muted uppercase hover:text-foreground"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchOpen(false)
              setSearchQuery("")
              termRef.current?.focus()
            }}
            aria-label="Close search"
            className="cursor-pointer px-1.5 py-1 font-mono text-xs text-muted uppercase hover:text-foreground"
          >
            ✕
          </button>
        </div>
      )}

      {status === "connecting" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="animate-pulse font-mono text-xs text-muted">
            Connecting...
          </span>
        </div>
      )}
      {(status === "disconnected" || status === "error") && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 p-4">
          <button
            type="button"
            onClick={handleReconnect}
            className="border border-dashed border-border bg-surface px-3 py-1.5 font-mono text-xs text-foreground uppercase hover:bg-surface-hover"
          >
            Reconnect
          </button>
          {bufferKey && (
            <button
              type="button"
              onClick={handleClearBuffer}
              className="border border-dashed border-border bg-surface px-3 py-1.5 font-mono text-xs text-muted uppercase hover:bg-surface-hover hover:text-foreground"
            >
              Clear scrollback
            </button>
          )}
        </div>
      )}
    </div>
  )
}
