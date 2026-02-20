import { spinnerConfig } from "../config/theme"
import { formatElapsed } from "./format"

const FRAMES = spinnerConfig.frames
const INTERVAL = spinnerConfig.interval

export type Spinner = ReturnType<typeof createSpinner>

export function createSpinner(
  options: { showElapsed?: boolean; indent?: number } = {},
) {
  const showElapsed = options.showElapsed ?? false
  const prefix = " ".repeat(options.indent ?? 0)

  let text = ""
  let running = false
  let timer: ReturnType<typeof setInterval> | null = null
  let startTime = 0
  let frameIdx = 0

  function start(initialText = ""): void {
    text = initialText
    if (running) return
    running = true
    startTime = performance.now()
    frameIdx = 0

    timer = setInterval(() => {
      if (!running) return
      const frame = FRAMES[frameIdx % FRAMES.length]
      let line = `\r\x1b[K${prefix}${frame} ${text}`
      if (showElapsed) {
        const elapsed = (performance.now() - startTime) / 1000
        line += ` \x1b[2m${formatElapsed(elapsed)}\x1b[0m`
      }
      process.stderr.write(line)
      frameIdx++
    }, INTERVAL)
  }

  function update(newText: string): void {
    text = newText
  }

  function stop(): void {
    running = false
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    process.stderr.write("\r\x1b[K")
  }

  function done(symbol = "\u2713", suffix = ""): void {
    running = false
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    let line = `\r\x1b[K${prefix}${symbol} ${text}`
    if (suffix) line += ` ${suffix}`
    process.stderr.write(`${line}\n`)
  }

  function fail(suffix = ""): void {
    done("\u2717", suffix)
  }

  return { start, update, stop, done, fail }
}
