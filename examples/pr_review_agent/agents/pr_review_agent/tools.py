"""
GitHub tools for fetching Pull Request data.
"""

import builtins
import json
import os
import re
from typing import Any

import ray
import requests
from pydantic_ai import Agent

GITHUB_API_BASE = "https://api.github.com"


def _parse_pr_url(pr_url: str) -> tuple[str, str, int]:
    """
    Parse GitHub PR URL into owner, repo, pr_number.

    Example:
    https://github.com/OWNER/REPO/pull/123
    """
    match = re.match(
        r"https://github\.com/(?P<owner>[^/]+)/(?P<repo>[^/]+)/pull/(?P<number>\d+)",
        pr_url,
    )
    if not match:
        raise ValueError(
            "Invalid GitHub PR URL. Expected format: "
            "https://github.com/OWNER/REPO/pull/NUMBER"
        )

    return (
        match.group("owner"),
        match.group("repo"),
        int(match.group("number")),
    )


def fetch_pr_files(pr_url: str) -> list[dict[str, Any]]:
    """
    Fetch changed files for a GitHub Pull Request.

    Args:
        pr_url: GitHub PR URL

    Returns:
        List of dicts:
        [
          {
            "filename": "path/to/file.py",
            "status": "modified",
            "additions": 10,
            "deletions": 2,
            "changes": 12,
            "patch": "diff --git ..."
          }
        ]
    """
    owner, repo, pr_number = _parse_pr_url(pr_url)

    headers = {
        "Accept": "application/vnd.github.v3+json",
    }

    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    files: list[builtins.dict[str, Any]] = []
    page = 1
    per_page = 100

    while True:
        url = f"{GITHUB_API_BASE}/repos/{owner}/{repo}" f"/pulls/{pr_number}/files"
        params = {"page": page, "per_page": per_page}

        resp = requests.get(url, headers=headers, params=params, timeout=30)
        if resp.status_code != 200:
            raise RuntimeError(f"GitHub API error {resp.status_code}: {resp.text}")

        page_files = resp.json()
        if not page_files:
            break

        for f in page_files:
            # Binary files or very large diffs may not have patches
            patch = f.get("patch")
            if not patch:
                continue

            files.append(
                {
                    "filename": f.get("filename"),
                    "status": f.get("status"),
                    "additions": f.get("additions"),
                    "deletions": f.get("deletions"),
                    "changes": f.get("changes"),
                    "patch": patch,
                }
            )

        if len(page_files) < per_page:
            break

        page += 1

    if not files:
        raise RuntimeError("No diffable files found in this PR.")

    return files


# =====================================================
# Parallel File Review Worker (Ray task)
# =====================================================

"""
Batch tool for reviewing file diffs in parallel using RayAI.
"""

REVIEW_PROMPT = """\
You are a senior software engineer performing a code review.

Review the following Git diff and provide constructive feedback.

File: {filename}
Status: {status}

Diff:
{patch}

Return ONLY valid JSON in the following format:

{{
  "summary": "...",
  "issues": ["..."],
  "suggestions": ["..."],
  "severity": "low | medium | high"
}}
"""


@ray.remote(num_cpus=0.5, memory=256 * 1024 * 1024)
def review_file_diff(file: dict[str, Any]) -> dict[str, Any]:
    filename = file.get("filename")
    status = file.get("status")
    patch = file.get("patch")
    agent = Agent(
        "openai:gpt-4o",
        system_prompt=REVIEW_PROMPT.format(
            filename=filename,
            status=status,
            patch=patch,
        ),
    )

    raw_output = agent.run_sync("Review this file diff.").output

    # -----------------------------
    # CRITICAL: Parse LLM output
    # -----------------------------
    try:
        # Try extracting JSON from the response
        start = raw_output.find("{")
        end = raw_output.rfind("}") + 1
        parsed = json.loads(raw_output[start:end])
    except (json.JSONDecodeError, TypeError, AttributeError, ValueError):
        # Fallback for bad LLM output or unexpected format
        parsed = {
            "summary": str(raw_output)[:500],
            "issues": [],
            "suggestions": [],
            "severity": "low",
        }

    return {
        "filename": filename,
        "status": status,
        "review": parsed,  # <-- ALWAYS a dict
    }
