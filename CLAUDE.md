# CLAUDE.md

Guidelines for working with the `ray-agents` repository.

## Purpose

This repo provides the **Superserve CLI** (`superserve` on PyPI) and SDKs (Python, TypeScript) for managing hosted agents on the Superserve platform.

The CLI authenticates users, creates/manages agents, triggers runs, and handles secrets. The SDKs provide programmatic access to the same platform API.

## Project Structure

```
src/superserve/
├── __init__.py           Package init (__version__)
├── cli/
│   ├── cli.py            Main CLI entry point (Click)
│   ├── analytics.py      Anonymous usage analytics helpers
│   ├── commands/
│   │   ├── login.py      superserve login
│   │   ├── logout.py     superserve logout
│   │   ├── agents.py     superserve agents create|list|get|delete|update
│   │   ├── run.py        superserve run <agent> <prompt>
│   │   └── secrets.py    superserve secrets set|delete|list
│   ├── platform/         Platform API client (PlatformClient)
│   ├── utils/            CLI utilities (config, auth, formatting)
│   └── templates/        Project scaffolding templates
sdk/
├── python/               Python SDK (superserve-sdk)
└── typescript/           TypeScript SDK (@superserve/sdk)
tests/
├── test_deploy_cli.py    CLI command tests
├── test_platform.py      Platform client tests
└── conftest.py           Shared fixtures
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `superserve login` | Authenticate with the Superserve platform |
| `superserve logout` | Clear stored credentials |
| `superserve agents create\|list\|get\|delete\|update` | Manage hosted agents |
| `superserve run <agent> <prompt>` | Trigger an agent run |
| `superserve runs list\|get` | View run history and results |
| `superserve secrets set\|delete\|list` | Manage agent secrets |

## Technology Stack

- **Click**: CLI framework
- **Questionary**: Interactive prompts
- **Requests**: HTTP client for platform API
- **Posthog**: Anonymous usage analytics

## Coding Style

- Use type hints for all function signatures
- Follow PEP 8 conventions
- Use descriptive variable names over comments
- Keep functions focused and single-purpose
- Use specific exception types, not bare `except:`
- Provide context in error messages

## Testing

- Use pytest with fixtures from `tests/conftest.py`
- Tests must be deterministic and reproducible
- Mock external API calls
- Test both success and error paths

## Git Commit Guidelines

- Use single-line commit messages
- Do not include "Co-Authored-By" or any AI attribution in commits
- Keep commit messages concise and descriptive
