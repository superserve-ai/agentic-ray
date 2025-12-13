"""Finance tools with Ray distributed execution."""

import os
import uuid

import ray
import requests

from rayai import tool
from rayai.sandbox import execute_code


@tool(desc="Fetch top S&P 500 stocks from API Ninjas", num_cpus=1)
def get_sp500(limit: int = 10) -> list[dict[str, str]]:
    """Fetch top S&P 500 stocks from API Ninjas.

    Use this tool when the user asks about S&P 500 stocks, top companies,
    or wants to see a list of major publicly traded companies.

    Args:
        limit: Number of stocks to return (1-500)

    Returns:
        List of dicts with stock info including ticker symbol and company name.
    """
    print(f"[API] Fetching top {limit} S&P 500 stocks...", flush=True)
    response = requests.get(
        f"https://api.api-ninjas.com/v1/sp500?limit={limit}",
        headers={"X-Api-Key": os.environ["API_NINJAS_KEY"]},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


@tool(desc="Fetch daily time series data for a stock symbol", num_cpus=1)
def get_daily_time_series(symbol: str) -> dict:
    """Fetch daily time series data for a stock symbol from Alpha Vantage.

    Use this tool when the user asks about historical stock prices, daily performance,
    price trends, or wants to analyze a specific stock's trading history.

    Args:
        symbol: Stock ticker symbol (e.g., "AAPL", "MSFT", "IBM")

    Returns:
        Dict containing metadata and daily time series with open, high, low, close,
        volume.
    """
    print(f"[API] Fetching time series for {symbol}...", flush=True)
    response = requests.get(
        "https://www.alphavantage.co/query",
        params={
            "function": "TIME_SERIES_DAILY",
            "symbol": symbol,
            "apikey": os.environ["ALPHAVANTAGE_API_KEY"],
        },
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


SANDBOX_DOCKERFILE = """
FROM python:3.12-slim
RUN pip install --no-cache-dir pandas numpy
"""


@tool(desc="Execute Python code to analyze stock data in a secure sandbox", num_cpus=1)
def run_analysis_code(code: str, time_series_data: str) -> str:
    """Execute Python code to analyze stock time series data in a secure sandbox.

    Use this tool when the user wants to perform custom analysis on stock data,
    calculate metrics, identify trends, or run computations on time series data.

    The sandbox has pandas and numpy pre-installed. The time series data is
    automatically loaded and available as a `data` variable (already parsed dict).

    Args:
        code: Python code to execute. The `data` variable is pre-loaded with the
              time series data. Just use it directly and print results. Example:
              ```
              # data is already available as a dict
              print(data.keys())
              # analyze data...
              print(result)
              ```
        time_series_data: JSON string of time series data from get_daily_time_series

    Returns:
        The stdout output from code execution, or error message if execution failed.
    """
    # Generate unique session ID for each execution
    session_id = f"finance-agent-{uuid.uuid4()}"

    # Wrap the code to include the data inline
    escaped_data = time_series_data.replace("\\", "\\\\").replace('"""', '\\"\\"\\"')
    wrapped_code = f'''
import json

# Data provided by the agent
_raw_data = """{escaped_data}"""
data = json.loads(_raw_data)

# User's analysis code
{code}
'''

    # Execute the analysis code with custom dockerfile that has pandas
    print("[SANDBOX] Executing analysis code...", flush=True)
    result = ray.get(
        execute_code.remote(
            wrapped_code,
            session_id=session_id,
            dockerfile=SANDBOX_DOCKERFILE,
            timeout=120,
        )
    )
    print(f"[SANDBOX] Status: {result.get('status')}", flush=True)
    if result.get("status") == "success":
        print(f"[SANDBOX] Output:\n{result.get('stdout', '')}", flush=True)
    else:
        print(
            f"[SANDBOX] Error: {result.get('error') or result.get('stderr', '')}",
            flush=True,
        )

    if result.get("status") == "success":
        return result.get("stdout", "")
    else:
        error_msg = result.get("error") or result.get("message") or str(result)
        stderr = result.get("stderr", "")
        return f"Error: {error_msg}\nStderr: {stderr}"
