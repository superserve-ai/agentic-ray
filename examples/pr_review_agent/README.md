# PR Review Agent Example

A GitHub Pull Request review agent built with RayAI and Ray for parallel execution.

This agent takes a GitHub Pull Request URL, fetches the changed files, and reviews each file diff in parallel using a large language model. The orchestration logic is handled deterministically in Python, while Ray provides scalable parallelism for file-level reviews.

---

## Overview

**Workflow:**

1. Extract a GitHub Pull Request URL from the user input
2. Fetch changed files and diffs from the GitHub API
3. Review each file diff in parallel using Ray workers
4. Aggregate results into a structured PR review summary

This example demonstrates how to build a production-ready, deterministic agent using Ray for data-parallel workloads, where Python controls orchestration and LLMs are used strictly for reasoning.

---


## Setup

1. Copy `.env.example` to `.env` and add your API keys:
   ```bash
   cp .env.example .env
   ```

2. Required API keys:
   - `GITHUB_TOKEN` - [GitHub](https://github.com/settings/tokens)
   - `OPENAI_API_KEY` - [OpenAI](https://platform.openai.com/)

## Run

1. Install the package:
   ```bash
   pip install rayai
   ```

2. Navigate to the example:
   ```bash
   cd examples/pr_review_agent
   ```

3. Start the agent:
   ```bash
   rayai serve
   ```

## Test

```bash
curl -X POST http://localhost:8000/agents/pr_review_agent/chat \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "messages": [
        {
          "role": "user",
          "content": "Please review this PR: https://github.com/rayai-labs/agentic-ray/pull/59"
        }
      ]
    },
    "session_id": "test"
  }'

```

## Response format

```bash
{
  "pull_request": "...",
  "summary": "...",
  "high_severity_files": [],
  "medium_severity_files": [],
  "file_reviews": [
    {
      "filename": "...",
      "status": "...",
      "review": {
        "summary": "...",
        "issues": [],
        "suggestions": [],
        "severity": "low | medium | high"
      }
    }
  ]
}
```
