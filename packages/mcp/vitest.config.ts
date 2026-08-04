import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

const rootDir = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      "@superserve/sdk": resolve(rootDir, "../sdk/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
})
