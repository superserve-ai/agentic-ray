"""
Minimal chatbot built with Claude Agent SDK deployed on Superserve.
"""

import asyncio

from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient, TextBlock

options = ClaudeAgentOptions(
    model="sonnet",
    system_prompt="You are a helpful assistant.",
    permission_mode="bypassPermissions",
    continue_conversation=True,
)


async def main():
    async with ClaudeSDKClient(options=options) as client:
        while True:
            try:
                user_input = input()
            except EOFError:
                break
            await client.query(prompt=user_input)
            async for msg in client.receive_response():
                for block in getattr(msg, "content", []):
                    if isinstance(block, TextBlock):
                        print(block.text)


asyncio.run(main())
