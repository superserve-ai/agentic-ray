"""Shared helpers for the spawn hook and the monitor.

Sandbox tagging, the in-sandbox worker supervisor scripts, and the Cursor
pool API.
"""

from __future__ import annotations

import base64
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

import dotenv
from superserve import Sandbox, SandboxInfo

# Load .env next to the scripts, not from the controller's cwd. Variables the
# controller already set (CURSOR_POOL, CURSOR_AGENT_WORKER_ID, ...) win:
# load_dotenv never overrides existing values.
dotenv.load_dotenv(Path(__file__).with_name(".env"))

META_MANAGED = "cursor.managed"
META_WORKER_ID = "cursor.worker_id"
META_POOL = "cursor.pool"
META_REQUEST_ID = "cursor.request_id"
META_REPO = "cursor.repo"
# Set by the spawn hook while it resumes and relaunches a paused sandbox, so the
# monitor leaves it alone until the new worker is up (see MONITOR_GRACE_SECONDS).
META_LAUNCHING = "cursor.launching"

STATE_DIR = "/var/lib/cursor-worker"
PIDFILE = f"{STATE_DIR}/worker.pid"
EXITFILE = f"{STATE_DIR}/worker.exit"
LOGFILE = f"{STATE_DIR}/worker.log"

POOL_NAME_RE = re.compile(r"^[A-Za-z0-9._-]+$")
STARTUP_GRACE_SECONDS = 5
LIVE_STATUSES = ("starting", "active", "pausing", "paused", "resuming")


def _flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name, "")
    if raw == "":
        return default
    return raw in ("true", "1")


TEMPLATE_NAME = os.environ.get("CURSOR_WORKER_TEMPLATE", "cursor-worker")
IDLE_RELEASE_TIMEOUT = os.environ.get("CURSOR_WORKER_IDLE_RELEASE_TIMEOUT", "600")
CLONE_GIT_REPOS = _flag("CURSOR_WORKER_CLONE_GIT_REPOS", True)
HIBERNATE = _flag("CURSOR_WORKER_HIBERNATE", False)
AUTO_DELETE_SECONDS = int(os.environ.get("SANDBOX_AUTO_DELETE_SECONDS", "86400"))
# Sandboxes resolve DNS through these public resolvers. A strict allowlist has
# to include them or nothing resolves. Single IPs are written as /32.
DNS_RESOLVERS = ["1.1.1.1/32", "8.8.8.8/32"]
_IPV4_RE = re.compile(r"^\d{1,3}(\.\d{1,3}){3}$")


def egress_allowlist(raw: str) -> list[str]:
    entries = [e.strip() for e in raw.split(",") if e.strip()]
    entries = [f"{e}/32" if _IPV4_RE.match(e) else e for e in entries]
    if not entries:
        return []
    return list(dict.fromkeys(DNS_RESOLVERS + entries))


ALLOW_OUT = egress_allowlist(os.environ.get("CURSOR_WORKER_ALLOW_OUT", ""))
CURSOR_ENDPOINT = os.environ.get("CURSOR_API_ENDPOINT", "https://api.cursor.com")


def _render(script: str) -> str:
    return (
        script.replace("__STATE_DIR__", STATE_DIR)
        .replace("__PIDFILE__", PIDFILE)
        .replace("__EXITFILE__", EXITFILE)
        .replace("__LOGFILE__", LOGFILE)
    )


PROBE_SCRIPT = _render(
    """\
#!/bin/bash
set +e
if test -f "__EXITFILE__"; then
  code=$(head -n1 "__EXITFILE__" 2>/dev/null | tr -d '[:space:]')
  printf '{"state":"exited","pid":null,"exit_code":%s}\\n' "${code:-null}"
  exit 0
fi
if ! test -s "__PIDFILE__"; then
  printf '{"state":"no_pidfile","pid":null,"exit_code":null}\\n'
  exit 0
fi
pid=$(head -n1 "__PIDFILE__" 2>/dev/null | tr -d '[:space:]')
if kill -0 "$pid" 2>/dev/null; then
  printf '{"state":"running","pid":%s,"exit_code":null}\\n' "$pid"
else
  printf '{"state":"dead","pid":%s,"exit_code":null}\\n' "$pid"
fi
"""
)

STOP_SCRIPT = _render(
    """\
#!/bin/bash
set +e
if test -s "__PIDFILE__"; then
  pid=$(head -n1 "__PIDFILE__" 2>/dev/null | tr -d '[:space:]')
  if test -n "$pid" && kill -0 "$pid" 2>/dev/null; then
    pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')
    kill -TERM "-${pgid:-$pid}" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
    for i in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.5
    done
    kill -0 "$pid" 2>/dev/null && kill -KILL "-${pgid:-$pid}" 2>/dev/null
  fi
fi
rm -f "__PIDFILE__" "__EXITFILE__"
"""
)

# The worker runs detached from the exec session (setsid) so it outlives the
# API call that started it. The command itself lives in run.sh so no shell
# quoting is involved; the exit code lands in EXITFILE for the probe.
RUNFILE = f"{STATE_DIR}/run.sh"
LAUNCH_SCRIPT = _render(
    """\
#!/bin/bash
set -eu
export HOME="${HOME:-/root}"
export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"
mkdir -p "__STATE_DIR__" /workspace
cd /workspace
rm -f "__PIDFILE__" "__EXITFILE__"
setsid bash -c 'bash "__RUNFILE__"; printf "%s\\n" "$?" > "__EXITFILE__"' > "__LOGFILE__" 2>&1 < /dev/null &
pid=$!
printf "%s\\n" "$pid" > "__PIDFILE__"
echo "$pid"
"""
).replace("__RUNFILE__", RUNFILE)


