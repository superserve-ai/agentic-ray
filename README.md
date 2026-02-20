<div align="center">
  <br/>
  <br/>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/superserve-ai/superserve/main/assets/logo-dark.svg">
    <img src="https://raw.githubusercontent.com/superserve-ai/superserve/main/assets/logo-light.svg">
  </picture>

  <br/>
  <br/>

  <p><strong>Deploy AI agents to sandboxed cloud containers. One command, no infrastructure config.</strong></p>

  [![Docs](https://img.shields.io/badge/Docs-latest-blue)](https://docs.superserve.ai/)
  [![License](https://img.shields.io/badge/License-OCVSAL_1.0-blue.svg)](https://github.com/superserve-ai/superserve/blob/main/LICENSE)
  [![Python](https://img.shields.io/badge/python-3.12+-blue.svg)](https://python.org)
  [![Discord](https://img.shields.io/badge/Discord-Join%20Us-5865F2?logo=discord&logoColor=white)](https://discord.gg/utftfhSK)

</div>

## Features

- **Sandboxed execution** — Every agent runs in a gVisor-isolated container with its own compute, filesystem, and network
- **Persistent workspace** — Storage that survives restarts. Agents pick up where they left off
- **Encrypted secrets** — API keys are encrypted and injected at runtime. Values are never exposed
- **Real-time streaming** — Stream tokens and tool calls as they happen
- **Sub-second cold starts** — Pre-provisioned containers mean your agent starts almost instantly
- **Built for Claude Agent SDK** — Write with the [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview), deploy with Superserve

## Quick Start

```bash
pip install superserve
superserve login
```

Initialize from the root of your project where your dependencies and agent code live:

```bash
superserve init
```

This creates a `superserve.yaml`:

```yaml
name: my-agent
command: python main.py  # edit to match your agent's start command
```

Deploy:

```bash
superserve deploy
```

Set your secrets:

```bash
superserve secrets set my-agent ANTHROPIC_API_KEY=sk-ant-...
```

Run your agent:

```bash
superserve run my-agent
```

```
You > What is the capital of France?

Agent > The capital of France is Paris.

Completed in 1.2s

You > And what's its population?

Agent > Paris has approximately 2.1 million people in the city proper.

Completed in 0.8s
```

## CLI Reference

| Command | Description |
|---------|-------------|
| `superserve login` | Authenticate with Superserve |
| `superserve init` | Generate `superserve.yaml` for your project |
| `superserve deploy` | Deploy your agent |
| `superserve run AGENT` | Run an interactive session |
| `superserve secrets set AGENT KEY=VALUE` | Set encrypted environment variables |
| `superserve secrets list AGENT` | List secret key names |
| `superserve agents list` | List deployed agents |
| `superserve agents get AGENT` | Get agent details |
| `superserve agents delete AGENT` | Delete an agent |
| `superserve sessions list` | List sessions |

See the full [CLI Reference](https://docs.superserve.ai/cli) for all flags and options.

## Requirements

- Python 3.12+
- A [Superserve account](https://console.superserve.ai)

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](https://github.com/superserve-ai/superserve/blob/main/CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the Open Core Ventures Source Available License (OCVSAL) 1.0 - see the [LICENSE](https://github.com/superserve-ai/superserve/blob/main/LICENSE) file for details.

---

If you find Superserve useful, please consider giving us a star!
