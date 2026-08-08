# superserve

Python SDK for the Superserve sandbox API — run code in isolated Firecracker MicroVMs.

## Installation

```bash
pip install superserve
# or
uv add superserve
# or
poetry add superserve
```

Requires Python ≥ 3.9.

## Quick Start

```python
from superserve import Sandbox

sandbox = Sandbox.create(name="my-sandbox")

result = sandbox.commands.run("echo hello")
print(result.stdout)

sandbox.files.write("/app/data.txt", b"content")
text = sandbox.files.read_text("/app/data.txt")

sandbox.kill()
```

## Preview URLs

Choose the default access for new ports, publish only the ports you intend to
expose, and request a signed link for private browser access:

```python
sandbox = Sandbox.create(name="private-preview", preview_access="private")
sandbox.publish_preview_port(3000, access="private")

browser_url = sandbox.get_signed_preview_url(3000, expires_in_seconds=300)
credential = sandbox.get_preview_token(3000)
# Machine clients: {credential.header: credential.token}
```

Each published port keeps its own `public` or `private` mode; `preview_access`
is only the default for newly published ports. Omitting it defaults a new
sandbox to strict `public`. `legacy_public` is returned only for pre-migration
sandboxes.
See the [preview URL guide](https://docs.superserve.ai/sandbox/preview-urls).

## Desktop (computer use)

Control a GUI desktop inside a sandbox — screenshot, mouse, keyboard, and a
live browser viewer. Requires a desktop-enabled template.

```python
sandbox = Sandbox.create(template="superserve/desktop")

shot = sandbox.desktop.screenshot()  # PNG bytes + dimensions
sandbox.desktop.click(640, 400)
sandbox.desktop.write("hello")  # no per-character pacing
sandbox.desktop.press("ctrl+l")
sandbox.desktop.drag((10, 10), (200, 200))  # one atomic request

# Several model-emitted actions in a single round trip:
sandbox.desktop.actions([
    {"type": "click", "x": 640, "y": 32},
    {"type": "write", "text": "https://example.com"},
    {"type": "press", "key": "enter"},
])

sandbox.desktop.resize(1920, 1080)  # live, no restart
viewer = sandbox.desktop.get_stream_url()  # noVNC URL
```

## Authentication

Set the `SUPERSERVE_API_KEY` environment variable:

```bash
export SUPERSERVE_API_KEY=ss_live_...
```

Or pass it explicitly:

```python
sandbox = Sandbox.create(
    name="my-sandbox",
    api_key="ss_live_...",
    base_url="https://api.superserve.ai",  # optional
)
```

## Async usage

```python
import asyncio
from superserve import AsyncSandbox

async def main():
    sandbox = await AsyncSandbox.create(name="async-example")
    try:
        result = await sandbox.commands.run("echo hello")
        print(result.stdout)
    finally:
        await sandbox.kill()

asyncio.run(main())
```

## Streaming command output

```python
result = sandbox.commands.run(
    "pip install numpy",
    on_stdout=lambda data: print(data, end=""),
    on_stderr=lambda data: print(data, end=""),
    timeout_seconds=120,
)
```

## Error handling

```python
from superserve import (
    SandboxError,
    AuthenticationError,     # 401
    ValidationError,         # 400
    NotFoundError,           # 404
    ConflictError,           # 409 — invalid state for operation
    SandboxTimeoutError,     # request timed out (does not shadow builtin TimeoutError)
    ServerError,             # 500
)

try:
    sandbox.pause()
except ConflictError:
    # Sandbox is not in a pausable state
    pass
```

## Full documentation

[docs.superserve.ai](https://docs.superserve.ai/sdk/python/sandbox?utm_source=pypi&utm_medium=readme)

## Development

```bash
# From repo root:
bunx turbo run build --filter=@superserve/python-sdk
bunx turbo run typecheck --filter=@superserve/python-sdk
bunx turbo run lint --filter=@superserve/python-sdk
```

## License

Apache License 2.0.
