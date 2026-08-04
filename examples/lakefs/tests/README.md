# Manual integration tests

Opt-in tests that run against a **real** lakeFS repository. They need Docker,
real credentials, and an Everest download URL, so they aren't part of
`bun run test` and don't run in CI — run them by hand when changing how the
example mounts, commits, or recovers.

Docker containers stand in for Superserve sandboxes here. That's a faithful
substitute for the mount mechanics (same FUSE, same Everest binary, same
lakeFS traffic) but not for the platform itself: `Sandbox.create` secret
binding, `Template.create`, and real VM pause/resume can only be verified
against Superserve.

## `pause-resume.ts`

Checks that an active Everest mount survives its host being suspended and
resumed — the scenario behind `LAKEFS_DEMO_PAUSE_RESUME=1` in the example,
and the reason the docs claim a paused agent picks up on the same mount.

It mounts a branch write-mode, writes a file, freezes the container for 30s
(`PAUSE_SECONDS` to change), thaws it, then verifies:

- the mount is still a mountpoint,
- data written before the freeze is still readable,
- a file the mount never touched can be fetched fresh from lakeFS — proving
  the connection recovered rather than the cache covering for it,
- a post-thaw write commits successfully and both files are confirmed
  server-side via the lakeFS API.

**On fidelity:** `docker pause` freezes processes via the cgroup freezer. It
does not serialize and restore memory the way Superserve's `pause()` /
`resume()` does, so this is strong evidence the mount tolerates suspension —
not proof that real sandbox pause/resume works. It does exercise the failure
mode most likely to bite either way: idle lakeFS connections dying across the
suspension window.

```bash
export LAKEFS_ENDPOINT="https://your-org.region.lakefscloud.io"
export LAKEFS_REPOSITORY="your-repo"
export LAKEFS_ACCESS_KEY_ID="..."
export LAKEFS_SECRET_ACCESS_KEY="..."
export EVEREST_DOWNLOAD_URL="https://..."   # from lakeFS; match your host arch
export EVEREST_SHA256="..."

bun run tests/pause-resume.ts
```

The repository needs a seed dataset under `input/` on `main` (the test reads
an untouched file from it). The test creates and deletes its own branch and
container, including on failure.

Use the Linux **arm64** Everest build if you're on Apple Silicon — the x86_64
build runs under emulation and produces spurious TLS errors that look like
real failures.
