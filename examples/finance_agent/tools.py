import os

import ray
import requests

from ray_agents.sandbox import execute_code, upload_file


def get_sp500(limit: int = 10) -> list[dict[str, str]]:
    """Fetch top S&P 500 stocks from API Ninjas.

    Use this tool when the user asks about S&P 500 stocks, top companies,
    or wants to see a list of major publicly traded companies.

    Args:
        limit: Number of stocks to return (1-500)

    Returns:
        List of dicts with stock info including ticker symbol and company name.
    """
    print(f"[DEBUG] get_sp500 called with limit={limit}", flush=True)
    response = requests.get(
        f"https://api.api-ninjas.com/v1/sp500?limit={limit}",
        headers={"X-Api-Key": os.environ["API_NINJAS_KEY"]},
        timeout=30,
    )
    response.raise_for_status()
    print("[DEBUG] get_sp500 got response", flush=True)
    return response.json()


def get_daily_time_series(symbol: str) -> dict:
    """Fetch daily adjusted time series data for a stock symbol from Alpha Vantage.

    Use this tool when the user asks about historical stock prices, daily performance,
    price trends, or wants to analyze a specific stock's trading history.

    Args:
        symbol: Stock ticker symbol (e.g., "AAPL", "MSFT", "IBM")

    Returns:
        Dict containing metadata and daily time series with open, high, low, close,
        adjusted close, volume, and dividend/split info.
    """
    print(f"[DEBUG] get_daily_time_series called with symbol={symbol}", flush=True)
    response = requests.get(
        "https://www.alphavantage.co/query",
        params={
            "function": "TIME_SERIES_DAILY_ADJUSTED",
            "symbol": symbol,
            "apikey": os.environ["ALPHAVANTAGE_API_KEY"],
        },
        timeout=30,
    )
    response.raise_for_status()
    print("[DEBUG] get_daily_time_series got response", flush=True)
    return response.json()


def run_analysis_code(code: str, time_series_data: str) -> str:
    """Execute Python code to analyze stock time series data in a secure sandbox.

    Use this tool when the user wants to perform custom analysis on stock data,
    calculate metrics, identify trends, or run computations on time series data.

    The sandbox has pandas and numpy pre-installed. The time series data will be
    available as a JSON string in a file at /tmp/data.json.

    Args:
        code: Python code to execute. Should read data from /tmp/data.json and
              print results to stdout. Example:
              ```
              import json
              import pandas as pd
              with open('/tmp/data.json') as f:
                  data = json.load(f)
              # analyze data...
              print(result)
              ```
        time_series_data: JSON string of time series data from get_daily_time_series

    Returns:
        The stdout output from code execution, or error message if execution failed.
    """
    ray.init(ignore_reinit_error=True)

    session_id = "finance-agent-analysis"

    # Upload the time series data
    upload_result = ray.get(
        upload_file.remote(
            "/tmp/data.json", time_series_data.encode(), session_id=session_id
        )
    )
    if upload_result["status"] == "error":
        return f"Error uploading data: {upload_result['error']}"

    # Execute the analysis code
    result = ray.get(execute_code.remote(code, session_id=session_id, timeout=60))

    if result["status"] == "success":
        return result["stdout"]
    else:
        return f"Error: {result['error']}\nStderr: {result.get('stderr', '')}"
