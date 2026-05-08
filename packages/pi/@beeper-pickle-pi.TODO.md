# @beeper/pickle-pi TODO

Package target: `packages/pi` in `/Users/batuhan/Projects/labs/pickle`.

Goal: a Beeper-only, proper Matrix appservice bridge for remote-controlling Pi from Beeper Desktop/mobile. The day-one product is a headless appservice agent with a Pi ghost/puppet that auto-creates one Beeper room per Pi session, groups sessions by project Spaces, streams Pi events into Beeper Desktop's native AI UI, and stores normal Pi session files that can later be resumed in the terminal. Terminal mirroring/resume support is designed in from day one but can ship after the appservice MVP.

## Scope decision

- Focus only on Beeper clients, especially Beeper Desktop.
- Do not optimize UX for generic Matrix clients except as a graceful fallback.
- Use Beeper native AI stream support (`com.beeper.stream.update`, `com.beeper.ai`, `com.beeper.llm.deltas`) instead of Telegram-style debounced text edits as the primary rendering path.
- Build a Pi package/extension named `@beeper/pickle-pi`.

## References: Pi source and docs

Pi upstream checkout: `/Users/batuhan/Projects/labs/upstream/pi-mono`.

Important Pi extension API references:

- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/docs/extensions.md`
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts`
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/agent-session.ts`
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/session-manager.ts`
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/agent-session-runtime.ts`
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/index.ts`
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/examples/extensions/event-bus.ts`
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/examples/extensions/send-user-message.ts`
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/examples/extensions/provider-payload.ts`
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/examples/extensions/permission-gate.ts`
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/examples/extensions/dynamic-tools.ts`

Pi events available to a normal extension are defined at:

- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:1084` (`ExtensionAPI.on(...)` overloads)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:513` (`SessionStartEvent`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:522` (`SessionBeforeSwitchEvent`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:529` (`SessionBeforeForkEvent`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:536` (`SessionBeforeCompactEvent`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:545` (`SessionCompactEvent`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:552` (`SessionShutdownEvent`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:575` (`SessionBeforeTreeEvent`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:582` (`SessionTreeEvent`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:605` (`ContextEvent`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:611` (`BeforeProviderRequestEvent`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:617` (`AfterProviderResponseEvent`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:624` (`BeforeAgentStartEvent`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:637` (`AgentStartEvent`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:642` (`AgentEndEvent`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:648` (`TurnStartEvent`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:655` (`TurnEndEvent`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:663` (`MessageStartEvent`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:669` (`MessageUpdateEvent`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:676` (`MessageEndEvent`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:682` (`ToolExecutionStartEvent`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:690` (`ToolExecutionUpdateEvent`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:699` (`ToolExecutionEndEvent`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:714` (`ModelSelectEvent`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:722` (`ThinkingLevelSelectEvent`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:733` (`UserBashEvent`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:751` (`InputEvent`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:771` onward (`ToolCallEvent`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:832` onward (`ToolResultEvent`)

Pi session replacement and control APIs:

- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/docs/extensions.md:993` (`ctx.newSession`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/docs/extensions.md:1026` (`ctx.fork`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/docs/extensions.md:1052` (`ctx.navigateTree`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/docs/extensions.md:1069` (`ctx.switchSession`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/docs/extensions.md:1114` (session replacement lifecycle footguns)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/docs/extensions.md:1291` (`pi.sendUserMessage`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:312` (`ctx.isIdle()`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:318` (`ctx.hasPendingMessages()`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:324` (`ctx.compact()`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:338` (`ctx.newSession()`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:351` (`ctx.navigateTree()`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:357` (`ctx.switchSession()`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/extensions/types.ts:369` (`ReplacedSessionContext`)

Pi direct `AgentSession` references for bridge-owned sessions:

- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/agent-session.ts:121` (`AgentSessionEvent`)
- `/Users/batuhan/Projects/labs/upstream/pi-mono/packages/coding-agent/src/core/agent-session.ts:143` (`AgentSessionEventListener`)
- `/Users/batuhan/Projects/labs/upstream/pi/samfp__pi-telegram-bot/src/thread-session.ts:1` imports `createAgentSession`, `createCodingTools`, `DefaultResourceLoader`, `SessionManager as PiSessionManager`
- `/Users/batuhan/Projects/labs/upstream/pi/samfp__pi-telegram-bot/src/thread-session.ts:82` opens one Pi session file per thread
- `/Users/batuhan/Projects/labs/upstream/pi/samfp__pi-telegram-bot/src/thread-session.ts:89` creates an `AgentSession`
- `/Users/batuhan/Projects/labs/upstream/pi/samfp__pi-telegram-bot/src/thread-session.ts:135` subscribes to `AgentSessionEvent`

## References: existing Pi messaging/Telegram/WhatsApp integrations

Checked out package/repo directory: `/Users/batuhan/Projects/labs/upstream/pi`.

Simple companion/relay references:

- `/Users/batuhan/Projects/labs/upstream/pi/whatsapp-pi/whatsapp-pi.ts`
- `/Users/batuhan/Projects/labs/upstream/pi/whatsapp-pi/README.md`
- `/Users/batuhan/Projects/labs/upstream/pi/acarerdinc__pi-telebridge/src/index.ts`
- `/Users/batuhan/Projects/labs/upstream/pi/acarerdinc__pi-telebridge/README.md`
- `/Users/batuhan/Projects/labs/upstream/pi/telegram-pi-npm/extensions/telegram-pi.ts`

Mature extension-runtime/queue/control reference:

- `/Users/batuhan/Projects/labs/upstream/pi/llblab__pi-telegram/index.ts`
- `/Users/batuhan/Projects/labs/upstream/pi/llblab__pi-telegram/lib/lifecycle.ts`
- `/Users/batuhan/Projects/labs/upstream/pi/llblab__pi-telegram/lib/queue.ts`
- `/Users/batuhan/Projects/labs/upstream/pi/llblab__pi-telegram/lib/preview.ts`
- `/Users/batuhan/Projects/labs/upstream/pi/llblab__pi-telegram/lib/replies.ts`
- `/Users/batuhan/Projects/labs/upstream/pi/llblab__pi-telegram/lib/rendering.ts`
- `/Users/batuhan/Projects/labs/upstream/pi/llblab__pi-telegram/lib/routing.ts`
- `/Users/batuhan/Projects/labs/upstream/pi/llblab__pi-telegram/lib/status.ts`
- `/Users/batuhan/Projects/labs/upstream/pi/llblab__pi-telegram/docs/architecture.md`
- `/Users/batuhan/Projects/labs/upstream/pi/llblab__pi-telegram/docs/callback-namespaces.md`
- `/Users/batuhan/Projects/labs/upstream/pi/llblab__pi-telegram/docs/inbound-handlers.md`
- `/Users/batuhan/Projects/labs/upstream/pi/llblab__pi-telegram/docs/outbound-handlers.md`

Bridge-owned session reference:

- `/Users/batuhan/Projects/labs/upstream/pi/samfp__pi-telegram-bot/src/thread-session.ts`
- `/Users/batuhan/Projects/labs/upstream/pi/samfp__pi-telegram-bot/src/session-manager.ts`
- `/Users/batuhan/Projects/labs/upstream/pi/samfp__pi-telegram-bot/src/session-registry.ts`
- `/Users/batuhan/Projects/labs/upstream/pi/samfp__pi-telegram-bot/src/streaming-updater.ts`
- `/Users/batuhan/Projects/labs/upstream/pi/samfp__pi-telegram-bot/src/telegram.ts`

Multi-topic/session routing reference:

- `/Users/batuhan/Projects/labs/upstream/pi/AlekseiSeleznev__pi-telegram-group-topic-npm/index.ts`
- `/Users/batuhan/Projects/labs/upstream/pi/AlekseiSeleznev__pi-telegram-group-topic-npm/lib/routing.ts`
- `/Users/batuhan/Projects/labs/upstream/pi/AlekseiSeleznev__pi-telegram-group-topic-npm/lib/session-registry.ts`
- `/Users/batuhan/Projects/labs/upstream/pi/AlekseiSeleznev__pi-telegram-group-topic-npm/docs/multi-topic-routing.md`

Multi-transport references:

- `/Users/batuhan/Projects/labs/upstream/pi/tintinweb__pi-messenger-bridge/src/index.ts`
- `/Users/batuhan/Projects/labs/upstream/pi/tintinweb__pi-messenger-bridge/src/transports/telegram.ts`
- `/Users/batuhan/Projects/labs/upstream/pi/tintinweb__pi-messenger-bridge/src/transports/whatsapp.ts`
- `/Users/batuhan/Projects/labs/upstream/pi/tintinweb__pi-messenger-bridge/src/transports/slack.ts`
- `/Users/batuhan/Projects/labs/upstream/pi/tintinweb__pi-messenger-bridge/src/transports/discord.ts`
- `/Users/batuhan/Projects/labs/upstream/pi/e9n__pi-channels-npm/src/index.ts`
- `/Users/batuhan/Projects/labs/upstream/pi/e9n__pi-channels-npm/src/bridge/rpc-runner.ts`
- `/Users/batuhan/Projects/labs/upstream/pi/e9n__pi-channels-npm/src/adapters/telegram.ts`

## References: Pickle source

Pickle checkout: `/Users/batuhan/Projects/labs/pickle`.

Core package references:

- `/Users/batuhan/Projects/labs/pickle/packages/pickle/src/types.ts`
- `/Users/batuhan/Projects/labs/pickle/packages/pickle/src/client-types.ts`
- `/Users/batuhan/Projects/labs/pickle/packages/pickle/src/client.ts`
- `/Users/batuhan/Projects/labs/pickle/packages/pickle/src/events.ts`
- `/Users/batuhan/Projects/labs/pickle/packages/pickle/src/media.ts`
- `/Users/batuhan/Projects/labs/pickle/packages/pickle/src/auth.ts`
- `/Users/batuhan/Projects/labs/pickle/packages/pickle/src/node.ts`
- `/Users/batuhan/Projects/labs/pickle/packages/pickle/src/streams/index.ts`
- `/Users/batuhan/Projects/labs/pickle/packages/pickle/src/streams/beeper.ts`
- `/Users/batuhan/Projects/labs/pickle/packages/pickle/src/streams/edits.ts`
- `/Users/batuhan/Projects/labs/pickle/packages/pickle/src/client.test.ts`

Pickle stream API references:

- `/Users/batuhan/Projects/labs/pickle/packages/pickle/src/types.ts:28` (`MatrixBeeperStreamDescriptor`)
- `/Users/batuhan/Projects/labs/pickle/packages/pickle/src/types.ts:31` (`MatrixStream`)
- `/Users/batuhan/Projects/labs/pickle/packages/pickle/src/types.ts:33` (`SendMatrixStreamOptions`)
- `/Users/batuhan/Projects/labs/pickle/packages/pickle/src/client-types.ts:154` (`MatrixStreams.send`)
- `/Users/batuhan/Projects/labs/pickle/packages/pickle/src/streams/index.ts:13` (`sendStream` mode selection)
- `/Users/batuhan/Projects/labs/pickle/packages/pickle/src/streams/beeper.ts:7` (`sendBeeperStream`)
- `/Users/batuhan/Projects/labs/pickle/packages/pickle/src/streams/beeper.ts:13` creates `com.beeper.llm` stream
- `/Users/batuhan/Projects/labs/pickle/packages/pickle/src/streams/beeper.ts:20` sends target message with `com.beeper.ai` and `com.beeper.stream`
- `/Users/batuhan/Projects/labs/pickle/packages/pickle/src/streams/beeper.ts:31` registers the stream
- `/Users/batuhan/Projects/labs/pickle/packages/pickle/src/streams/beeper.ts:444` publishes `*.deltas`
- `/Users/batuhan/Projects/labs/pickle/packages/pickle/src/streams/edits.ts:5` generic Matrix edit fallback

Pickle AI SDK references:

- `/Users/batuhan/Projects/labs/pickle/packages/ai-sdk/README.md`
- `/Users/batuhan/Projects/labs/pickle/packages/ai-sdk/src/index.ts`
- `/Users/batuhan/Projects/labs/pickle/packages/ai-sdk/src/index.test.ts`

Pickle chat adapter references:

- `/Users/batuhan/Projects/labs/pickle/packages/chat-adapter/README.md`
- `/Users/batuhan/Projects/labs/pickle/packages/chat-adapter/src/adapter.ts`
- `/Users/batuhan/Projects/labs/pickle/packages/chat-adapter/src/streaming/index.ts`
- `/Users/batuhan/Projects/labs/pickle/packages/chat-adapter/src/streaming/homeserver.ts`

Bridge/appservice references, possibly useful later for bridge bot/appservice mode:

- `/Users/batuhan/Projects/labs/pickle/packages/bridge/README.md`
- `/Users/batuhan/Projects/labs/pickle/packages/bridge/src/bridge.ts`
- `/Users/batuhan/Projects/labs/pickle/packages/bridge/src/appservice-websocket.ts`
- `/Users/batuhan/Projects/labs/pickle/packages/bridge/src/beeper.ts`
- `/Users/batuhan/Projects/labs/pickle/packages/bridge/src/types.ts`

## References: Beeper Desktop AI stream support

Desktop checkout: `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop`.

AI stream/content references:

- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/common/ai-common.ts`
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/common/types/beeper.ts`
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/renderer/stores/AIChatsStore.ts`
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/renderer/ai/ui-message.ts`
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/renderer/ai/stream-ordering.ts`
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/renderer/ai/tool-approval.ts`
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/renderer/stores/AIToolApprovalsStore.ts`
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/renderer/ai/AIToolCallsPanel.tsx`

Desktop stream wire constants and types:

- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/common/ai-common.ts:53` `AI_EVENT_STREAM_UPDATE = 'com.beeper.stream.update'`
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/common/ai-common.ts:54` `AI_CONTENT_KEY = 'com.beeper.ai'`
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/common/ai-common.ts:55` approval reaction allow once
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/common/ai-common.ts:56` approval reaction allow always
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/common/ai-common.ts:57` approval reaction deny
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/common/ai-common.ts:60` `ApprovalResponseUIMessageChunk`
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/common/types/beeper.ts:698` `BeeperAIStreamUpdate`
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/common/types/beeper.ts:706` `BeeperAIStreamContent`
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/common/types/beeper.ts:721` `StreamStateSyncEvent`
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/common/types/beeper.ts:758` `BeeperMessageExtra.ai` / `.stream`
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/renderer/stores/AIChatsStore.ts:106` extracts `*.deltas`
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/renderer/stores/AIChatsStore.ts:126` gets stream entries from single-update or batched replay
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/renderer/stores/AIChatsStore.ts:209` applies stream events
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/renderer/stores/AIChatsStore.ts:557` handles approval request parts
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/renderer/stores/AIChatsStore.ts:565` handles approval response parts
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/renderer/ai/ui-message.ts:596` supports `tool-input-start`
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/renderer/ai/ui-message.ts:607` supports `tool-input-delta`
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/renderer/ai/ui-message.ts:616` supports `tool-input-available`
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/renderer/ai/ui-message.ts:647` supports `tool-approval-request`
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/renderer/ai/ui-message.ts:657` supports `tool-approval-response`
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/renderer/ai/ui-message.ts:669` supports `tool-output-available`
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/renderer/ai/ui-message.ts:678` supports `tool-output-error`
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/renderer/ai/ui-message.ts:687` supports `tool-output-denied`

## Best architecture

Implement appservice-first architecture with a headless bridge-owned Pi runtime as the primary product and a terminal-attached runtime as a later companion. Shared code must live in a core layer so the appservice agent and future Pi extension use the same registry, stream mapping, history import, approval policy, and room/space model.

### Primary mode: appservice/headless bridge-owned runtime

This is the day-one product. It runs without a terminal Pi TUI process.

Responsibilities:

- Run as a proper Matrix/Beeper appservice bridge.
- Own a service bot and a Pi ghost/puppet identity displayed as **Pi**.
- Auto-create Matrix rooms for Pi sessions.
- Auto-create Matrix Spaces for projects/cwds and attach session rooms to those Spaces.
- Create/open one normal Pi session file per Beeper room.
- Run headless Pi `AgentSession`s for Beeper-originated messages.
- Subscribe directly to `AgentSessionEvent` and stream to Beeper Desktop's native AI UI.
- Mirror everything generated by the headless Pi session into the room.
- Persist enough metadata that a future terminal extension can resume the same session visibly.

Implementation details:

- Use the pattern in `/Users/batuhan/Projects/labs/upstream/pi/samfp__pi-telegram-bot/src/thread-session.ts`.
- Use a bridge/appservice package entry such as `@beeper/pickle-pi-agent`, not a Pi extension, for the main MVP.
- Appservice registration should reserve exclusive namespaces for service/ghost users and aliases.
- Open a normal Pi-compatible session file under a bridge-managed directory, e.g. `~/.pi/pickle-pi/sessions/<encoded-cwd>/<session-id>.jsonl`, unless importing an existing terminal session file.
- Use `PiSessionManager.open(sessionFilePath, nativeSessionDir)`.
- Use `new DefaultResourceLoader({ cwd })` then `resourceLoader.reload()`.
- Use `createAgentSession({ cwd, sessionManager, tools: createCodingTools(cwd), customTools: [], resourceLoader })`.
- Bridge-owned sessions must load all user/project Pi extensions by default.
- Guard against recursive `@beeper/pickle-pi` startup in owned sessions using runtime env/flags/locks, not by disabling all extensions.
- Subscribe to `AgentSessionEvent` and route events through the shared event-to-Beeper-stream mapper.

### Future companion mode: terminal-attached Pi extension

This is not the MVP, but the appservice data model must support it from day one.

Responsibilities:

- Discover Beeper/appservice-owned sessions and resume them in the visible terminal Pi TUI.
- Observe terminal-created sessions and import/mirror them into Beeper rooms.
- Keep terminal `/resume`, `/new`, `/fork`, `/tree`, `/compact`, model changes, thinking-level changes, tool lifecycle, streaming assistant deltas, and final messages mirrored to Beeper.
- Ensure terminal and appservice do not concurrently write the same Pi session without coordination.

Implementation details:

- Implement in a later package/entry such as `@beeper/pickle-pi`.
- Register lifecycle hooks with `ExtensionAPI.on`.
- On `session_start`, determine `sessionFile = ctx.sessionManager.getSessionFile()` and register/restore a binding.
- On `session_start(reason: 'resume')`, if the resumed file has a binding, continue mirroring in the existing Beeper room; otherwise auto-create a room and import history.
- Provide a custom `/pickle-pi-resume` command later if Pi's normal session list does not surface bridge-owned sessions cleanly enough.

### Appservice/transport layer

Responsibilities:

- Generate and run a Matrix appservice registration.
- Receive appservice transactions or websocket appservice events.
- Manage ghost user intent for **Pi**.
- Create rooms and Spaces automatically.
- Subscribe to incoming Matrix events, reactions, edits, and approval responses.
- Send Beeper native AI streams as the Pi ghost.
- Persist registry and dedupe state.

Implementation details:

- Use and extend Pickle appservice/bridge APIs where possible:
  - `/Users/batuhan/Projects/labs/pickle/packages/bridge/src/bridge.ts`
  - `/Users/batuhan/Projects/labs/pickle/packages/bridge/src/appservice-websocket.ts`
  - `/Users/batuhan/Projects/labs/pickle/packages/bridge/src/beeper.ts`
  - `/Users/batuhan/Projects/labs/pickle/packages/bridge/src/types.ts`
- Appservice registration should include exclusive user and alias namespaces for Pi bridge users/rooms.
- Store appservice/bridge state under `~/.pi/pickle-pi/`.
- Store bridge registry under `~/.pi/pickle-pi/registry.sqlite` or `registry.json` initially.
- Use appservice transaction dedupe rather than a normal Matrix sync cursor as the final day-one architecture.
- If early local development uses a logged-in Matrix account, treat it as temporary scaffolding and do not let it shape APIs.

## Data model

### Binding

```ts
type PicklePiBinding = {
  id: string;
  roomId: string;
  spaceId?: string;
  cwd: string;
  piSessionFile: string;
  owner: 'appservice' | 'terminal' | 'imported';
  mode: 'headless' | 'terminal-attached';
  piGhostUserId: string;
  serviceBotUserId?: string;
  createdAt: number;
  updatedAt: number;
  activeLeafId?: string;
  sessionName?: string;
  lastPiEntryId?: string;
  lastMatrixEventId?: string;
  lastStreamTargetEventId?: string;
};
```

### Active run

```ts
type ActiveRun = {
  bindingId: string;
  turnId: string;
  targetEventId?: string;
  roomId: string;
  seq: number;
  textPartId?: string;
  reasoningPartId?: string;
  toolCallIdToApprovalId: Record<string, string>;
  finalTextBuffer: string;
  startedAt: number;
};
```

### Inbound Matrix turn

```ts
type MatrixInboundTurn = {
  id: string;
  roomId: string;
  eventId: string;
  sender: string;
  text: string;
  images?: Array<{ mimeType: string; data: string }>;
  files?: Array<{ name: string; mimeType?: string; path: string; matrixMxc?: string }>;
  receivedAt: number;
  priority: 'control' | 'priority' | 'default';
};
```

## Feature list and implementation details

### 1. Installation/package shape

- Package name: `@beeper/pickle-pi`.
- Pi manifest must expose an extension entry, e.g. `./src/index.ts` or built `dist/index.js` depending package conventions.
- Add package metadata in `packages/pi/package.json` if not already present.
- Add README with Beeper-specific setup.
- Add config command `/pickle-pi-setup`.

### 2. Beeper login/setup

Features:

- Configure homeserver, token/session, account, store path, recovery key if needed.
- Store secrets with `0600` permissions.
- Support env vars for automation.

Implementation details:

- Config path: `~/.pi/pickle-pi/config.json`.
- Env vars: `PICKLE_PI_HOMESERVER`, `PICKLE_PI_ACCESS_TOKEN`, `PICKLE_PI_RECOVERY_KEY`, `PICKLE_PI_PICKLE_KEY`, `PICKLE_PI_STORE_PATH`.
- Use Pickle auth helpers where appropriate:
  - `/Users/batuhan/Projects/labs/pickle/packages/pickle/src/auth.ts`
  - `/Users/batuhan/Projects/labs/pickle/packages/pickle/src/node.ts`

### 3. Matrix sync ownership

Features:

- Exactly one active sync loop per Matrix device/store.
- Explicit `/pickle-pi-connect`, `/pickle-pi-disconnect`, `/pickle-pi-status`.
- Reacquire stale lock after process restart.

Implementation details:

- Copy conceptual lock behavior from `/Users/batuhan/Projects/labs/upstream/pi/llblab__pi-telegram/docs/architecture.md` Runtime Ownership section where useful for local process ownership.
- Lock file should include pid, cwd, startedAt, appserviceId, and ghost user namespace.
- Final architecture uses appservice transaction delivery/dedupe, not a user-device sync loop.

### 4. Terminal session discovery and mirroring

Features:

- Terminal Pi sessions appear in Beeper.
- Terminal `/resume` is synced.
- Terminal `/new` creates or links a Beeper room.
- Terminal `/fork` and `/tree` navigation produce Beeper notices and eventually branch/session-room mapping.
- Terminal model/thinking changes appear in Beeper.

Implementation details:

- This is future terminal-extension work, not the appservice MVP.
- On `session_start`, create or load binding for `ctx.sessionManager.getSessionFile()`.
- On unknown terminal session, always auto-create a Beeper room and import history.
- On `session_before_switch(reason: 'resume')`, record `targetSessionFile`.
- On `session_start(reason: 'resume')`, switch active binding to target file and continue mirroring in the bound room.
- On `session_before_fork`/`session_tree`, create Matrix notices and branch/session rooms as needed under the project Space.

### 5. Beeper-created sessions

Features:

- Beeper can start new Pi sessions.
- One Beeper room maps to exactly one Pi session.
- Many Beeper rooms can run many appservice-owned Pi sessions.
- Appservice-owned sessions can later be resumed in the terminal.

Implementation details:

- Commands from Beeper:
  - `/pi new <cwd>`: create appservice-owned session room and Pi session file.
  - `/pi attach <session>`: advanced recovery command to bind current room to an existing Pi session file.
  - `/pi resume`: continue mapped session.
  - `/pi status`: show binding/session status.
- On new session request:
  - auto-create project Space if needed,
  - auto-create session room,
  - invite authorized user/collaborators,
  - join/send as Pi ghost,
  - create normal Pi session file,
  - persist binding.
- Use direct headless `AgentSession` mode for Beeper/appservice-owned sessions.

### 6. Inbound Beeper message handling

Features:

- Text messages become Pi prompts.
- Image messages become Pi image content.
- File messages are downloaded to a temp/staging directory and referenced in prompt text.
- Message replies include quoted context.
- Edits to waiting messages update queued prompt if not dispatched yet.
- Reactions can prioritize/cancel waiting turns.

Implementation details:

- Store inbound attachments in `~/.pi/pickle-pi/tmp/<bindingId>/`.
- Use Pickle media helpers: `/Users/batuhan/Projects/labs/pickle/packages/pickle/src/media.ts`.
- Queue design should follow `/Users/batuhan/Projects/labs/upstream/pi/llblab__pi-telegram/lib/queue.ts`.
- Dispatch only when session is idle, no active bridge turn, no pending messages, and no compaction.

### 7. Assistant token/reasoning streaming

Features:

- Stream assistant text to Beeper Desktop in real time.
- Stream thinking/reasoning blocks when Pi exposes them.
- Finalize with persisted `com.beeper.ai` content.

Implementation details:

- Primary path: Pickle Beeper stream mode.
- Use `client.streams.send()` or lower-level `beeper.streams.create/register/publish` if incremental control is needed.
- Map Pi `message_update.assistantMessageEvent`:
  - `text_delta` -> `{ type: 'text-delta', id, delta }`
  - `thinking_delta` -> `{ type: 'reasoning-delta', id, delta }`
  - start/end events -> `text-start`, `text-end`, `reasoning-start`, `reasoning-end` when available/derivable.
- Ensure monotonically increasing `seq` per `turn_id` because Desktop stream ordering depends on it (`AIChatsStore.ts` + `stream-ordering.ts`).

### 8. Tool lifecycle streaming

Features:

- Show tool inputs and outputs in Beeper Desktop AI tool UI.
- Include errors, preliminary output, and final output.
- Preserve toolCallId.
- Handle parallel tools.

Implementation details:

- Map Pi events:
  - `tool_call` -> `tool-input-available` with `toolName`, `toolCallId`, `input`.
  - `tool_execution_start` -> if no prior input, `tool-input-available`; also optionally `data-pi-tool-start`.
  - `tool_execution_update` -> `tool-output-available` with `preliminary: true` or `data-pi-tool-update`.
  - `tool_result` -> `tool-output-available` / `tool-output-error` with structured content.
  - `tool_execution_end` -> terminal status if `tool_result` did not already finalize.
- Desktop supports these chunk types at `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/renderer/ai/ui-message.ts:596` onward.
- Do not rely on completion order for source order. Use `toolCallId` and Pi message content where possible.

### 9. Tool approval / permission bridge

Features:

- Display Pi permission/tool approval requests in Beeper Desktop.
- Let user approve once, approve always, or deny from Beeper Desktop.

Implementation details:

- Desktop supports approval constants and chunks:
  - `tool-approval-request`
  - `tool-approval-response`
  - reactions `approval.allow_once`, `approval.allow_always`, `approval.deny`
- Pickle currently sends/accumulates approval chunks but the Pi bridge must provide the interactive policy.
- Implement as a Pi `tool_call` handler that can pause and wait for Beeper approval for configured tools/paths/commands.
- Emit `tool-approval-request` with unique `approvalId` and `toolCallId`.
- Listen for Matrix reactions or Beeper approval response events, then return allow/block from `tool_call` handler.
- If Pickle lacks a typed helper for approval response events, add one in Pickle because this is useful for any AI/tool integration.

### 10. Session tree, forks, and branches

Features:

- Represent Pi session tree operations in Beeper.
- Allow Beeper users to fork/branch from prior points if Pi exposes enough IDs.
- Show compaction and tree navigation notices.

Implementation details:

- Store Pi entry IDs in Matrix event metadata when mirroring entries.
- On `session_before_fork`, create pending branch notice.
- On `session_start(reason: 'fork')`, create new Beeper room bound to fork session file and attach it to the project Space.
- On `session_tree`, post notice with `oldLeafId`, `newLeafId`, and summary info.
- Future enhancement: Beeper command `/pi fork <entryId>` calls `ctx.fork(entryId)` in attached mode or direct `AgentSession` equivalent in owned mode if available.

### 11. Model and thinking controls

Features:

- Show active model and thinking level in Beeper.
- Allow Beeper commands/buttons to switch model/thinking.

Implementation details:

- Observe `model_select` and `thinking_level_select`.
- Commands:
  - `/pi model` list models.
  - `/pi model <provider>/<id>` set model.
  - `/pi thinking <level>` set thinking.
- For terminal-attached mode use `pi.setModel` / `ctx.setThinkingLevel` equivalent from extension APIs.
- For owned mode call `AgentSession.setModel` / `AgentSession.setThinkingLevel`.

### 12. Queue and steering semantics

Features:

- Beeper messages can steer or follow up.
- Queue visible in Beeper and terminal status.
- Cancel/prioritize queued turns.

Implementation details:

- Attached mode should use `pi.sendUserMessage(content, { deliverAs: 'steer' | 'followUp' })` when appropriate.
- Owned mode should serialize prompts through a bridge queue around `AgentSession.prompt`.
- Default Beeper behavior while busy: follow-up queue. Add explicit `/pi steer <text>` for steering.
- Mirror queue status to `ctx.ui.setStatus` in attached mode.

### 13. Local terminal broadcast controls

Features:

- Optionally broadcast local terminal prompts/final answers to Beeper.
- Avoid echo loops for Beeper-originated turns.

Implementation details:

- Mirror everything by default once terminal companion extension exists.
- Config commands may still exist to pause/resume mirroring for privacy or debugging:
  - `/pickle-pi-broadcast-on`
  - `/pickle-pi-broadcast-off`
  - `/pickle-pi-broadcast-status`
- Use origin tags and dedupe to avoid echo loops for Beeper-originated turns.
- Compare `/Users/batuhan/Projects/labs/upstream/pi/llblab__pi-telegram/docs/architecture.md` proactive push behavior, but default is stronger here: mirror all.

### 14. Room/Space UX in Beeper Desktop

Features:

- One Beeper room per Pi session always.
- Matrix Spaces group session rooms by project/cwd.
- Clear room names and session labels.
- Use Beeper AI message UI for assistant responses.

Implementation details:

- Auto-create one project Space per cwd/project key.
- Auto-create one session room per Pi session and attach it to the project Space.
- Room topic/state should include cwd, model, thinking level, Pi session file, status, and appservice bridge metadata.
- Do not use Matrix thread relations as the primary session model.
- Threads may still be used inside a session room for replies/comments if useful, but room == Pi session is invariant.

### 15. History import/backfill

Features:

- Import existing Pi session into a Beeper room.
- Include user, assistant, tool result, compaction, branch summary, custom messages when possible.

Implementation details:

- Read `ctx.sessionManager.getEntries()` in attached mode.
- Serialize user messages as user-like Matrix messages or notices.
- Serialize assistant messages as final `com.beeper.ai` messages if possible.
- Serialize tool calls/results into `com.beeper.ai.parts` so Desktop can render them.
- Mark imported events with metadata to avoid re-import duplication.

### 16. Attachments and artifacts

Features:

- Inbound Beeper images/files are available to Pi.
- Pi-generated artifacts can be sent back to Beeper.

Implementation details:

- Register `pickle_pi_attach` tool:
  - params: path, label?, mimeType?, caption?
  - sends file/photo/document to current Beeper session room after/while turn completes.
- For assistant-generated local files, optionally detect file paths in tool results and provide upload affordance.
- Use Pickle media upload APIs; extend Pickle if upload/download typed helpers are insufficient.

### 17. Error handling and recovery

Features:

- Matrix sync reconnects after transient errors.
- Poison events do not block sync forever.
- Failed streams are finalized with `error` chunk.
- Aborted Pi turns are finalized with `abort` chunk.

Implementation details:

- Persist last processed event IDs / sync token via Pickle store.
- Maintain inbound event dedupe table.
- On exception during active run, publish `{ type: 'error', errorText }`.
- On abort, publish `{ type: 'abort' }`.

### 18. Security

Features:

- Only authorized Beeper users/rooms can control Pi.
- Secrets are protected.
- Dangerous tools can require approval.

Implementation details:

- Config allow-list by Matrix user ID and room ID.
- Store tokens/recovery keys with `0600` permissions.
- Never log access tokens, pickle keys, recovery keys, or Matrix session stores.
- Follow `/Users/batuhan/Projects/labs/pickle/SECURITY.md`.

### 19. Tests

Required tests:

- Unit tests for Pi event -> Beeper UIMessageChunk mapping.
- Unit tests for registry persistence.
- Unit tests for queue dispatch ordering.
- Unit tests for Desktop-compatible stream sequence ordering.
- Unit tests for approval request/response flow.
- Integration test with mocked Pickle client.
- Optional live E2E using existing Pickle e2e harness patterns.

Reference test files:

- `/Users/batuhan/Projects/labs/pickle/packages/pickle/src/client.test.ts`
- `/Users/batuhan/Projects/labs/pickle/packages/ai-sdk/src/index.test.ts`
- `/Users/batuhan/Projects/labs/upstream/pi/llblab__pi-telegram/tests/runtime.test.ts`
- `/Users/batuhan/Projects/labs/upstream/pi/llblab__pi-telegram/tests/queue.test.ts`
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/common/ai-common.test.ts`
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/renderer/ai/ui-message.test.ts`
- `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop/src/renderer/ai/tool-approval.test.ts`

## Pickle extension TODOs useful beyond Pi

Add these to Pickle if missing or too low-level:

1. Typed Beeper AI stream builder
   - Convert an async sequence of UIMessageChunk-like events into `client.streams.send` with explicit control over target event, turn ID, seq, final AI message, and final text.
   - Current `sendBeeperStream` is useful, but the Pi bridge may need lower-level incremental publishing because Pi events originate from callbacks rather than a single ready `AsyncIterable` in attached mode.

2. Typed approval response helpers
   - Helpers to parse `approval.allow_once`, `approval.allow_always`, `approval.deny` reactions or `tool-approval-response` stream chunks.
   - Useful for any Matrix/Beeper AI tool bridge.

3. Room/Space/session helper APIs
   - Create/find project Space by project key/cwd.
   - Create/find session room for a logical external session.
   - Attach/detach session rooms to project Spaces.
   - Stable encode/decode of room/session references.

4. Stream event replay/dedupe helpers
   - Utility for target event ID + turn ID + seq persistence.
   - Useful to resume after bridge crash without broken Desktop stream state.

5. Desktop-compatible `com.beeper.ai` final message accumulator export
   - `sendBeeperStream` currently has internal accumulator logic in `/Users/batuhan/Projects/labs/pickle/packages/pickle/src/streams/beeper.ts`.
   - Export/refactor this so `@beeper/pickle-pi` can finalize streams built from Pi callbacks without duplicating logic.

6. Media staging helpers
   - Typed download-to-file and upload-from-file helpers with size limits and MIME inference.
   - Useful for chat adapter, bridges, and Pi.

## Implementation phases

### Phase 0: clarify product decisions

- Answer questions at the bottom of this file.

### Phase 1: package skeleton and appservice registration

- Create package split or internal split for:
  - `@beeper/pickle-pi-agent` appservice daemon/CLI,
  - `@beeper/pickle-pi-core` shared internals,
  - future `@beeper/pickle-pi` terminal extension.
- Add appservice CLI commands:
  - `pickle-pi-agent init`,
  - `pickle-pi-agent register`,
  - `pickle-pi-agent start`,
  - `pickle-pi-agent status`.
- Add appservice registration generation with Pi ghost namespace.
- Add `src/config.ts`, `src/registry.ts`, `src/appservice.ts`, `src/rooms.ts`, `src/spaces.ts`, `src/stream-map.ts`.
- Add README for Beeper appservice setup.

### Phase 2: appservice/headless session MVP

- Boot proper appservice.
- Create/join/send as Pi ghost.
- Auto-create project Space.
- Auto-create one room per Pi session.
- Create normal Pi session file for each room.
- Run headless `AgentSession` for a Beeper-created room.
- Accept Beeper text input and call `AgentSession.prompt`.
- Stream assistant text/reasoning using Beeper native stream chunks.
- Finalize message with persisted `com.beeper.ai` content.

### Phase 3: tool streaming

- Add tool input/output/error streaming.
- Add tests against Desktop-supported chunk shapes.
- Preserve `toolCallId`, tool names, inputs, output, errors, and preliminary updates.

### Phase 4: history import and persistence

- Always import history for attached/imported sessions.
- Start with active branch import if necessary.
- Persist enough Pi entry/leaf/tree metadata for full tree support later.
- Ensure appservice restart resumes existing room/session bindings.

### Phase 5: approvals and controls

- Add configurable Beeper Desktop approval requests.
- Add model/thinking/compact/abort/queue/status controls.
- Parse approval reactions/responses.

### Phase 6: full tree/branch room model

- Represent forks, tree navigation, compaction, and branch summaries.
- Create additional rooms under project Space for branch sessions when appropriate.
- Preserve full session tree design even if active branch ships first.

### Phase 7: terminal companion extension

- Implement future `@beeper/pickle-pi` Pi extension.
- Detect terminal `/resume` and rebind to existing Beeper room.
- Import unknown terminal sessions by auto-creating rooms and importing history.
- Mirror all terminal activity by default.
- Add `/pickle-pi-resume` if normal Pi resume UX is insufficient for Beeper-created sessions.

## Product decisions from user

These are decided and should drive implementation unless explicitly changed later.

1. **Room mapping:** one Beeper/Matrix room per Pi session always.
   - Projects can be represented as Matrix Spaces to preserve project/session relationships.
   - Do not use one room with many threads as the primary model.
   - Matrix rooms are cheap; design for many rooms, but avoid unnecessary explosion.

2. **History import:** always import history.
   - Initial implementation may start with the active branch only.
   - Architecture must support full Pi session tree import/backfill.
   - Full tree can be represented with multiple rooms if that makes the model cleaner.

3. **Beeper-created sessions:** Beeper-created sessions should be resumable in the terminal as visible Pi sessions.
   - Bridge-owned/headless session files must be normal Pi session files.
   - Terminal `/resume` should find or be able to open them.
   - When terminal resumes one, the bridge should continue mirroring in the same Beeper room.

4. **Mirroring:** mirror everything by default.
   - Terminal prompts, assistant responses, stream deltas, tool lifecycle, model/thinking changes, compaction, forks/tree navigation, queue state, approvals, and errors should all be reflected in Beeper.
   - Avoid echo loops for Beeper-originated turns by tagging origin and deduping, not by omitting mirrored content.

5. **Identity:** use an appservice puppet/ghost identity called **Pi**.
   - Design package around a bridge/appservice-style identity rather than the user's personal Matrix account as the final shape.
   - Early development can use a normal logged-in Matrix account if needed, but do not let that constrain the final architecture.

6. **Approvals:** tool approvals are required only when configured.
   - Approval policy should be configurable by tool name, path, command pattern, project, and possibly room/session.
   - Default should not block every tool unless configured.

7. **Room creation:** always auto-create Matrix rooms.
   - Users should not need to manually create/invite/link rooms for normal operation.
   - Manual attach/link can exist as an advanced recovery/import feature.

8. **Session tree:** target full session tree support.
   - Start with active branch import/mirroring if needed.
   - Preserve enough metadata from day one to later reconstruct full trees without data loss.

9. **Bridge-owned extensions:** bridge-owned sessions load all Pi extensions.
   - Must handle recursion/duplicate bridge loading safely via runtime guards/flags/locks.
   - Do not use a restricted extension set by default.

10. **Desktop target:** target the current checked-out Beeper Desktop codebase status.
   - Reference path: `/Users/batuhan/projects/texts/beeper-workspace/beeper/beeper/desktop`.
   - The TODO's Desktop stream/approval references are the compatibility baseline.

## Remaining clarifying questions

1. What should the Matrix Space hierarchy look like exactly?
   - One Space per cwd/project?
   - Nested Spaces for parent directories/workspaces?
   - Should archived sessions remain in the Space?

2. For the appservice puppet/ghost called Pi, what should the Matrix IDs/display names/avatar be?
   - Example localpart/display: `@pi_<project-or-session>:server` vs one global `@pi:server`.

3. Should each Pi session room include the human user plus the Pi ghost only, or should rooms optionally include collaborators?

4. Should terminal-visible resume of Beeper-created sessions be automatic through Pi's normal session list, or do we need a custom `/pickle-pi-resume` command that lists Beeper-created sessions with room metadata?

5. What is the desired retention/archive policy for many auto-created rooms?
   - Never archive automatically?
   - Archive on Pi session deletion?
   - Archive inactive sessions after N days?
