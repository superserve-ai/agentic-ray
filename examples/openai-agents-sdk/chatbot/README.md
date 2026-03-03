# OpenAI Agents SDK

A minimal chatbot built with [OpenAI Agents SDK](https://github.com/openai/openai-agents-python) and deployed on [Superserve](https://superserve.ai).

## Deploy

```bash
superserve deploy agent.py --name chatbot
superserve secrets set chatbot OPENAI_API_KEY=sk-...
superserve run chatbot
```
