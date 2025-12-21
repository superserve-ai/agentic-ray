"""GitHub PR review agent built on RayAI and Pydantic AI.

Workflow:
1. Extract GitHub PR link from user message
2. Fetch PR metadata and file changes using GitHub API
3. Use rayai's BatchTool to review each file individually
4. Aggregate results into a comprehensive summary
5. Return full review as JSON
"""

import json
import os
import re
import sys
from pathlib import Path
from typing import Match

import requests

from dotenv import load_dotenv
from pydantic_ai import Agent

from rayai import agent, BatchTool

# Load .env from example directory
load_dotenv(Path(__file__).parent.parent.parent / ".env")

# Validate required API keys at startup
REQUIRED_KEYS = ["OPENAI_API_KEY", "GITHUB_TOKEN"]
missing = [k for k in REQUIRED_KEYS if not os.environ.get(k)]
if missing:
    sys.exit(f"Missing required environment variables: {', '.join(missing)}")

from .tools import fetch_pull_request, review_file, failure_payload 

SYSTEM_SUMMARY_PROMPT = """\
You are a code review assistant and summarizer.

## Workflow
1. You will be provided with a GitHub Pull Request's context, including metadata and changed files.
2. You will also be provided with a summary of each changed file's review in json format.
3. Your task is to aggregate this information into a comprehensive review summary.

## Output Format (Strictly JSON)
Your final output must be a JSON object with the following structure:
{
    "Status": "Success" | "Failure",
    "Error": "error message if any, else null",
    "Summary": "brief summary of the overall changes in the PR",
}
"""


@agent(num_cpus=1, memory="2GB")
class PrReviewAgent:
    """PR Review agent orchestrated by RayAI."""

    def __init__(self):
        self.pydantic_agent = Agent(
            "openai:gpt-4.1",
            system_prompt=SYSTEM_SUMMARY_PROMPT,
        )
    
    @staticmethod
    def _get_pr_url(message: str) -> Match[str] | None:
        match = re.search(
            r"https?://github\.com/(?P<owner>[^/]+)/(?P<repo>[^/]+)/pull/(?P<number>\d+)",
            message,
        )
        return match if match else None

    async def run(self, data: dict) -> dict:
        """Execute the PR review agent.

        Args:
            data: Input payload in OpenAI Chat API format.

        Returns:
            Dict with 'response' containing the agent output.
        """
        messages = data.get("messages", [])
        if not messages:
            return failure_payload("No messages provided in input data.")

        # Use the most recent user message as the current query
        current_message = None
        for msg in reversed(messages):
            if msg.get("role") == "user":
                current_message = msg.get("content", "")
                break

        if not current_message:
            return failure_payload("No user message found in input data.")
        
        pr_url = self._get_pr_url(current_message)
        if not pr_url:
            return failure_payload("No GitHub PR link found. Please provide a link like https://github.com/<owner>/<repo>/pull/<number>.")
        
        owner = pr_url.group("owner")
        repo = pr_url.group("repo")
        pr_number = int(pr_url.group("number"))

        try:
            pr_context = fetch_pull_request(owner, repo, pr_number)
        except RuntimeError as e:
            # Raised when required auth is missing
            return failure_payload(str(e))
        except requests.exceptions.HTTPError as e:
            status = e.response.status_code if e.response else "unknown"
            body = e.response.text if e.response else str(e)
            return failure_payload(f"GitHub API error (status {status}): {body}")
        except requests.exceptions.RequestException as e:
            return failure_payload(f"Network error while calling GitHub API: {str(e)}")
        except Exception as e:
            return failure_payload(f"Unexpected error fetching PR data: {str(e)}")
        
        batch_tool = BatchTool(
            tools=[review_file],
        )

        files = pr_context.get("files", [])

        result = batch_tool(tool_name="review_file", tool_inputs=[{"file": f} for f in files])

        aggregated_summaries = []
        for file_review in result.get("results", []):
            if file_review.get("Status") == "Success":
                aggregated_summaries.append(file_review.get("file_name", "") + ": " + file_review.get("Summary", ""))

        summary_text = "\n\n".join(aggregated_summaries)

        pr_meta = pr_context.get("pr", {})

        message = (
            f"PR Title: {pr_meta.get('title')}\n"
            f"PR Description: {pr_meta.get('body')}\n"
            f"PR previous reviews: {pr_context.get('reviews')}\n"
            f"PR review comments: {pr_context.get('review_comments')}\n\n"
            f"File Review Summaries:\n{summary_text}\n\n"
        )

        response = await self.pydantic_agent.run(message)
        overall_summary = None

        try:
            parsed = json.loads(response.output)
            if isinstance(parsed, dict):
                overall_summary = parsed
        except json.JSONDecodeError:
            overall_summary = failure_payload("Failed to parse overall summary output as JSON.")

        final_result = {
            "summary": overall_summary,
            "file_reviews": result.get("results", []),
        }

        return final_result

        

        
