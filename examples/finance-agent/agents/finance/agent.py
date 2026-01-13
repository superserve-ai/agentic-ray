"""Finance agent using Pydantic AI with Ray distributed tools."""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from pydantic_ai import Agent

import rayai

# Load .env from example directory
load_dotenv(Path(__file__).parent.parent.parent / ".env")

# Validate required API keys at startup
REQUIRED_KEYS = ["OPENAI_API_KEY", "API_NINJAS_KEY", "ALPHAVANTAGE_API_KEY"]
missing = [k for k in REQUIRED_KEYS if not os.environ.get(k)]
if missing:
    sys.exit(f"Missing required environment variables: {', '.join(missing)}")

from .tools import get_daily_time_series, get_sp500, run_analysis_code  # noqa: E402

SYSTEM_PROMPT = """\
You are a finance analyst assistant that helps users analyze stock market data.

## Workflow
1. When asked to analyze stocks, first use get_sp500 to get the list of stock symbols
2. For each stock symbol, use get_daily_time_series to fetch its historical price data
3. Use run_analysis_code to execute Python analysis on the data. Pass the time series
   JSON data and write code that:
   - Uses the pre-loaded `data` variable (already parsed dict, do NOT read from file)
   - Calculates relevant metrics (returns, volatility, moving averages, etc.)
   - Prints results as JSON or structured output

## Analysis Guidelines
- Calculate key metrics: daily returns, average volume, price change %, volatility
- Identify trends: compare recent prices to historical averages
- Look for notable patterns: high volume days, significant price movements
- Always handle missing or malformed data gracefully in your code

## Output Format
After running analysis, provide a clear summary including:
- Overview of stocks analyzed
- Key findings and metrics in a readable table or list
- Notable outliers or interesting observations
- Any stocks showing unusual activity

Keep summaries concise but informative. Focus on actionable insights.
"""


def make_agent():
    """Create and return the finance agent."""
    return Agent(
        "openai:gpt-4o",
        system_prompt=SYSTEM_PROMPT,
        tools=[get_sp500, get_daily_time_series, run_analysis_code],
    )


# Serve the agent with Ray Serve
rayai.serve(make_agent, name="finance", num_cpus=1, memory="1GB")
