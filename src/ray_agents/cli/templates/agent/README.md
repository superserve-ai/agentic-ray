# {{PROJECT_NAME}}

Built with [Agentic Ray](https://github.com/rayai-labs/agentic-ray).

## Quick Start

1. **Install:**
   ```bash
   pip install agentic-ray
   ```

2. **Create a new project:**
   ```bash
   rayai init my_project
   cd my_project
   ```

3. **Create an agent:**
   ```bash
   rayai create-agent my_agent
   ```

4. **Run your agent:**
   ```bash
   rayai serve
   ```

## API Endpoints

After running `rayai serve`, your agents are available at:

- **POST** `/agents/{agent_name}/chat` - Call your agent

### Example Request

```bash
curl -X POST http://localhost:8000/agents/my_agent/chat \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Hello!"}]}'
```
