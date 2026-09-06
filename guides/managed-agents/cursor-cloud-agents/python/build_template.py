"""Build the Superserve template that Cursor pool workers boot from."""

from __future__ import annotations

import os
from pathlib import Path

import dotenv
from superserve import RunStep, Template, WorkdirStep

dotenv.load_dotenv(Path(__file__).with_name(".env"))

TEMPLATE_NAME = os.environ.get("CURSOR_WORKER_TEMPLATE", "cursor-worker")

STEPS = [
    RunStep(
        run=(
            "apt-get update && apt-get install -y --no-install-recommends "
            "ca-certificates curl git jq procps unzip && rm -rf /var/lib/apt/lists/*"
        )
    ),
    # Installs to /root/.local/bin/agent; the symlink puts it on every PATH.
    RunStep(run="curl -fsS https://cursor.com/install | HOME=/root bash"),
    RunStep(
        run="ln -sf /root/.local/bin/agent /usr/local/bin/agent && agent --version"
    ),
    RunStep(run="mkdir -p /workspace /var/lib/cursor-worker"),
    WorkdirStep(workdir="/workspace"),
]


def _on_log(ev) -> None:
    if ev.stream.value != "system":
        print(ev.text, end="", flush=True)


def main() -> int:
    # Template names are unique per team, so a rerun must pick up the existing
    # template: reuse a ready one, wait on an in-flight build, rebuild a failed one.
    existing = next((t for t in Template.list() if t.name == TEMPLATE_NAME), None)
    if existing is not None:
        status = existing.status.value
        template = Template.connect(existing.id)
        if status == "ready":
            print(
                f"template {TEMPLATE_NAME!r} already exists and is ready (id: {existing.id})"
            )
            return 0
        if status == "failed":
            print(
                f"template {TEMPLATE_NAME!r} has a failed build (id: {existing.id}), rebuilding..."
            )
            template.rebuild()
            # Reconnect so wait_until_ready() tracks the new build, not the failed one.
            template = Template.connect(existing.id)
        else:
            print(
                f"template {TEMPLATE_NAME!r} is {status} (id: {existing.id}), waiting..."
            )
    else:
        print(f"creating template {TEMPLATE_NAME!r}...")
        template = Template.create(
            name=TEMPLATE_NAME,
            from_="ubuntu:24.04",
            vcpu=2,
            memory_mib=2048,
            disk_mib=8192,
            steps=STEPS,
        )
        print(f"template created (id: {template.id}), waiting for build...")

    template.wait_until_ready(on_log=_on_log)

    print(f"\ntemplate {TEMPLATE_NAME!r} is ready (id: {template.id})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
