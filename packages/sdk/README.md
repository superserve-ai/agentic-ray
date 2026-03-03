# Superserve SDK

TypeScript SDK for interacting with Superserve agents. Supports one-shot runs, streaming responses, multi-turn sessions, and React integration.

## Install

```bash
bun add superserve
```

## Usage

```typescript
import Superserve from "@superserve/sdk"

const client = new Superserve({ apiKey: "your-api-key" })
```

### Run

```typescript
const result = await client.run("my-agent", { message: "Hello!" })
console.log(result.text)
```

### Stream

```typescript
const stream = client.stream("my-agent", { message: "Write a report" })

for await (const chunk of stream.textStream) {
  process.stdout.write(chunk)
}
```

### Sessions

```typescript
const session = await client.createSession("my-agent")

const r1 = await session.run("What files are in the project?")
const r2 = await session.run("Refactor the main module")

await session.end()
```

### React

```tsx
import { SuperserveProvider, useAgent } from "@superserve/sdk/react"

function App() {
  return (
    <SuperserveProvider apiKey="your-api-key">
      <Chat />
    </SuperserveProvider>
  )
}

function Chat() {
  const { messages, sendMessage, isStreaming } = useAgent({ agent: "my-agent" })

  return (
    <div>
      {messages.map((msg) => (
        <p key={msg.id}>{msg.content}</p>
      ))}
      <button onClick={() => sendMessage("Hello!")}>Send</button>
    </div>
  )
}
```

### List Agents

```typescript
const agents = await client.agents.list()
const agent = await client.agents.get("my-agent")
```

## License

MIT