def run_script(command: str) -> str:
    return f"#!/bin/bash\nexec {command}\n"


def worker_command(pool: str) -> str:
    if not POOL_NAME_RE.match(pool):
        raise ValueError(f"invalid pool name: {pool}")
    args = ["agent", "worker", "--pool", pool]
    if CLONE_GIT_REPOS:
        args.append("--clone-git-repos")
    args.append("start")
    return " ".join(args)


def worker_env(worker_id: str, worker_name: str | None = None) -> dict[str, str]:
    """Env for the worker process.

    CURSOR_API_KEY is scoped to this command, not the whole sandbox, so it is
    not visible to unrelated exec calls.
    """
    env = {
        "CURSOR_API_KEY": os.environ["CURSOR_API_KEY"],
        "CURSOR_AGENT_WORKER_ID": worker_id,
        "CURSOR_WORKER_IDLE_RELEASE_TIMEOUT": IDLE_RELEASE_TIMEOUT,
    }
    if worker_name:
        env["CURSOR_WORKER_NAME"] = worker_name
    for key in ("CURSOR_API_URL", "CURSOR_API_ENDPOINT"):
        if os.environ.get(key):
            env[key] = os.environ[key]
    return env


def status_of(info: SandboxInfo | Sandbox) -> str:
    return getattr(info.status, "value", str(info.status))


def worker_state(sandbox: Sandbox) -> dict[str, Any]:
    try:
        result = sandbox.commands.run(f"bash {STATE_DIR}/probe.sh")
        lines = result.stdout.strip().splitlines()
        if lines:
            return json.loads(lines[-1])
    except Exception:
        pass
    return {"state": "unknown", "pid": None, "exit_code": None}


def stop_worker(sandbox: Sandbox) -> None:
    sandbox.commands.run(f"bash {STATE_DIR}/stop.sh")


def read_log(sandbox: Sandbox) -> str:
    try:
        return sandbox.files.read_text(LOGFILE)
    except Exception as e:
        return f"(could not read {LOGFILE}: {e})"


def launch_worker(
    sandbox: Sandbox, pool: str, env: dict[str, str], command: str | None = None
) -> dict[str, Any]:
    """Start the worker detached. ``command`` overrides the worker command; tests
    use it to run a stand-in process."""
    sandbox.commands.run(f"mkdir -p {STATE_DIR}")
    sandbox.files.write(f"{STATE_DIR}/launch.sh", LAUNCH_SCRIPT)
    sandbox.files.write(RUNFILE, run_script(command or worker_command(pool)))
    sandbox.files.write(f"{STATE_DIR}/probe.sh", PROBE_SCRIPT)
    sandbox.files.write(f"{STATE_DIR}/stop.sh", STOP_SCRIPT)

    result = sandbox.commands.run(f"bash {STATE_DIR}/launch.sh", env=env)
    try:
        pid = int(result.stdout.strip().splitlines()[-1])
    except (IndexError, ValueError):
        return {
            "ok": False,
            "state": {"state": "no_pidfile", "pid": None, "exit_code": None},
            "log": read_log(sandbox),
        }

    time.sleep(STARTUP_GRACE_SECONDS)
    state = worker_state(sandbox)
    if state["state"] != "running":
        return {"ok": False, "state": state, "log": read_log(sandbox)}
    return {"ok": True, "pid": pid, "state": state}


def tag_sandbox(sandbox: Sandbox, updates: dict[str, str | None]) -> None:
    """Merge metadata updates into the sandbox's tags; None removes a key.

    update() replaces the whole map, so read first.
    """
    metadata = dict(sandbox.get_info().metadata or {})
    for key, value in updates.items():
        if value is None:
            metadata.pop(key, None)
        else:
            metadata[key] = value
    sandbox.update(metadata=metadata)


def find_sandbox_for_worker(worker_id: str) -> SandboxInfo | None:
    matches = Sandbox.list(metadata={META_WORKER_ID: worker_id})
    for info in matches:
        if status_of(info) in LIVE_STATUSES:
            return info
    return None


# --- Cursor pool API (service-account key, Basic auth) ----------------------


def cursor_api(path: str, method: str = "GET", body: Any | None = None) -> Any:
    token = base64.b64encode(f"{os.environ['CURSOR_API_KEY']}:".encode()).decode()
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{CURSOR_ENDPOINT}{path}", data=data, method=method)
    req.add_header("Authorization", f"Basic {token}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        raise RuntimeError(f"{method} {path} -> {e.code} {detail}") from None
    return json.loads(raw) if raw else None


def release_claim(request_id: str) -> Any:
    """Hand a claimed request back to the queue when the worker could not start."""
    path = (
        f"/v0/private-workers/claims/{urllib.parse.quote(request_id, safe='')}/release"
    )
    return cursor_api(path, method="POST")


def list_pending_requests(pool: str | None) -> list[dict[str, Any]]:
    requests: list[dict[str, Any]] = []
    page_token: str | None = None
    while True:
        params: dict[str, str] = {"limit": "100"}
        if pool:
            params["pool"] = pool
        if page_token:
            params["pageToken"] = page_token
        page = cursor_api(
            f"/v0/private-workers/pending-requests?{urllib.parse.urlencode(params)}"
        )
        requests.extend((page or {}).get("requests", []))
        page_token = (page or {}).get("nextPageToken")
        if not page_token:
            return requests
