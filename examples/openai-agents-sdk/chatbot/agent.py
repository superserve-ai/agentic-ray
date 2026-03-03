"""
Minimal chatbot built with OpenAI Agents SDK deployed on Superserve.
"""

from agents import Agent, Runner

agent = Agent(
    name="assistant",
    instructions="You are a helpful assistant.",
)

while True:
    try:
        user_input = input()
    except EOFError:
        break
    result = Runner.run_sync(agent, user_input)
    print(result.final_output)
