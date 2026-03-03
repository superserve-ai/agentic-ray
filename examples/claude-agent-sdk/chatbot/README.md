# Claude Agent SDK

A minimal chatbot built with [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk) and deployed on [Superserve](https://superserve.ai).

## Deploy

```bash
superserve deploy agent.py --name chatbot
superserve secrets set chatbot ANTHROPIC_API_KEY=sk-ant-...
superserve run chatbot
```
