"""Long-running janitor for worker sandboxes.

When a worker exits (idle release, crash, or manual stop) the sandbox is
deleted, or paused when CURSOR_WORKER_HIBERNATE=true. In hibernate mode it
also watches the pool's pending requests and resumes a paused sandbox when
Cursor asks for its worker again (a claimed-but-offline entry with that
worker id).
"""

from __future__ import annotations

import logging
import os
import signal
import sys
import threading
from datetime import UTC, datetime

from superserve import Sandbox, SandboxInfo
from worker import (
    HIBERNATE,
    META_MANAGED,
    META_POOL,
    META_WORKER_ID,
    TEMPLATE_NAME,
    launch_worker,
    list_pending_requests,
    status_of,
    worker_env,
    worker_state,
)

log = logging.getLogger("monitor")

TERMINAL_STATES = ("exited", "dead", "no_pidfile")
ONCE = "--once" in sys.argv[1:]
POLL_SECONDS = int(os.environ.get("MONITOR_POLL_SECONDS", "15"))
GRACE_SECONDS = int(os.environ.get("MONITOR_GRACE_SECONDS", "120"))
POOL = os.environ.get("CURSOR_POOL") or None
WAKE_ENABLED = HIBERNATE and bool(os.environ.get("CURSOR_API_KEY"))

shutdown = threading.Event()
waking: set[str] = set()


def recycle(info: SandboxInfo) -> None:
    sandbox = Sandbox.connect(info.id)
    state = worker_state(sandbox)
    # Only act on confirmed terminal states. An inconclusive probe (transient
    # exec error, malformed output) is retried on the next sweep.
    if state["state"] not in TERMINAL_STATES:
        if state["state"] != "running":
            log.warning(
                "sandbox=%s probe inconclusive (%s), retrying next sweep",
                info.id,
                state["state"],
            )
        return

    detail = (
        f"state={state['state']} exit={state.get('exit_code', '-')} "
        f"worker={info.metadata.get(META_WORKER_ID)}"
    )
    if HIBERNATE:
        log.info("pausing sandbox=%s %s", info.id, detail)
        sandbox.pause()
    else:
        log.info("deleting sandbox=%s %s", info.id, detail)
        sandbox.kill()


def sweep() -> list[SandboxInfo]:
    # Scope to this monitor's pool so parallel pool deployments never touch
    # each other's sandboxes.
    metadata = {META_MANAGED: "true"}
    if POOL:
        metadata[META_POOL] = POOL
    sandboxes = Sandbox.list(metadata=metadata)
    now = datetime.now(UTC)
    for info in sandboxes:
        if status_of(info) != "active":
            continue
        # Give a freshly spawned sandbox time to bring its worker up.
        created_at = info.created_at
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=UTC)
        if (now - created_at).total_seconds() < GRACE_SECONDS:
            continue
        if info.id in waking:
            continue
        try:
            recycle(info)
        except Exception as e:
            log.warning("sandbox=%s error: %s", info.id, e)
    return sandboxes


def wake_one(info: SandboxInfo, request: dict) -> None:
    worker_id = request["claimedWorkerId"]
    waking.add(info.id)
    try:
        log.info(
            "waking sandbox=%s worker=%s request=%s window=%ss",
            info.id,
            worker_id,
            request.get("id"),
            round((request.get("wakeTimeoutMs") or 0) / 1000),
        )
        sandbox = Sandbox.connect(info.id)
        if status_of(sandbox) == "paused":
            sandbox.resume()
        pool = info.metadata.get(META_POOL) or POOL or ""
        result = launch_worker(sandbox, pool, worker_env(worker_id))
        if result["ok"]:
            log.info(
                "worker resumed pid=%s sandbox=%s worker=%s",
                result["pid"],
                info.id,
                worker_id,
            )
        else:
            log.error(
                "worker failed to resume sandbox=%s state=%s\n%s",
                info.id,
                result["state"].get("state"),
                result["log"][-2000:],
            )
    finally:
        waking.discard(info.id)


def wake(sandboxes: list[SandboxInfo]) -> None:
    paused = {
        s.metadata[META_WORKER_ID]: s
        for s in sandboxes
        if status_of(s) == "paused" and s.metadata.get(META_WORKER_ID)
    }
    if not paused:
        return

    for request in list_pending_requests(POOL):
        info = paused.get(request.get("claimedWorkerId") or "")
        if info is None or info.id in waking:
            continue
        try:
            wake_one(info, request)
        except Exception as e:
            log.error("wake sandbox=%s error: %s", info.id, e)


def main() -> int:
    logging.basicConfig(
        level="INFO", format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    )
    if not os.environ.get("SUPERSERVE_API_KEY"):
        print("monitor: SUPERSERVE_API_KEY is not set", file=sys.stderr)
        return 2

    def request_shutdown(signum, _frame):
        log.info("shutdown requested (signal %d)", signum)
        shutdown.set()

    signal.signal(signal.SIGTERM, request_shutdown)
    signal.signal(signal.SIGINT, request_shutdown)

    log.info(
        "watching template=%s hibernate=%s wake=%s%s every %ss",
        TEMPLATE_NAME,
        HIBERNATE,
        WAKE_ENABLED,
        f" pool={POOL}" if POOL else "",
        POLL_SECONDS,
    )
    while not shutdown.is_set():
        try:
            sandboxes = sweep()
            if WAKE_ENABLED:
                wake(sandboxes)
        except Exception as e:
            log.warning("%s", e)
        if ONCE:
            break
        shutdown.wait(POLL_SECONDS)
    log.info("stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
