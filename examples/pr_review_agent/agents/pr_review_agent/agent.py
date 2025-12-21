"""
PR Review agent using Pydantic AI with Ray distributed batch tools.

This agent takes a GitHub Pull Request URL, fetches the changed files,
and reviews each file in parallel using RayAI BatchTool.
"""

import os
import sys
from pathlib import Path

import ray
from dotenv import load_dotenv

from rayai import agent

from .tools import fetch_pr_files, review_file_diff
from .utils import extract_pr_url, summarize_reviews

# -------------------------------------------------------------------
# Environment setup
# -------------------------------------------------------------------

# Load .env from project root (same pattern as finance agent)
# Load .env from project root
load_dotenv(Path(__file__).parent.parent.parent / ".env")

# Validate required API keys at startup
REQUIRED_KEYS = ["OPENAI_API_KEY"]
missing = [k for k in REQUIRED_KEYS if not os.environ.get(k)]
if missing:
    sys.exit(f"Missing required environment variables: {', '.join(missing)}")

# Optional but recommended
if not os.environ.get("GITHUB_TOKEN"):
    print("Warning: GITHUB_TOKEN not set. GitHub API requests may be rate-limited.")

# -------------------------------------------------------------------
# System Prompt
# -------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are a senior software engineer acting as a GitHub Pull Request reviewer.

Your job is to review code changes in a pull request and provide
clear, constructive, and actionable feedback.

## Workflow
1. Extract the GitHub Pull Request URL from the user's message.
2. Use `fetch_pr_files` to retrieve the list of changed files and their diffs.
3. For each file, use `review_file_diff` to analyze the changes.
   - Each file review runs in parallel using Ray.
4. Aggregate the results into a concise final review.

## Review Guidelines
- Identify bugs, logical errors, and edge cases
- Highlight potential security issues
- Comment on performance or scalability concerns
- Suggest improvements for readability and maintainability
- Be constructive and professional

## Output Format
Provide:
- A brief overall summary of the PR
- High-severity issues (if any)
- File-by-file feedback in a clear, structured format

Do not repeat raw diffs in the final response.
Focus on insights and recommendations.
"""


# -------------------------------------------------------------------
# Agent Definition
# -------------------------------------------------------------------
@agent(num_cpus=0.5, memory="256MB")
class PrReviewAgent:
    async def run(self, data: dict) -> dict:
        messages = data.get("messages", [])
        if not messages:
            return {"error": "No messages provided"}

        user_message = next(
            (m["content"] for m in reversed(messages) if m["role"] == "user"),
            None,
        )
        if not user_message:
            return {"error": "No user message found"}

        try:
            pr_url = extract_pr_url(user_message)
        except ValueError as exc:
            return {
                "error": "Invalid pull request URL",
                "details": str(exc),
            }

        try:
            files = fetch_pr_files(pr_url)
        except RuntimeError as exc:
            return {
                "error": "Failed to fetch pull request files from GitHub",
                "details": str(exc),
            }

        # Parallel fan-out
        refs = [review_file_diff.remote(f) for f in files]
        reviews = ray.get(refs)

        aggregation = summarize_reviews(reviews)

        return {
            "response": {
                "pull_request": pr_url,
                **aggregation,
                "file_reviews": reviews,
            }
        }
