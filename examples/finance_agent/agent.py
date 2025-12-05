from pathlib import Path

from dotenv import load_dotenv
from pydantic_ai import Agent

# Load .env from repo root
load_dotenv(Path(__file__).parent.parent.parent / ".env")

from tools import get_daily_time_series, get_sp500, run_analysis_code  # noqa: E402

SYSTEM_PROMPT = """\
You are a finance analyst assistant that helps users analyze stock market data.

## Workflow
1. When asked to analyze stocks, first use get_sp500 to get the list of stock symbols
2. For each stock symbol, use get_daily_time_series to fetch its historical price data
3. Use run_analysis_code to execute Python analysis on the data. Pass the time series
   JSON data and write code that:
   - Reads the data from /tmp/data.json
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

agent = Agent(
    "openai:gpt-4o",
    system_prompt=SYSTEM_PROMPT,
    tools=[get_sp500, get_daily_time_series, run_analysis_code],
)


def print_messages(messages):
    """Print intermediate steps from message history."""
    for msg in messages:
        kind = msg.kind
        if kind == "request":
            continue
        elif kind == "response":
            for part in msg.parts:
                if part.part_kind == "tool-call":
                    args_preview = str(part.args)[:50]
                    print(f"  → Calling: {part.tool_name}({args_preview})")
                elif part.part_kind == "text" and part.content:
                    print(f"  → Thinking: {part.content[:100]}...")
        elif kind == "tool-return":
            content = str(msg.content)[:100]
            print(f"  ← Result: {content}...")


if __name__ == "__main__":
    import sys

    while True:
        user_input = input("You: ")
        sys.stdout.flush()
        if user_input.lower() in ("quit", "exit"):
            break
        print("Processing...", flush=True)
        result = agent.run_sync(user_input)
        print("\n--- Steps ---", flush=True)
        print_messages(result.all_messages())
        print("\n--- Summary ---", flush=True)
        print(f"Assistant: {result.output}", flush=True)
