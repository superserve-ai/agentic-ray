# lakeFS on Superserve

This example mounts one lakeFS repository into multiple Superserve sandboxes
with Everest. Each worker reads a partition of the shared `input/` dataset on
its own lakeFS branch, writes a summary under `results/`, commits it, and
merges the non-overlapping results into the base branch. A fresh read-only
mount verifies that every result landed.

Everest requires lakeFS Cloud or Enterprise. Obtain the Linux x86_64 binary,
or an authorized download URL, and its SHA-256 checksum from lakeFS. This
example does not distribute the binary.

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
export LAKEFS_BASE_REF="main"
export LAKEFS_AGENT_COUNT="2"

bun run --filter @superserve/lakefs-example example
```

The example creates or reuses the `lakefs-secret` Superserve Secret and the
`lakefs-everest-demo` template. Sandboxes receive only the secret stand-in;
the secrets proxy substitutes the real lakeFS secret on requests to the
configured host.

The run always merges and verifies its results, then unmounts and kills its
sandboxes. It leaves the per-agent lakeFS branches in place for inspection.

## Manual integration test

The real-sandbox lifecycle test validates template creation, secret
substitution, mounting, writing, committing, and pause/resume against the
configured lakeFS repository:

```bash
bun run --filter @superserve/lakefs-example test:sandbox
```

The test uses the same required environment variables and deletes the branch
and sandbox it creates.
