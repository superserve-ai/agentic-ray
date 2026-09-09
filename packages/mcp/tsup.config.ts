import { defineConfig } from "tsup"

// Executables (bins). The `http` library entry is built separately by
// `tsup.http.config.ts` (chained after this in the `build` script) so that only
// these executables get a shebang — a leading `#!` breaks some bundlers when the
// `http` file is imported by the console / edge runtimes.
export default defineConfig((options) => ({
  entry: { index: "src/index.ts", httpServer: "src/httpServer.ts" },
  format: ["esm"],
  target: "node18",
  platform: "node",
  // No d.ts: generating declarations would type-check the entire MCP SDK
  // surface (multi-minute), and these are executables.
  dts: false,
  sourcemap: true,
  clean: !options.watch,
  // Shebang so the published bins are directly executable via npx.
  banner: { js: "#!/usr/bin/env node" },
}))
