# Bot Core Architecture

`pluxel-plugin-bot-core` is the lowest layer in the chatbot stack.
It provides a cross-platform message model, a small parts/content DSL, and a predictable outbound pipeline.

This doc is an overview. For deeper outbound rules, see `plugins/chatbots/bot-core/src/DESIGN.md`.

## Goals

- One unified message abstraction across platforms (KOOK / Telegram / Milky / Sandbox).
- Keep platform-specific power accessible (`msg.bot` gives you the native platform object).
- Make sending “just work” by default (`msg.reply(...)`), while still allowing explicit control (`sendText/sendImage/...`).
- Keep the API surface small and stable.

## Public API surface

### Core runtime plugin

- `BotCore` (`plugins/chatbots/bot-core/src/bot-core.ts`): a Pluxel service plugin (`name: 'bot-core'`).
- `BotCore.runtime`: manages bridges, adapter registry, event channel, and status tracking.

### Message model

- `Message` / `AnyMessage` (`plugins/chatbots/bot-core/src/types.ts`): platform-discriminated message type.
- `Part[]` (`MessageContent`): a single message payload.
- `MessageBatch` (`plugins/chatbots/bot-core/parts/content.ts`): explicit “multiple messages” payload.

### Parts & content helpers

- `parts\`...\`` + `p.*` builders (`plugins/chatbots/bot-core/parts/*`): build `Part[]` safely.
- `mc.*` (`plugins/chatbots/bot-core/parts/content.ts`): small helpers for common cases:
  - `mc.text(...)`, `mc.json(...)`, `mc.imageData(...)`, `mc.of(...)`
  - `mc.batch(...)`, `mc.batchBestEffort(...)`

### Outbound send surface

Every `msg` exposes:

- `msg.reply(payload, options?)` where `payload = Part[] | MessageBatch`
  - `Part[]` is a “single message intent”, but may be split by the outbound pipeline when necessary.
  - `MessageBatch` is an explicit “multiple messages intent” (ordered); `atomic` controls fail-fast vs best-effort.
- `msg.sendText(content)` and optional `sendImage/sendAudio/sendVideo/sendFile`: explicit atomic ops.

## Directory layout

- `plugins/chatbots/bot-core/src/bot-core.ts`: service plugin entrypoint.
- `plugins/chatbots/bot-core/src/types.ts`: public types (Message, AdapterPolicy, ReplyPayload, …).
- `plugins/chatbots/bot-core/src/adapter/`: adapter interface + registry + outbound helpers.
- `plugins/chatbots/bot-core/src/bridge/`: per-platform bridge + normalize + adapter policy.
- `plugins/chatbots/bot-core/src/outbound/`: outbound planning + compile + reply implementation.
- `plugins/chatbots/bot-core/src/media/`: attachment/media collection + resolution utilities.
- `plugins/chatbots/bot-core/src/cmd/` and `plugins/chatbots/bot-core/src/chat/`: lightweight command bus + chat command parsing.
- `plugins/chatbots/bot-core/parts/`: Parts DSL, validation, and content helpers.

## Key flows

### Inbound flow (platform -> AnyMessage)

1. A platform bridge attaches to the native platform plugin instance (e.g. Telegram).
2. The bridge normalizes the native session into `Message<'platform'>`.
3. The runtime dispatches the normalized message through:
   - `BotCore.events.message` (all messages)
   - `BotCore.events.text` (text-only)
   - `BotCore.events.rich` (rich/media)

### Outbound flow (reply/send)

Outbound is deliberately layered:

- **Call site**: plugin code returns/builds `Part[]` (or `MessageBatch`).
- **Validation**: invalid parts throw early at the send boundary.
- **Planning**: parts are planned into an ordered operation sequence (text/media/caption rules).
- **Adapter**: each operation is sent through the platform adapter (upload if needed + send).

The convenience layer (`reply`) prioritizes “get something out” without silent truncation:

- unsupported media can be degraded (best-effort) or rejected (`options.mode='strict'`)
- caption may be split into multiple messages if needed (best-effort)

## Extension points

- Add a new platform:
  - define an adapter policy + renderer + send/upload implementation (`src/bridge/<platform>/adapter.ts`)
  - implement a bridge that hooks the platform plugin and normalizes sessions (`src/bridge/<platform>/index.ts`)
  - augment `BotCorePlatformPolicyRegistry` for better typing (`src/types.ts`)

- Add higher-level semantics:
  - keep bot-core minimal, implement permissions/users/command suites in `pluxel-plugin-bot-suite` (facade + runtime).

