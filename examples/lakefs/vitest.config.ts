import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    // `*.test.ts` only -- sandbox-lifecycle.ts is a credentialed script that
    // runs against real infrastructure, not a unit test.
    include: ["tests/**/*.test.ts"],
  },
})
