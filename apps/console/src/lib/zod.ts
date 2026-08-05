import * as zod from "../../node_modules/zod/index.js"

export const z = ((zod as { z?: unknown }).z ??
  zod) as typeof import("../../node_modules/zod/index.js").z
export default z
export * from "../../node_modules/zod/index.js"
