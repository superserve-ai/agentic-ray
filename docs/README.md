# Superserve Docs

Documentation for [Superserve](https://superserve.ai), the deployment platform for AI agents. Published at [docs.superserve.ai](https://docs.superserve.ai).

## Local development

```bash
npx mint dev # or bunx mint dev
```

Preview at `http://localhost:3000`.

## Structure

```
docs/
├── docs.json              # Mintlify config and navigation
├── index.mdx              # Introduction
├── quickstart.mdx         # Getting started guide
├── zero-config.mdx        # Deployment guide
├── sessions.mdx           # Sessions and persistence
├── authentication.mdx     # Auth flow docs
├── troubleshooting.mdx    # Common issues
├── sdk.mdx                # TypeScript SDK reference
├── cli.mdx                # CLI reference
├── frameworks/            # Framework-specific guides
├── llms.txt               # LLM-friendly docs index
└── llms-full.txt          # Full docs for LLM consumption
```

## Publishing

Changes pushed to the default branch are deployed automatically via the [Mintlify GitHub app](https://dashboard.mintlify.com).
