# agno_agent

Agno-based agent example built with [Agentic Ray](https://github.com/rayai-labs/agentic-ray).

This example shows how to:

- Define Ray tools with `@tool` and wrap them for Agno using `RayToolWrapper`
- Create an Agno `Agent` that calls an OpenAI model (`openai:gpt-4o`)
- Serve the agent via `rayai serve` and call it over HTTP

## Setup

1. **Install dependencies** (from the repo root, in a Python 3.12 env):

   ```bash
   pip install -e .  # install rayai and this example
   ```

2. **Set environment variables** (from the example directory):

   Copy `.env.example` if present, or export directly:

   ```bash
   export OPENAI_API_KEY=your_openai_key
   ```

   These match the validation logic in `agents/agno_agent/agent.py`.

## Run

From the example directory:

```bash
cd examples/agno_agent
rayai serve
```

You should see output indicating that the `agno_agent` endpoint is deployed, e.g.:

```text
Application 'agno_agent-service' is ready at http://0.0.0.0:8000/agents/agno_agent.
```

## API Endpoints

After running `rayai serve`, your Agno agent is available at:

- **POST** `/agents/agno_agent/chat` – Call the Agno demo agent

### Example Request

```bash
curl -X POST http://localhost:8000/agents/agno_agent/chat \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "messages": [
        {"role": "user", "content": "Use the tools to add 2 and 3"}
      ]
    },
    "session_id": "test"
  }'
```

The agent will:

- Interpret the user request
- Call the `add` tool (running on Ray) with `x=2`, `y=3`
- Return a response like: `The sum of 2 and 3 is 5.`
