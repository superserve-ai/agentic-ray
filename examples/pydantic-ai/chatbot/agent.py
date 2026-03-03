"""
Minimal chatbot built with Pydantic AI deployed on Superserve.
"""

from pydantic_ai import Agent

agent = Agent("openai:gpt-4o", system_prompt="You are a helpful assistant.")

while True:
    try:
        user_input = input()
    except EOFError:
        break
    result = agent.run_sync(user_input)
    print(result.output)
