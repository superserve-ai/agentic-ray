import { fileURLToPath } from "node:url"

import tsconfigPaths from "vite-tsconfig-paths"
import { defineConfig } from "vitest/config"

export default defineConfig({
  // The Cursor guide's helpers live outside this package and import
  // `@superserve/sdk` by name; resolve that to the SDK source like the tests do.
  resolve: {
    alias: {
      "@superserve/sdk": fileURLToPath(
        new URL("../../packages/sdk/src/index.ts", import.meta.url),
      ),
    },
  },

  // `vite-tsconfig-paths` reads tsconfig.json `paths` and handles the
  // `.js` → `.ts` rewrite inside the SDK source so Vite can resolve
  // `export { X } from "./Client.js"` back to `./Client.ts`. Without it,
  // Vitest can't load @superserve/sdk from source.
  plugins: [tsconfigPaths()],

  test: {
    // Network ops against a live sandbox platform are slow. Individual
    // tests get up to a minute; hooks that wait for pause/resume state
    // transitions get longer.
    testTimeout: 60_000,
    hookTimeout: 120_000,

    // Run test files serially to avoid racing on sandbox creation/deletion
    // quotas against the same environment. Individual tests within a file
    // still run in order too (vitest default).
    sequence: {
      concurrent: false,
    },

    include: ["tests/**/*.test.ts"],
    reporters: ["default"],
  },
})
