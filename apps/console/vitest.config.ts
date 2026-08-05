import path from "node:path"

import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/**/*.d.ts",
        "src/app/**/layout.tsx",
        "src/app/**/loading.tsx",
        "src/app/**/error.tsx",
        "src/app/**/not-found.tsx",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      zod: path.resolve(__dirname, "./src/test/stubs/zod.ts"),
      // @xterm/addon-ligatures' package.json has a broken `main` field —
      // vitest can't resolve it even though Next.js can (via `module`).
      // We dynamic-import it in source, but vitest still scans dynamic
      // imports during dep analysis. Stub it out for tests.
      "@xterm/addon-ligatures": path.resolve(
        __dirname,
        "./src/test/stubs/xterm-ligatures.ts",
      ),
    },
  },
})
