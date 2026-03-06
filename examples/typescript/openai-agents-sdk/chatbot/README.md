# OpenAI Agents SDK

A minimal chatbot built with [OpenAI Agents SDK](https://github.com/openai/openai-agents-js) and deployed on [Superserve](https://superserve.ai).

## Install

```bash
npm install
# or
bun install
```

## Run

```bash
OPENAI_API_KEY=sk-... npx ts-node agent.ts
# or
OPENAI_API_KEY=sk-... bun agent.ts
```

## Deploy

```bash
superserve deploy agent.ts --name chatbot
superserve secrets set chatbot OPENAI_API_KEY=sk-...
superserve run chatbot
```
