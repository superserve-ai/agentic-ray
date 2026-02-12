<div align="center">
  <a href="https://superserve.ai/"><img width="1185" height="395" alt="Superserve" src="https://raw.githubusercontent.com/superserve-ai/agentic-ray/main/assets/superserve-logo-light-transparent.svg" /></a>

  <p><strong>CLI for hosted agent infrastructure.</strong></p>

  [![Docs](https://img.shields.io/badge/Docs-latest-blue)](https://docs.superserve.ai/)
  [![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://github.com/superserve-ai/agentic-ray/blob/main/LICENSE)
  [![Python](https://img.shields.io/badge/python-3.12+-blue.svg)](https://python.org)
  [![Discord](https://img.shields.io/badge/Discord-Join%20Us-5865F2?logo=discord&logoColor=white)](https://discord.gg/utftfhSK)
  [![Slack](https://img.shields.io/badge/Slack-Join%20Us-4A154B?logo=slack&logoColor=white)](https://superserve.ai/join-slack)

</div>

## Quick Start

```bash
# Install
pip install superserve

# Authenticate
superserve login

# Create an agent
superserve agents create

# Run it
superserve run my-agent "What is 2+2?"
```

## Installation

```bash
pip install superserve
```

**Requirements:** Python 3.12+

## CLI Commands

### Authentication

```bash
superserve login          # Authenticate with Superserve
superserve logout         # Clear stored credentials
```

### Agents

```bash
superserve agents create                    # Interactive agent creation
superserve agents create --name my-agent    # Non-interactive with flags
superserve agents list                      # List all agents
superserve agents get my-agent              # Get agent details
superserve agents delete my-agent           # Delete an agent
```

### Runs

```bash
superserve run my-agent "Summarize this paper"     # Run an agent
superserve run my-agent "Follow up" --session s1   # Multi-turn session
superserve runs list                                # List recent runs
superserve runs list --agent my-agent               # Filter by agent
superserve runs get <run-id>                        # Get run details
```

### Secrets

```bash
superserve secrets list my-agent                          # List secret keys
superserve secrets set my-agent ANTHROPIC_API_KEY=sk-...  # Set a secret
superserve secrets delete my-agent ANTHROPIC_API_KEY      # Delete a secret
```

## Telemetry

Superserve collects anonymous usage data to help improve the CLI. No PII, project information, or code is collected.

To opt out:
```bash
superserve analytics off
```

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](https://github.com/superserve-ai/agentic-ray/blob/main/CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](https://github.com/superserve-ai/agentic-ray/blob/main/LICENSE) file for details.

---

If you find this project helpful, please consider giving it a star!
