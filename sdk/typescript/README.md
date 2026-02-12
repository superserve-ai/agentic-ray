# Superserve SDK for TypeScript

Official TypeScript SDK for [Superserve](https://superserve.ai) hosted agents.

[![npm version](https://badge.fury.io/js/@superserve%2Fsdk.svg)](https://www.npmjs.com/package/@superserve/sdk)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- Full TypeScript support with comprehensive type definitions
- Works in both Node.js (18+) and modern browsers
- Zero runtime dependencies (uses native `fetch`)
- Real-time streaming via Server-Sent Events (SSE)
- Async iterator support for elegant stream consumption
- Comprehensive error handling with typed exceptions

## Documentation

For detailed documentation, see the [docs](./docs/index.md) directory:

- [Getting Started](./docs/index.md) - Overview and quick start
- [Authentication](./docs/authentication.md) - API key setup and configuration
- [Agents](./docs/agents.md) - Creating and managing agents
- [Runs](./docs/runs.md) - Running agents and handling outputs
- [Streaming](./docs/streaming.md) - Real-time streaming with RunStream
- [Events](./docs/events.md) - SSE event types reference
- [Errors](./docs/errors.md) - Error handling and error types
- [Examples](./docs/examples.md) - Complete code examples

## Installation

```bash
npm install @superserve/sdk
```

```bash
yarn add @superserve/sdk
```

```bash
pnpm add @superserve/sdk
```

## Quick Start

```typescript
import { SuperserveClient } from '@superserve/sdk';

// Create a client (uses SUPERSERVE_API_KEY env var by default)
const client = new SuperserveClient({
  apiKey: 'your-api-key'
});

// Create an agent
const agent = await client.agents.create({
  name: 'my-assistant',
  model: 'claude-sonnet-4-20250514',
  systemPrompt: 'You are a helpful coding assistant.',
  tools: ['Bash', 'Read', 'Write', 'Glob', 'Grep']
});

// Run the agent and get the final output
const output = await client.runs.run({
  agentId: agent.id,
  prompt: 'List all TypeScript files in the current directory'
});

console.log(output);
```

## Streaming

For real-time output, use the streaming API:

```typescript
const stream = await client.runs.stream({
  agentId: agent.id,
  prompt: 'Explain how async/await works in JavaScript'
});

// Option 1: Iterate over events
for await (const event of stream) {
  switch (event.type) {
    case 'run.started':
      console.log('Run started:', event.runId);
      break;
    case 'message.delta':
      process.stdout.write(event.content);
      break;
    case 'tool.start':
      console.log(`\nUsing tool: ${event.tool}`);
      break;
    case 'tool.end':
      console.log(`Tool completed in ${event.durationMs}ms`);
      break;
    case 'run.completed':
      console.log('\nCompleted!', event.usage);
      break;
  }
}

// Option 2: Get final message directly
const message = await stream.finalMessage();

// Option 3: Pipe to stdout
await stream.pipeTo(process.stdout);

// Option 4: Use callback for text
await stream.onText((text) => {
  process.stdout.write(text);
});
```

## Agent Management

### Create an Agent

```typescript
const agent = await client.agents.create({
  name: 'code-reviewer',
  model: 'claude-sonnet-4-20250514',
  systemPrompt: 'You are an expert code reviewer. Be thorough but constructive.',
  tools: ['Read', 'Glob', 'Grep'],
  maxTurns: 20,
  timeoutSeconds: 600
});
```

### List Agents

```typescript
const agents = await client.agents.list({ limit: 10 });
for (const agent of agents) {
  console.log(`${agent.name} (${agent.id})`);
}
```

### Get Agent

```typescript
const agent = await client.agents.get('agt_xxx');
console.log(agent.model, agent.tools);
```

### Update Agent

```typescript
const updated = await client.agents.update('agt_xxx', {
  systemPrompt: 'Updated system prompt',
  maxTurns: 15
});
```

### Delete Agent

```typescript
await client.agents.delete('agt_xxx');
```

## Run Management

### List Runs

```typescript
// List all runs
const runs = await client.runs.list({ limit: 20 });

// Filter by agent
const agentRuns = await client.runs.list({
  agentId: 'agt_xxx',
  status: 'completed'
});
```

### Get Run

```typescript
const run = await client.runs.get('run_xxx');
console.log(run.status, run.output);
```

### Cancel Run

```typescript
const cancelled = await client.runs.cancel('run_xxx');
console.log('Cancelled:', cancelled.status);
```

### Resume Streaming

If a connection is lost, you can resume streaming:

```typescript
const stream = await client.runs.resumeStream('run_xxx');
for await (const event of stream) {
  // Handle remaining events
}
```

## Sessions

Maintain conversation context with sessions:

```typescript
const sessionId = 'session_123';

// First message
await client.runs.run({
  agentId: 'agt_xxx',
  prompt: 'What files are in the project?',
  sessionId
});

// Follow-up (agent remembers context)
await client.runs.run({
  agentId: 'agt_xxx',
  prompt: 'Now describe the main.ts file',
  sessionId
});
```

## Event Types

The SDK provides strongly-typed events:

```typescript
import type { RunEvent } from '@superserve/sdk';

function handleEvent(event: RunEvent) {
  switch (event.type) {
    case 'run.started':
      // event.runId: string
      break;
    case 'message.delta':
      // event.content: string
      break;
    case 'tool.start':
      // event.tool: string
      // event.input: Record<string, unknown>
      break;
    case 'tool.end':
      // event.tool: string
      // event.output: string
      // event.durationMs: number
      break;
    case 'run.completed':
      // event.runId: string
      // event.usage: UsageMetrics
      // event.durationMs: number
      break;
    case 'run.failed':
      // event.runId: string
      // event.error: { code?: string, message: string }
      break;
    case 'run.cancelled':
      // event.runId: string
      break;
  }
}
```

## Error Handling

The SDK provides typed errors for common scenarios:

```typescript
import {
  SuperserveError,
  SuperserveAPIError,
  AuthenticationError,
  NotFoundError,
  ConflictError,
  ValidationError,
  RunFailedError,
  RunCancelledError,
  StreamAbortedError
} from '@superserve/sdk';

try {
  await client.runs.run({ agentId, prompt });
} catch (error) {
  if (error instanceof AuthenticationError) {
    console.error('Invalid API key');
  } else if (error instanceof NotFoundError) {
    console.error('Agent not found');
  } else if (error instanceof RunFailedError) {
    console.error(`Run failed: ${error.message}`, error.code);
  } else if (error instanceof RunCancelledError) {
    console.error('Run was cancelled');
  } else if (error instanceof SuperserveAPIError) {
    console.error(`API error ${error.status}: ${error.message}`);
  }
}
```

## Configuration

### Environment Variables

The SDK supports these environment variables:

- `SUPERSERVE_API_KEY` - API key for authentication
- `SUPERSERVE_BASE_URL` - Custom API base URL (optional)

### Client Options

```typescript
const client = new SuperserveClient({
  // API key (defaults to SUPERSERVE_API_KEY env var)
  apiKey: 'your-api-key',

  // Base URL (defaults to https://api.superserve.ai)
  baseUrl: 'https://api.superserve.ai',

  // Additional headers for all requests
  headers: {
    'X-Custom-Header': 'value'
  },

  // Request timeout in ms (default: 30000)
  timeout: 30000
});
```

## Models

Available models:

- `claude-sonnet-4-20250514` (default) - Fast, balanced performance
- `claude-opus-4-20250514` - Most capable model
- `claude-haiku-3-5-20241022` - Fastest, most economical

## Tools

Available tools:

- `Bash` - Execute shell commands
- `Read` - Read files
- `Write` - Write files
- `Glob` - Find files by pattern
- `Grep` - Search file contents
- `WebSearch` - Search the web
- `WebFetch` - Fetch web content

## Browser Support

The SDK works in both Node.js 18+ and modern browsers. It uses native `fetch` with no external dependencies.

**Note:** When using in browsers, protect your API key by using a backend proxy. Never expose API keys in client-side code.

## TypeScript

Full TypeScript support with comprehensive type definitions:

```typescript
import type {
  Agent,
  AgentConfig,
  AgentModel,
  AgentTool,
  Run,
  RunStatus,
  RunEvent,
  UsageMetrics,
  CreateRunOptions,
  ListAgentsOptions,
  ListRunsOptions
} from '@superserve/sdk';
```

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting pull requests.

## License

MIT
