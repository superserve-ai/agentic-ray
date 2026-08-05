# lakeFS on Superserve

This example mounts one lakeFS repository into multiple Superserve sandboxes
with Everest. Each worker reads a partition of the shared `input/` dataset on
its own lakeFS branch, writes a summary under `results/`, commits it, and
merges the non-overlapping results into a temporary transaction branch. A
fresh read-only mount validates the complete batch before one final merge
publishes it atomically to `main`.

Everest requires lakeFS Cloud or Enterprise. Obtain the Linux x86_64 binary,
or an authorized download URL, and its SHA-256 checksum from lakeFS. This
example does not distribute the binary. Downloading and verifying Everest
only installs the client; it does not authenticate to lakeFS or grant access
to any repository.

## Prerequisites

- A Superserve API key.
- A lakeFS Cloud or Enterprise repository with data under `input/`.
- A dedicated lakeFS access key scoped to that repository.
- An Everest download URL and checksum from lakeFS.

## Run

```bash
export SUPERSERVE_API_KEY="ss_live_..."
export LAKEFS_ENDPOINT="https://your-org.region.lakefscloud.io"
export LAKEFS_REPOSITORY="your-repo"
export LAKEFS_ACCESS_KEY_ID="your-access-key-id"
export LAKEFS_SECRET_ACCESS_KEY="your-secret-access-key"
export EVEREST_DOWNLOAD_URL="https://..."
export EVEREST_SHA256="..."

# Optional; defaults shown.
export LAKEFS_AGENT_COUNT="2"

bun run --filter @superserve/lakefs-example example
```

The example creates or reuses the `lakefs-secret` Superserve Secret and the
`lakefs-everest-demo` template. Sandboxes receive only the secret stand-in;
the secrets proxy substitutes the real lakeFS secret on requests to the
configured host. Creating the secret does not validate it: invalid lakeFS
credentials fail when the run tries to create its temporary branch, before
Everest mounts anything. Valid credentials also need the repository
permissions required for the requested read, write, commit, and branch
operations.

The run always starts from `main`. It merges every agent into an isolated
transaction branch and validates the combined results there. Only then does
one final merge publish the batch to `main`, so readers see all results or
none of them. The temporary transaction branch is deleted during cleanup;
the per-agent lakeFS branches remain available for inspection. The sandboxes
are always unmounted and killed. The TypeScript coordinator implements this
transaction pattern with lakeFS branch and merge REST calls; it does not add
a dependency on the Python SDK's `transact()` helper.

## Manual integration test

The real-sandbox lifecycle test validates template creation, secret
substitution, mounting, writing, committing, and pause/resume against the
configured lakeFS repository:

```bash
bun run --filter @superserve/lakefs-example test:sandbox
```

The test uses the same required environment variables and deletes the branch
and sandbox it creates.
