# RayAI Agent Project

A template for building and running agents with Ray Serve using the RayAI CLI.

## Quick Start

1. **Create a new project:**
   ```bash
   rayai init <project_name>
   cd <project_name>
   ```

   Note: The project is automatically installed in editable mode (`pip install -e .`).

2. **Set up environment (optional):**
   ```bash
   # Create .env file with your API keys and configuration
   ```

3. **Create your first agent:**
   ```bash
   rayai create-agent <agent_name>
   ```

4. **Implement your agent logic:**
   ```bash
   # Edit agents/<agent_name>/agent.py
   # - Add initialization code in __init__()
   # - Implement your logic in run()
   ```

5. **Run your agents:**
   ```bash
   rayai serve
   ```

6. **Test your agent:**
   ```bash
   curl -X POST http://localhost:8000/agents/<agent_name>/chat \
     -H "Content-Type: application/json" \
     -d '{"data": {"input": "test"}, "session_id": "test"}'
   ```

## Available Commands

- **`rayai create-agent <name> --framework <agent_framework>`** - Create a new agent
- **`rayai serve`** - Run all agents
- **`rayai serve --agents agent1,agent2`** - Run specific agents
- **`rayai serve --port=9000`** - Run on custom port
- **`rayai serve --<agent-name>-num-cpus=4`** - Override CPU allocation
- **`rayai serve --<agent-name>-num-gpus=1`** - Override GPU allocation
- **`rayai serve --<agent-name>-memory=8GB`** - Override memory allocation
- **`rayai serve --<agent-name>-num-replicas=2`** - Set number of replicas

## API Endpoints

After running `rayai serve`, each agent gets its own endpoint:

- **POST /agents/{agent_name}/chat** - Main agent endpoint
- **GET /docs** - Interactive API documentation
- **Ray Dashboard:** http://localhost:8265

## Project Structure

```
my-project/
├── pyproject.toml          # Project config and dependencies
├── .env                    # Optional API keys
└── agents/                 # All your agents
    ├── agent1/
    │   ├── __init__.py
    │   └── agent.py        # Agent1 class
    ├── agent2/
    │   ├── __init__.py
    │   └── agent.py        # Agent2 class
    └── ...
```

## Agent Implementation

Each agent should inherit from `RayAgent` and implement the `run()` method. RayAgent provides built-in tool management (`register_tools`, `execute_tools`) and ensures a consistent interface across all agents.

```python
from ray_agents import RayAgent

class MyAgent(RayAgent):
    def __init__(self):
        super().__init__()
        # Add your initialization code here
        # - Load models
        # - Initialize clients
        # - Set up databases

    def run(self, data: dict) -> dict:
        # Implement your agent logic here
        # Called for every request to /agents/my-agent/chat
        # - Process the input data
        # - Return results as a dictionary
        return {"response": "Hello!"}
```

## Tool System

Agents can use distributed tools that execute as Ray remote functions across your cluster.

### Defining and Organizing Tools

Define tools inline or in a separate `tools.py` file:

```python
# agents/my-agent/tools.py
from ray_agents import tool

@tool(desc="Search knowledge base", num_cpus=1, memory="512MB")
def search_kb(query: str) -> dict:
    return {"results": [...]}

@tool(desc="Analyze sentiment", num_cpus=2, memory="1GB")
def analyze_sentiment(text: str) -> dict:
    return {"sentiment": "positive", "confidence": 0.95}
```

### Using Tools

```python
# agents/my-agent/agent.py
from ray_agents import RayAgent
from .tools import search_kb, analyze_sentiment

class MyAgent(RayAgent):
    def __init__(self):
        super().__init__()
        self.register_tools(search_kb, analyze_sentiment)

    def run(self, data: dict) -> dict:
        # Execute tools in parallel (fastest)
        results = self.execute_tools([
            (search_kb, {"query": data["query"]}),
            (analyze_sentiment, {"text": data["text"]}),
        ], parallel=True)

        return {"search": results[0], "sentiment": results[1]}
```

### Parallel vs Sequential

- **`parallel=True`** - All tools run simultaneously (faster)
- **`parallel=False`** - Tools run one after another (use for dependencies)

### Key Points

- Tools always execute as distributed Ray remote functions
- Specify resources per tool: `@tool(desc="...", num_cpus=4, memory="8GB", num_gpus=1)`
- Tool resources are separate from agent resources

## Resource Configuration

Specify CPU, GPU, and memory requirements directly in your Python code—no Dockerfiles or Kubernetes manifests needed.

Configure CPU, GPU, memory, and replicas for your agents using two methods:

### Method 1: Ray Decorator (Set Defaults in Code)

Use the `@ray.remote` decorator to set default resource requirements for your agent:

```python
import ray
from ray_agents import RayAgent

@ray.remote(num_cpus=2, num_gpus=0, memory=4 * 1024**3)
class MyAgent(RayAgent):
    def __init__(self):
        super().__init__()

    def run(self, data: dict) -> dict:
        return {"response": "Hello!"}
```

**Note:** The `memory` argument requires bytes (e.g., `4 * 1024**3` for 4GB).

### Method 2: CLI Flags (Runtime Overrides)

Override resource settings at runtime using CLI flags:

```bash
rayai serve --my-agent-num-cpus=4 --my-agent-memory=8GB --my-agent-num-replicas=2
```

Available resource flags:
- `--{agent-name}-num-cpus` - Number of CPUs (integer)
- `--{agent-name}-num-gpus` - Number of GPUs (integer)
- `--{agent-name}-memory` - Memory allocation (supports "4GB", "512MB", etc.)
- `--{agent-name}-num-replicas` - Number of replicas for load balancing (integer)

### Precedence

When resources are configured in multiple places, the following precedence applies:

**CLI flags > @ray.remote decorator > defaults**

Default resources: 1 CPU, 2GB memory, 1 replica, 0 GPUs

## Development Workflow

1. **Create agent:** `rayai create-agent my-agent`
2. **Edit logic:** Modify `agents/my-agent/agent.py`
3. **Test locally:** `rayai serve`
4. **Make requests:** `POST /agents/my-agent/chat`
5. **Iterate:** Edit code, restart serve, test