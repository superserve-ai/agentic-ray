# Finance Agent Example

A stock market analysis agent using Pydantic AI with Ray-distributed tools.

## Setup

1. Copy `.env.example` to `.env` and add your API keys:
   ```bash
   cp .env.example .env
   ```

2. Required API keys:
   - `OPENAI_API_KEY` - [OpenAI](https://platform.openai.com/)
   - `API_NINJAS_KEY` - [API Ninjas](https://api-ninjas.com/)
   - `ALPHAVANTAGE_API_KEY` - [Alpha Vantage](https://www.alphavantage.co/)

## Run

1. Install the package:
   ```bash
   pip install rayai
   ```

2. Navigate to the example:
   ```bash
   cd examples/finance_agent
   ```

3. Start the agent:
   ```bash
   rayai up
   ```

## Test

```bash
curl -X POST http://localhost:8000/agents/finance/ \
  -H 'Content-Type: application/json' \
  -d '{"query": "Get the top 5 S&P 500 stocks"}'
```

## Tools

- `get_sp500` - Fetch top S&P 500 stocks
- `get_daily_time_series` - Fetch daily stock price data
- `run_analysis_code` - Execute Python analysis in a secure sandbox (requires Docker)
