"""
Minimal chatbot built with Agno deployed on Superserve.
"""

from agno.agent import Agent
from agno.models.openai import OpenAIChat

agent = Agent(
    model=OpenAIChat(id="gpt-4o"),
    instructions="You are a helpful assistant.",
)

while True:
    try:
        user_input = input()
    except EOFError:
        break
    response = agent.run(user_input)
    print(response.content)
