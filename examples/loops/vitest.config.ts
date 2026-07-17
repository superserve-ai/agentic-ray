import tsconfigPaths from "vite-tsconfig-paths"
import { defineConfig } from "vitest/config"

export default defineConfig({
  // `vite-tsconfig-paths` reads tsconfig `paths` and rewrites the SDK's
  // internal `./Foo.js` specifiers back to `./Foo.ts`, so Vitest can load
  // `@superserve/sdk` from source. The loop unit tests use an in-memory fake
  // sandbox, so they need no credentials and no network.
  plugins: [tsconfigPaths()],

  test: {
    include: ["tests/**/*.test.ts"],
    reporters: ["default"],
  },
})
