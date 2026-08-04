# lakeFS on Superserve

This example mounts one bring-your-own lakeFS repository into multiple
Superserve sandboxes using **Everest**, lakeFS's own purpose-built mount
client (the same kind of role Mesa's and Archil's own mount clients play for
those integrations) -- plain `sandbox.commands.run()` calls, no SDK wrapper.
Each worker reads a partition of the same dataset on its own lakeFS branch,
writes a summary, commits it with `everest commit`, and merges the
non-overlapping results into the base branch -- then a fresh read-only mount
verifies every agent's result actually landed.

Everest is proprietary software that requires **lakeFS Cloud or Enterprise**.
Obtain the binary, or an authorized download URL for it, from lakeFS -- this
example ships no URL or checksum of its own, so you supply both via
`EVEREST_DOWNLOAD_URL` and `EVEREST_SHA256` below. The entitlement belongs to
the lakeFS deployment you mount against, not to the credentials you
authenticate with; Everest checks it against the server at mount time.

## Prerequisites

- A lakeFS instance and repository you control (BYO -- Superserve does not
  provision or operate lakeFS).
- A dedicated lakeFS identity (RBAC user + access key) scoped to that
  repository, not your admin credentials. See "Choosing a credential scope"
  in `docs/storage/lakefs.mdx`.
- An Everest/Mount license on your lakeFS instance. The script's own
  template build fetches and checksum-verifies the binary itself -- no
  manual download or Dockerfile needed.

## Run

**Required:**

```bash
export SUPERSERVE_API_KEY="ss_live_..."                    # read directly by the SDK
export LAKEFS_ENDPOINT="https://your-org.region.lakefscloud.io"
export LAKEFS_REPOSITORY="your-repo"
export LAKEFS_ACCESS_KEY_ID="your-access-key-id"
export LAKEFS_SECRET_ACCESS_KEY="your-secret-access-key"
export EVEREST_DOWNLOAD_URL="https://..."       # your authorized Everest download URL, from lakeFS
export EVEREST_SHA256="..."                     # sha256 of that artifact, from lakeFS (64 hex chars)
```

**Optional** (all have defaults; only set what you want to change):

```bash
export LAKEFS_BASE_REF="main"                   # default: main
export LAKEFS_SECRET_NAME="lakefs-secret"       # default: lakefs-secret -- Superserve Secret name
export SUPERSERVE_LAKEFS_TEMPLATE="lakefs-everest-demo"  # default: lakefs-everest-demo
export LAKEFS_AGENT_COUNT="2"                   # default: 2 (1-16)
export LAKEFS_INPUT_PREFIX="input"              # default: input
export LAKEFS_OUTPUT_PREFIX="results"           # default: results
export LAKEFS_MERGE_RESULTS="1"                 # default: 1 (merge + verify); set 0 to skip both
export LAKEFS_DEMO_PAUSE_RESUME="1"             # default: unset (off); 1 pauses/resumes agent 1 mid-run
export KEEP_SANDBOXES="0"                       # default: 0 (cleanup); 1 leaves sandboxes running
```

```bash
bun run --filter @superserve/lakefs-example example
```

**On credentials:** `LAKEFS_SECRET_ACCESS_KEY` is stored once as a Superserve
Secret and bound under two env var names in every sandbox --
`LAKEFS_API_SECRET_ACCESS_KEY` (used by the branch/merge `curl` calls) and
`EVEREST_LAKEFS_CREDENTIALS_SECRET_ACCESS_KEY` (used by `everest mount`).
Confirmed against a real instance: Everest's own lakeFS API calls use plain
HTTP Basic auth, same as the branch/merge calls, so **the real secret value
never enters a sandbox at all** -- it's only ever read once by this
orchestrator process, to create the Superserve Secret.

**On Everest's caching:** Everest mounts run with `--k2=false` -- confirmed against a real instance
that its default "K2" caching layer can silently serve a stale read (even a
direct path lookup, not a directory listing) when remounting the same ref on
the same host shortly after a commit landed elsewhere, which is exactly the
pattern the read-back verification step below depends on being correct.

## Tests

`tests/` holds opt-in integration tests that run against a real lakeFS
repository via Docker — not part of `bun run test` and not run in CI, since
they need Docker and real credentials. `tests/pause-resume.ts` covers the
pause/resume beat above: it freezes the container mid-mount, thaws it, and
verifies the mount still reads, fetches uncached data from lakeFS, and can
commit. See `tests/README.md` for what that does and doesn't prove.

```bash
bun run --filter @superserve/lakefs-example test:pause-resume
```

## Notes

The example leaves the per-agent lakeFS branches in place for inspection
after a run. It unmounts and kills its sandboxes by default; set
`KEEP_SANDBOXES=1` to keep them running. Set `LAKEFS_MERGE_RESULTS=0` to skip
merging (and the read-back verification, which depends on the merge).
