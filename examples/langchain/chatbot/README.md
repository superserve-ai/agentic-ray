# LangChain

A minimal chatbot built with [LangChain](https://python.langchain.com/) and deployed on [Superserve](https://superserve.ai).

## Deploy

```bash
superserve deploy agent.py --name chatbot
superserve secrets set chatbot OPENAI_API_KEY=sk-...
superserve run chatbot
```
