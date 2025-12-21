"""Tools for fetching GitHub PR context for the PR review agent."""

import os
from typing import Any

import requests

from rayai import tool
from pydantic_ai import Agent
import json

GITHUB_API = "https://api.github.com"


def _auth_headers() -> dict[str, str]:
	token = os.environ.get("GITHUB_TOKEN")
	if not token:
		raise RuntimeError("GITHUB_TOKEN is required to call GitHub APIs")
	return {
		"Authorization": f"Bearer {token}",
		"Accept": "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
	}


def _get_json(url: str, params: dict[str, Any] | None = None) -> Any:
	resp = requests.get(url, headers=_auth_headers(), params=params, timeout=30)
	resp.raise_for_status()
	return resp.json()


@tool(desc="Fetch PR details, files, reviews, and patches from GitHub", num_cpus=1)
def fetch_pull_request(owner: str, repo: str, pr_number: int, max_files: int = 30) -> dict:
	"""Fetch comprehensive PR context using GitHub REST APIs.

	Args:
		owner: Repository owner (org or user).
		repo: Repository name.
		pr_number: Pull request number.
		max_files: Limit the number of files fetched (GitHub defaults to 30/page).

	Returns:
		Dict containing PR metadata, changed files (with patches), reviews, and review comments.
	"""
	session = requests.Session()
	session.headers.update(_auth_headers())

	pr_url = f"{GITHUB_API}/repos/{owner}/{repo}/pulls/{pr_number}"
	pr_resp = session.get(pr_url, timeout=30)
	pr_resp.raise_for_status()
	pr_json = pr_resp.json()

	# Pull files (includes unified diff patch where available)
	files: list[dict[str, Any]] = []
	page = 1
	page_size = 30
	while len(files) < max_files:
		file_resp = session.get(
			f"{pr_url}/files",
			params={"per_page": page_size, "page": page},
			timeout=30,
		)
		file_resp.raise_for_status()
		batch = file_resp.json()
		files.extend(batch)
		if len(batch) < page_size:
			break
		page += 1

	# Trim if caller asked for fewer files than available
	files = files[:max_files]
	
	# Pull reviews and review comments to expose reviewer intent
	reviews = _get_json(f"{pr_url}/reviews", params={"per_page": 30})
	review_comments = _get_json(
		f"{pr_url}/comments",
		params={"per_page": 30},
	)

	return {
		"pr": {
			"number": pr_json.get("number"),
			"title": pr_json.get("title"),
			"body": pr_json.get("body"),
			"url": pr_json.get("html_url"),
			"changed_files": pr_json.get("changed_files"),
			"commits": pr_json.get("commits"),
			"user": pr_json.get("user", {}).get("login"),
			"base": pr_json.get("base", {}).get("label"),
			"head": pr_json.get("head", {}).get("label"),
		},
		"files": files,
		"reviews": reviews,
		"review_comments": review_comments,
	}

SYSTEM_PROMPT = """
You are a helpful assistant that reviews GitHub pull requests (PRs) based on user requests.

## Workflow
1. You will be given git diff values of a file - filename, patch, additions, deletions, status.
2. Review the changes in the file.
3. Provide concise feedback focusing on correctness, security, performance, and reliability issues.
4. If there are any issues, categorize them into high_priority and low_priority and provide suggestions.
Note - High priority issues are critical problems that must be addressed before merging the PR, 
while low priority issues are minor concerns or suggestions for improvement that can be addressed later.
Don't make up issues if there are none.

## Output Format (strict JSON)
Respond **only** with a JSON object using this shape:
{
    "Status": "Success" | "Failure",
    "Error": "error message if any, else null",
    "Summary": "brief summary of the changes in the file",
    "high_priority": [
        {"file": "path", "issue": "what's wrong", "suggestion": "proposed fix"}
    ],
    "low_priority": [
        {"file": "path", "issue": "minor concern", "suggestion": "optional fix"}
    ]
}
"""

@tool(desc="Review changes in a file", num_cpus=1)
def review_file(file: dict) -> dict:
	"""Review a single changed file in a PR.

	Args:
		file: Dict containing file metadata and patch.

	Returns:
		String review of the file changes.
	"""
	file_name = file.get("filename", "unknown")
	patch = file.get("patch", "")
	additions = file.get("additions", 0)
	deletions = file.get("deletions", 0)
	status = file.get("status", "modified")



	if not patch:
		return failure_payload(f"No patch available for file {file_name}")

	pydantic_agent = Agent(
		"openai:gpt-4.1",
		system_prompt=SYSTEM_PROMPT,
	)

	message = (
		f"Review the following changes in file: {file_name}\n"
		f"Status: {status}\n"
		f"Additions: {additions}, Deletions: {deletions}\n"
		f"Patch:\n{patch}"
	)

	response = pydantic_agent.run_sync(message)
	
	try:
		parsed = json.loads(response.output)
		if isinstance(parsed, dict):
			return {"file_name": file_name, **parsed}
	except json.JSONDecodeError:
		pass
	
	return {"file_name": file_name, **failure_payload(f"Failed to parse review output as JSON for file {file_name}")}
	

def failure_payload(error: str) -> dict:
	return {
		"Status": "Failure",
		"Error": error,
	}