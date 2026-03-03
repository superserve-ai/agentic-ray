"""
Minimal chatbot built with LangChain deployed on Superserve.
"""

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(model="gpt-4o")
system = SystemMessage(content="You are a helpful assistant.")

while True:
    try:
        user_input = input()
    except EOFError:
        break
    response = llm.invoke([system, HumanMessage(content=user_input)])
    print(response.content)
