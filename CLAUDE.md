# CLAUDE.md

This document contains shared guidelines for Claude when working with this repository, covering coding, maintenance, and documentation styles.

## Purpose of This Repository

This project provides a scalable runtime for agentic workloads, including AI agents, tool execution, MCP servers, and secure coding sandboxes. It uses Ray as the underlying distributed compute engine to schedule, parallelize, and isolate tool executions.

The goal is to make tool-heavy or multi-agent systems easy to scale across CPUs/GPUs while providing optional sandboxing (gVisor-like) for safe code execution.

## Architecture Overview

- **Ray-based Distribution**: Tool calls are executed as Ray tasks/actors, enabling automatic scaling and resource management
- **Framework Agnostic**: Works with any agent framework (Pydantic AI, LangChain, Agno) via unified `@superserve.tool` decorator
- **Sandbox Execution**: Secure code execution using Docker with gVisor runtime for isolation
- **MCP Integration**: Model Context Protocol support for structured tool communication
- **CLI Tools**: Command-line interface for agent creation, deployment, and management

## Core API

```python
import superserve
from pydantic_ai import Agent

# Unified tool decorator - works with any framework
@superserve.tool(num_cpus=1)
def search(query: str) -> str:
    """Search the web."""
    return f"Results for {query}"

# Create agent with your preferred framework
agent = Agent("openai:gpt-4", tools=[search])

# Serve via HTTP with Ray Serve
superserve.serve(agent, name="myagent", num_cpus=1, memory="2GB")
```

Run with `superserve up` or `python agents/myagent/agent.py`.

## Key Concepts

- A "tool call" maps to a Ray task/actor, enabling distributed execution
- `@superserve.tool` works as both decorator and wrapper for framework tools (LangChain, Pydantic AI, Agno)
- Resource requirements can be specified via decorator args or docstring `ray:` blocks
- `superserve.serve()` auto-detects agent framework and creates HTTP endpoints
- Code execution happens inside controlled Docker sandboxes with gVisor for security isolation
- The repo is framework-agnostic; avoid coupling to any single agent architecture
- Sandbox executor manages Docker containers with resource limits, timeouts, and network isolation
- Tools decorated with `@tool` have `_superserve_tool`, `_remote_func`, `_tool_metadata`, and `_original_func` attributes
- Tool execution must remain serializable because Ray will ship tasks to workers

## Technology Stack

- **Ray**: Distributed computing framework for task scheduling and resource management
- **Ray Serve**: Model serving and deployment
- **Docker + gVisor**: Container-based sandboxing with security isolation
- **FastAPI**: HTTP API layer for agent deployments
- **Click**: CLI framework for command-line parsing
- **Pydantic AI**: Supported agent framework
- **LangChain/LangGraph**: Supported agent framework
- **Agno**: Supported agent framework

## Project Structure

```
src/superserve/           Core runtime implementation
├── base.py          Core protocols and interfaces (AgentProtocol)
├── decorators.py    Unified @tool decorator for Ray-distributed execution
├── serve.py         superserve.serve() function for serving agents via HTTP
├── agent_base.py    superserve.Agent base class for custom agents
├── batch.py         Generic BatchTool for parallel execution
├── deployment.py    Ray Serve deployment utilities with streaming support
├── resource_loader.py  Memory parsing utilities
├── utils.py         execute_tools() for parallel/sequential tool execution
├── cli/             Command-line interface
│   ├── cli.py       Main CLI entry point
│   ├── analytics.py Shared helpers for anonymous CLI usage analytics
│   ├── commands/    Individual command implementations
│   │   ├── init.py        Initialize new project from templates
│   │   ├── create_agent.py Create agent from template
│   │   ├── up.py          Run all agents with superserve up
│   │   └── analytics.py   superserve analytics subcommands
│   └── templates/   Project and agent templates
└── sandbox/         Secure code execution
    ├── executor.py  CodeInterpreterExecutor Ray Actor
    ├── config.py    Sandbox configuration
    ├── types.py     Type definitions (ExecutionResult, etc.)
    ├── tools.py     Tool definitions for sandbox operations
    └── mcp_proxy.py MCP proxy for secure external access

examples/            Example applications
├── analyzer/        Token-efficient data analysis agent with MCP
└── finance-agent/   Financial analysis agent with Pydantic AI

tests/               Unit tests for runtime, tools, sandbox behavior
scripts/             Developer/cluster helper scripts (gVisor setup)
```

## Guidelines for AI Modifications

### Do

- Improve documentation comments and docstrings
- Refactor for clarity without breaking public APIs
- Add new sandbox capabilities behind clean interfaces
- Follow existing patterns for tool decoration and Ray integration
- Maintain security boundaries in sandbox execution
- Update examples when adding new features
- Add missing tests for new runtime features
- Keep dependencies minimal in core modules
- Handle errors gracefully with clear messages
- Validate inputs before processing

### Don't

- Create tight coupling to a specific agent framework
- Modify sandbox security boundaries without explicit review
- Introduce breaking API changes without updating examples/tests
- Add heavyweight dependencies to core runtime
- Bypass Ray's serialization requirements for tool execution
- Allow untrusted code to escape sandbox boundaries
- Introduce non-serializable objects in tool signatures
- Hardcode paths or environment-specific values
- Skip input validation or error handling
- Rewrite or delete tests unless behavior intentionally changes

## Coding Style

### Python

- Use type hints for all function signatures
- Follow PEP 8 conventions
- Prefer async/await for I/O operations
- Keep functions focused and single-purpose
- Use descriptive variable names over comments
- Avoid deep nesting; extract helper functions when necessary
- Use `@superserve.tool` decorator for all tool definitions
- Ensure tool functions are serializable for Ray

### Error Handling

- Use specific exception types, not bare `except:`
- Provide context in error messages
- Log security-relevant events in sandbox code
- Handle API errors gracefully with retries where appropriate
- Validate all inputs at system boundaries

### Security

- Never allow host filesystem access from sandboxes
- Enforce resource limits (CPU, memory, timeout) consistently
- Use gVisor runtime (`runsc`) for production sandbox execution
- Network isolation by default (`network_mode: none`)
- External access only via MCP proxy with allowlist
- Never execute code without container isolation

## Documentation Style

- Keep README files concise and actionable
- Include usage examples with runnable code
- Document required environment variables
- Explain the "why" not just the "what"
- Update docs when changing behavior
- Use code blocks with language hints for syntax highlighting

## Testing Guidelines

- Tests must be deterministic and reproducible
- Avoid depending on external services (APIs, network)
- Mock external dependencies when possible
- Test both success and error paths
- Keep tests isolated and independent
- Use pytest fixtures for common setup (see `tests/conftest.py`)
- Tests should run quickly (<30 seconds per test)
- Validate security boundaries in sandbox tests

## CLI Commands

| Command | Description |
|---------|-------------|
| `superserve init <project>` | Initialize new agent project from templates |
| `superserve create-agent <name> [--framework=...]` | Create agent (python/langchain/pydantic) |
| `superserve up [--port=...] [--agents=...]` | Run agents with Ray Serve |
| `superserve analytics [on\|off\|status]` | Manage anonymous usage analytics |

## Git Commit Guidelines

- Use single-line commit messages
- Do not include "Co-Authored-By" or any AI attribution in commits
- Keep commit messages concise and descriptive
