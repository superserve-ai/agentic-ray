# CLAUDE.md

## Purpose of This Directory
This directory contains an example finance analysis agent that demonstrates:
- Using Pydantic AI framework with Agentic Ray
- Fetching external data via API tools
- Executing analysis code on fetched data
- Tool chaining and multi-step workflows
- Integration with external APIs (Alpha Vantage, API Ninjas)

This example shows how to build an agent that combines external data fetching with code-based analysis.

## Directory Structure
- `agent.py` - Main agent implementation using Pydantic AI
- `tools.py` - Ray tools for data fetching and code execution

## Key Concepts an AI Should Know
- **Pydantic AI Framework**: Uses `pydantic_ai.Agent` for agent implementation
- **Tool Chaining**: Agent uses multiple tools in sequence (get_sp500 → get_daily_time_series → run_analysis_code)
- **External APIs**: Integrates with Alpha Vantage and API Ninjas for stock data
- **Code Execution**: Uses sandbox to execute analysis code on fetched data
- **Data Flow**: API data → JSON file → Python analysis → Results

## Architecture Flow
```
User Query
  ↓
Agent (Pydantic AI)
  ↓
Tool 1: get_sp500() → List of stock symbols
  ↓
Tool 2: get_daily_time_series(symbol) → Historical price data
  ↓
Tool 3: run_analysis_code(data) → Python analysis in sandbox
  ↓
Results → User
```

## Key Components

### `agent.py`
- `Agent` instance with Pydantic AI
- System prompt defining workflow and analysis guidelines
- Tool registration (get_sp500, get_daily_time_series, run_analysis_code)
- Interactive CLI loop
- Message history printing for debugging

### `tools.py`
- `get_sp500()`: Fetches S&P 500 stock symbols
- `get_daily_time_series()`: Fetches historical price data from Alpha Vantage
- `run_analysis_code()`: Executes Python analysis code in sandbox

## Required Environment Variables
- `OPENAI_API_KEY`: For Pydantic AI agent
- `API_NINJAS_KEY`: For S&P 500 symbol list
- `ALPHAVANTAGE_API_KEY`: For historical price data

## Do / Don't

### ✅ Do:
- Use this as a template for API-based agents
- Follow the tool chaining pattern
- Handle API errors gracefully
- Validate data before analysis
- Use sandbox for code execution

### ❌ Don't:
- Hardcode API keys
- Skip error handling for API calls
- Execute untrusted code without sandbox
- Store API keys in code
- Make excessive API calls (respect rate limits)

## Running the Example

```bash
# From project root
cd examples/finance_agent

# Set environment variables in .env file at project root
# OPENAI_API_KEY=...
# API_NINJAS_KEY=...
# ALPHAVANTAGE_API_KEY=...

# Run the agent
python agent.py
```

## Customization
- **Add more tools**: Extend `tools.py` with new API integrations
- **Change analysis**: Modify system prompt in `agent.py`
- **Use different model**: Change `Agent("openai:gpt-4o", ...)` to another model
- **Add data sources**: Integrate additional financial APIs

## Related Modules
- `src/rayai/sandbox/` - Code execution sandbox
- `examples/CLAUDE.md` - General examples documentation

