#!/usr/bin/env node
import "./env.mjs"
import { ensureTemplate } from "./template.mjs"

await ensureTemplate({
  onLog: (ev) => {
    if (ev.stream !== "system") process.stdout.write(ev.text)
  },
})
