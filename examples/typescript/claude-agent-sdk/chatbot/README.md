# Claude Agent SDK

A minimal chatbot built with [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript) and deployed on [Superserve](https://superserve.ai).

## Install

```bash
npm install
# or
bun install
```

## Run

```bash
ANTHROPIC_API_KEY=sk-ant-... npx ts-node agent.ts
# or
ANTHROPIC_API_KEY=sk-ant-... bun agent.ts
```

## Deploy

```bash
superserve deploy agent.ts --name chatbot
superserve secrets set chatbot ANTHROPIC_API_KEY=sk-ant-...
superserve run chatbot
```
