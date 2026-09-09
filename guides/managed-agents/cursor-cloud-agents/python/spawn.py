"""--spawn hook for `agent worker controller`.

Runs once per claimed request (or once per missing warm worker) with CURSOR_*
set by the controller. Creates a Superserve sandbox and starts a Cursor pool
worker inside it.
"""

from __future__ import annotations

import os
import re
import sys
import time

from superserve import NetworkConfig, Sandbox
from worker import (
    ALLOW_OUT,
    AUTO_DELETE_SECONDS,
    META_LAUNCHING,
    META_MANAGED,
    META_POOL,
    META_REPO,
    META_REQUEST_ID,
    META_WORKER_ID,
    TEMPLATE_NAME,
    find_sandbox_for_worker,
    launch_worker,
    release_claim,
    status_of,
    tag_sandbox,
    worker_env,
    worker_state,
)


def log(message: str) -> None:
    print(f"spawn: {message}", flush=True)


def err(message: str) -> None:
    print(f"spawn: {message}", file=sys.stderr, flush=True)


def sandbox_name(worker_id: str) -> str:
    short = re.sub(r"[^a-z0-9]", "", worker_id.lower())[:12]
    return f"cursor-{short or 'worker'}"


def create_sandbox(
    worker_id: str, pool: str, request_id: str | None, repo: str | None
) -> Sandbox:
    metadata = {META_MANAGED: "true", META_WORKER_ID: worker_id, META_POOL: pool}
    if request_id:
        metadata[META_REQUEST_ID] = request_id
    if repo:
        metadata[META_REPO] = repo

    network = None
    if ALLOW_OUT:
        network = NetworkConfig(allow_out=ALLOW_OUT, deny_out=["0.0.0.0/0"])

    return Sandbox.create(
        name=sandbox_name(worker_id),
        from_template=TEMPLATE_NAME,
        metadata=metadata,
        auto_delete_seconds=AUTO_DELETE_SECONDS,
        network=network,
    )


def abandon(sandbox: Sandbox | None, created: bool, request_id: str | None) -> None:
    """Hand the request back and drop a sandbox we created.

    A failed spawn must never strand a claim or leave an idle sandbox running.
    """
    if request_id:
        try:
            release_claim(request_id)
            err(f"released claim request={request_id}")
        except Exception as e:
            err(f"could not release claim request={request_id}: {e}")
    if created and sandbox is not None:
        try:
            sandbox.kill()
        except Exception as e:
            err(f"could not delete sandbox={sandbox.id}: {e}")


def main() -> int:
    for key in (
        "SUPERSERVE_API_KEY",
        "CURSOR_API_KEY",
        "CURSOR_AGENT_WORKER_ID",
        "CURSOR_POOL",
    ):
        if not os.environ.get(key):
            err(f"{key} is not set")
            return 2

    worker_id = os.environ["CURSOR_AGENT_WORKER_ID"]
    pool = os.environ["CURSOR_POOL"]
    request_id = os.environ.get("CURSOR_REQUEST_ID") or None
    worker_name = os.environ.get("CURSOR_WORKER_NAME") or None
    owner, name = (
        os.environ.get("CURSOR_REPO_OWNER"),
        os.environ.get("CURSOR_REPO_NAME"),
    )
    repo = f"{owner}/{name}" if owner and name else None

    sandbox: Sandbox | None = None
    created = False
    try:
        # A paused sandbox tagged with this worker id is a hibernated workspace
        # (see the monitor). Resume it instead of starting from scratch.
        existing = find_sandbox_for_worker(worker_id)
        if existing:
            log(
                f"reusing sandbox={existing.id} status={status_of(existing)} worker={worker_id}"
            )
            # Tell the monitor a relaunch is in progress before anything resumes
            # the sandbox: connect() auto-resumes, and the previous worker's exit
            # file is visible the moment it does.
            Sandbox.update_by_id(
                existing.id,
                metadata={
                    **(existing.metadata or {}),
                    META_LAUNCHING: str(int(time.time() * 1000)),
                },
            )
            sandbox = Sandbox.connect(existing.id)
            if status_of(sandbox) == "paused":
                sandbox.resume()
            state = worker_state(sandbox)
            if state["state"] == "running":
                tag_sandbox(sandbox, {META_LAUNCHING: None})
                log(f"worker already running pid={state['pid']} sandbox={sandbox.id}")
                return 0
        else:
            sandbox = create_sandbox(worker_id, pool, request_id, repo)
            created = True
            log(
                f"created sandbox={sandbox.id} template={TEMPLATE_NAME} worker={worker_id}"
            )

        result = launch_worker(sandbox, pool, worker_env(worker_id, worker_name))
        if not created:
            tag_sandbox(sandbox, {META_LAUNCHING: None})
        if not result["ok"]:
            state = result["state"]
            err(
                f"worker failed to start sandbox={sandbox.id} state={state.get('state')} "
                f"exit={state.get('exit_code', '-')}\n{result['log'][-2000:]}"
            )
            abandon(sandbox, created, request_id)
            return 1

        suffix = f" request={request_id}" if request_id else ""
        log(
            f"worker started pid={result['pid']} sandbox={sandbox.id} "
            f"pool={pool} worker={worker_id}{suffix}"
        )
        return 0
    except Exception as e:
        err(str(e))
        abandon(sandbox, created, request_id)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
