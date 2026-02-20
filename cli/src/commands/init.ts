import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { Command } from "commander"
import { SUPERSERVE_YAML } from "../config/constants"
import { commandBox } from "../utils/command-box"

const TEMPLATE = `\
# Superserve agent configuration
# Docs: https://docs.superserve.ai

# Agent name (lowercase, alphanumeric, hyphens only)
name: {name}

# Command to start your agent (runs inside the sandbox)
command: python main.py

{secrets_block}\
# Files and directories to exclude from upload
# ignore:
#   - .venv
#   - __pycache__
#   - .git
#   - node_modules
`

function detectEnvKeys(projectDir: string): string[] {
  const envExample = join(projectDir, ".env.example")
  if (!existsSync(envExample)) return []

  const keys: string[] = []
  const text = readFileSync(envExample, "utf-8")
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    if (line.includes("=")) {
      const key = line.split("=", 1)[0].trim()
      if (key) keys.push(key)
    }
  }
  return keys
}

export const init = new Command("init")
  .description("Initialize a new agent project")
  .option("--name <name>", "Agent name (defaults to directory name)")
  .action((options: { name?: string }) => {
    const cwd = process.cwd()
    const configPath = join(cwd, SUPERSERVE_YAML)

    if (existsSync(configPath)) {
      console.log(`${SUPERSERVE_YAML} already exists in this directory.`)
      return
    }

    let name = options.name
    if (!name) {
      const raw = basename(cwd).toLowerCase()
      name = raw.replace(/[^a-z0-9-]/g, "-")
      if (name && !/^[a-z]/.test(name)) {
        name = `agent-${name}`
      }
    }

    const envKeys = detectEnvKeys(cwd)
    let secretsBlock: string
    if (envKeys.length > 0) {
      const lines = envKeys.map((k) => `  - ${k}`).join("\n")
      secretsBlock = `# Environment variables your agent needs to run\nsecrets:\n${lines}\n\n`
    } else {
      secretsBlock =
        "# Environment variables your agent needs to run\n# secrets:\n#   - ANTHROPIC_API_KEY\n\n"
    }

    const content = TEMPLATE.replace("{name}", name).replace(
      "{secrets_block}",
      secretsBlock,
    )
    writeFileSync(configPath, content)

    console.log(`Created ${SUPERSERVE_YAML}`)
    console.log()
    console.log("Next steps:")
    console.log(
      `  1. Set 'command' in ${SUPERSERVE_YAML} to the command that starts your agent`,
    )
    console.log("     (e.g., python main.py, node index.js, ./start.sh)")
    console.log("  2. Deploy your agent:")
    console.log(commandBox("superserve deploy"))
    if (envKeys.length > 0) {
      console.log("  3. Set your secrets:")
      console.log(
        commandBox(`superserve secrets set ${name} ${envKeys[0]}=...`),
      )
    } else {
      console.log("  3. Set your API keys as secrets:")
      console.log(
        commandBox(`superserve secrets set ${name} ANTHROPIC_API_KEY=sk-...`),
      )
    }
    console.log("  4. Run your agent:")
    console.log(commandBox(`superserve run ${name} "your prompt here"`))
  })
