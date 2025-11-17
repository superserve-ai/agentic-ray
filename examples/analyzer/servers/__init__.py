"""MCP Servers for Ray Agents examples.

This package provides wrappers for MCP servers. Tools are organized by server,
with each tool available as a separate Python function.

Available servers:
- filesystem: File and directory operations
- code_executor: Execute Python code in sandboxed environment

Example:
    from servers.filesystem import read_file, list_directory
    from servers.code_executor import execute_code

    files = await list_directory("./data")
    content = await read_file("data/example.txt")
    result = await execute_code("print('Hello')")
"""
