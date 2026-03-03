# Mastra

A minimal chatbot built with [Mastra](https://mastra.ai/) and deployed on [Superserve](https://superserve.ai).

## Deploy

```bash
superserve deploy agent.ts --name chatbot
superserve secrets set chatbot OPENAI_API_KEY=sk-...
superserve run chatbot
```
