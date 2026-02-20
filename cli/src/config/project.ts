import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import yaml from "js-yaml"
import type { ProjectConfig } from "../api/types"
import { SUPERSERVE_YAML } from "./constants"

export type { ProjectConfig }

export function loadProjectConfig(
  projectDir: string = process.cwd(),
): ProjectConfig {
  const configPath = join(projectDir, SUPERSERVE_YAML)

  if (!existsSync(configPath)) {
    throw new Error(
      `${SUPERSERVE_YAML} not found in current directory.\nRun \`superserve init\` to create one.`,
    )
  }

  let raw: unknown
  try {
    const text = readFileSync(configPath, "utf-8")
    raw = yaml.load(text)
  } catch (e) {
    if (e instanceof Error && e.message.includes("EACCES")) {
      throw new Error(`Permission denied reading ${SUPERSERVE_YAML}.`)
    }
    throw new Error(
      `Invalid YAML in ${SUPERSERVE_YAML}. Check your syntax and try again.`,
    )
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${SUPERSERVE_YAML} must be a YAML mapping.`)
  }

  const config = raw as Record<string, unknown>

  if (!config.name || typeof config.name !== "string") {
    throw new Error(`'name' is required in ${SUPERSERVE_YAML}.`)
  }
  if (!config.command || typeof config.command !== "string") {
    throw new Error(`'command' is required in ${SUPERSERVE_YAML}.`)
  }

  return config as ProjectConfig
}
