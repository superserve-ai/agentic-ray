# Pydantic AI

A minimal chatbot built with [Pydantic AI](https://ai.pydantic.dev/) and deployed on [Superserve](https://superserve.ai).

## Deploy

```bash
superserve deploy agent.py --name chatbot
superserve secrets set chatbot OPENAI_API_KEY=sk-...
superserve run chatbot
```
