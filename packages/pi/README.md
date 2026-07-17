# @superserve/pi

Run Pi's shell and filesystem tools in a remote Superserve microVM while Pi,
model credentials, and session state stay on the host.

The package routes all seven built-in tools (`bash`, `read`, `write`, `edit`,
`grep`, `find`, and `ls`) plus interactive `!` commands. Once Superserve mode is
requested, sandbox failures are fail-closed: commands are rejected rather than
retried on the host.

## Install

```sh
pi install npm:@superserve/pi@0.1.0
```

Set the API key on the host:

```sh
export SUPERSERVE_API_KEY=ss_live_...
```

`SUPERSERVE_BASE_URL` can override the API endpoint for a self-hosted or staging
deployment. Neither value is forwarded to sandbox commands.

The extension supports Pi 0.80.x starting at 0.80.9 and Node.js 22.19 or newer
when Pi is running under Node. New Pi minor releases must be reviewed before
the peer range and runtime gate are widened because isolation depends on
extension ordering and tool-event semantics.

## Isolation-safe usage

Pi extensions and project resources are JavaScript that run in Pi's host
process. For untrusted repositories, load only this package and disable host
project resources:

```sh
pi \
  --no-builtin-tools \
  --no-extensions \
  --no-skills \
  --no-prompt-templates \
  --no-themes \
  --no-context-files \
  --no-approve \
  -e npm:@superserve/pi@0.1.0 \
  --superserve
```

Do not use `--no-tools`; it also removes the Superserve tool definitions. Avoid
combining this launcher with `--tools read,...`, which can reactivate built-in
tools if the extension fails to load.

Pass `--superserve` on every fresh invocation, including when resuming a bound
session. A bound session opened without explicit Superserve intent is blocked
and must be restarted with the secure launcher; it never silently falls back to
host tools.

For trusted projects, `pi --superserve` is a shorter convenience command. It is
not the isolation boundary when other global or CLI extensions are loaded:
extensions share Pi's host process, and an earlier extension can intercept the
interactive `!` shell handler. The package verifies ownership of model-facing
tool names and fails closed on collisions, but only the exclusive launcher
removes the host-extension ordering risk completely.

A new session creates one sandbox from `superserve/node-22`, uploads the current
contents of Git-tracked files to `/workspace`, and creates a synthetic initial
Git commit there. Dirty tracked files are included. Untracked and ignored files
are excluded, which avoids uploading common local secret files. Tracked secret
files are included, so audit the Git index or use `--superserve-sync none` when
necessary.

Changes remain in the sandbox. Save a bounded ZIP archive to the local checkout
before deleting or allowing the sandbox to expire:

```text
/superserve download
/superserve download output/review.zip
```

The command creates missing parent directories, but never extracts the archive
or overwrites an existing file.

## Flags

| Flag                                       | Default              | Purpose                                         |
| ------------------------------------------ | -------------------- | ----------------------------------------------- |
| `--superserve`                             | off                  | Enable fail-closed sandbox routing              |
| `--superserve-template <name-or-id>`       | `superserve/node-22` | Template used for new sandboxes                 |
| `--superserve-sandbox <id>`                | none                 | Attach an existing sandbox; implies secure mode |
| `--superserve-timeout <seconds>`           | `3600`               | Provider auto-pause timeout                     |
| `--superserve-auto-delete <seconds\|none>` | `86400`              | Delete after continuous paused time             |
| `--superserve-sync <tracked\|none>`        | `tracked`            | Upload tracked files when creating a sandbox    |

Custom templates must provide Node.js 22 and a POSIX shell. Tracked workspace
sync also expects `tar`; its synthetic Git baseline is skipped if `git` is not
installed in the template.

## Session lifecycle

The package stores only versioned sandbox metadata in Pi's session JSONL. It
never persists API keys, access tokens, or secret values.

- Resuming a session with explicit `--superserve` intent reconnects and
  activates its sandbox.
- Forking allocates a different sandbox and uploads the current host checkout;
  it never attaches the parent's sandbox.
- Quitting or switching a persisted session pauses its sandbox.
- An in-memory session destroys sandboxes created by the package on shutdown.
- Provider 404 responses create a replacement only during session restoration;
  authentication, network, and server errors remain fail-closed.
- A provisioning key reconciles crashes between sandbox creation and session
  persistence without blindly creating a duplicate.

Use `/superserve` for status. Other actions are `pause`, `resume`, `list`,
`connect <id>`, `kill`, `new`, and `download [output.zip]`. There is no command
that switches a sandbox-intended session back to host tools.

## Security boundaries and current limitations

- Model and interactive tool calls execute in the Superserve sandbox. Pi itself
  and this installed package execute on the host.
- Unknown model tools are blocked while Superserve mode is active because their
  implementations cannot be transparently moved into the sandbox.
- Pi's host shell environment is never passed to sandbox commands.
- Shell output is fetched through the SDK's bounded non-streaming path with a
  1 MiB hard response cap, then reduced to Pi's bounded tail without saving
  full output on the host. Commands default to 10 minutes and are capped at one
  hour. Text files are streamed remotely in bounded line ranges; attached image
  payloads are capped at 10 MiB.
- Initial sync invokes `git` and `tar` binaries resolved outside
  workspace-controlled `PATH` entries on the host. Model commands never reach
  those processes.
- Network egress currently uses the provider default and is unrestricted. This
  release provides compute and filesystem isolation, not a strict outbound
  network policy. Do not describe it as deny-all egress until provider-level
  enforcement is complete.
- Attached existing sandboxes are not overwritten with the local workspace and
  are paused, not destroyed, during automatic shutdown.
- Sandboxes do not mount the host checkout. Use the explicit ZIP download flow
  to review and recover remote changes.
- Do not open the same persisted Pi session concurrently. The provider does not
  yet expose the atomic lease needed to prevent two Pi processes from sharing a
  bound sandbox.
