# CLAUDE.md

## Purpose of This Directory

This directory contains a minimal example of using the Agno agent framework together with Agentic Ray. It demonstrates:

- Ray-distributed tools wrapped for Agno
- An Agno `Agent` wired to a model and tools
- Serving the agent via `rayai serve` with an `/agents/agno_agent/chat` HTTP endpoint

Use this as a template for building your own Agno-based agents with Ray-executed tools.

## Directory Structure

- `agents/`
  - `agno_agent/`
    - `agent.py`  
      Agno-based agent wired to Ray tools and an OpenAI model.
    - `tools.py`  
      Simple Ray `@tool` functions (`echo`, `add`).
- `pyproject.toml`  
  Minimal project metadata so the example can be installed/editable.
- `README.md`  
  Instructions for running and calling the agent.

## Key Concepts an AI Should Know

- **Agno + Ray integration**: Ray tools are wrapped via `RayToolWrapper(framework=AgentFramework.AGNO)` and passed into an Agno `Agent`.
- **System prompt handling**: Agno’s `Agent` constructor does not accept `system_prompt`, so the example prepends the prompt to the user message before calling `run`.
- **Tool argument names**: Tool parameter names (e.g. `x`, `y` for `add`) must match what the model is instructed to use.
- **Serve endpoint contract**: The agent’s `run` method expects OpenAI Chat-style `data["messages"]` and returns `{"response": ...}`.

## Do / Don't

### ✅ Do:

- Keep tools simple and well-typed
- Use `RayToolWrapper` for framework-specific tool conversion
- Document required environment variables in `README.md`
- Treat this as a starting point for Agno + Ray agents

### ❌ Don't:

- Hardcode API keys or credentials in code
- Add heavy dependencies beyond what this example needs
- Rely on Agno APIs (like `system_prompt=`) that are not supported by your installed version

## Related Modules

- `src/rayai/adapters/` – framework adapters, including Agno
- `src/rayai/cli/commands/create_agent.py` – CLI scaffolding for framework-specific agents
- `examples/finance_agent/` – Pydantic AI example with Ray tools and a richer workflow
