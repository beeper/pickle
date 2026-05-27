# First-Class Beeper Network Connector Rewrite

## Summary
Rewrite `@beeper/pickle-openclaw` as a first-class OpenClaw channel plugin, modeled after Telegram’s plugin-SDK architecture, with Beeper native AG-UI streaming backed by the existing Go `ai-bridge` code through Pickle’s WASM bridge.

This is a nuclear cut: remove the bespoke OpenClaw gateway transport, ad hoc stream mappers, and compatibility command path. The new connector uses OpenClaw’s channel plugin contract for setup, runtime startup, inbound dispatch, outbound delivery, approvals, actions, directory, routing, and message streaming.

## Key Architecture
- Register the channel with `defineChannelPluginEntry` and `defineSetupPluginEntry` from `openclaw/plugin-sdk/channel-core`.
- Build `beeperChannelPlugin` with `createChannelPluginBase` / `createChatChannelPlugin`, matching Telegram’s shape:
  - `config`, `setup`, `setupWizard`, `status`, `gateway`
  - `message`, `outbound`, `messaging`, `threading`
  - `directory`, `resolver`, `actions`, `approvalCapability`, `agentPrompt`
  - `commands` for OpenClaw-native command discovery instead of connector-local slash switches.
- Promote Beeper capabilities to a real network connector surface:
  - `chatTypes: ["direct", "group", "thread"]`
  - `media: true`, `reactions: true`, `threads: true`
  - `nativeCommands: true`, `blockStreaming: true`
- `gateway.startAccount` starts the Pickle/Beeper appservice bridge and registers a Beeper network runtime with `api.runtime.channel.runtimeContexts`.
- Message adapters resolve the active Beeper runtime through the stored OpenClaw `PluginRuntime`, not through a global singleton.
- Inbound Matrix events enter OpenClaw through `runtime.channel.turn.run` / `runAssembled` and SDK-built inbound context, not through custom `sessions.send` RPC emulation.

## Streaming Design
- Introduce a `BeeperTurnStreamCoordinator` in TypeScript:
  - one coordinator per OpenClaw turn
  - one or more Beeper native stream anchors per assistant segment
  - all text, reasoning, tools, approvals, state, sources, files, data, snapshots, and terminal events pass through one serialized queue
- Use multiple Beeper stream messages when OpenClaw emits multiple assistant messages or when a tool/progress segment needs its own live stream before answer text exists.
- Preserve event order exactly for live streaming. Do not reorder text/tool/progress events in TypeScript.
- Keep durable finalization per stream anchor:
  - default finalization is replacement edit with final `com.beeper.ai`
  - no `append` or `native-only` mode in the new OpenClaw connector
- Tool lifecycle rules:
  - tool start emits `TOOL_CALL_START`
  - argument chunks emit `TOOL_CALL_ARGS`
  - progress emits `TOOL_CALL_RESULT` with `state: "streaming"`
  - final result emits `TOOL_CALL_RESULT` with `state: "complete"` or `"error"`
  - close emits `TOOL_CALL_END`
  - approval request/response emits both AG-UI custom approval events and matching tool state transitions.

## Go/WASM `ai-bridge` Usage
- Keep using the existing `github.com/beeper/ai-bridge` dependency already present in `packages/pickle/native/go.mod`.
- Add Pickle WASM operations that expose `ai-stream` run behavior to TypeScript:
  - `begin_beeper_ai_run`: creates an `aistream.Run`, returns initial Beeper AI content and start events.
  - `append_beeper_ai_run_event`: validates and records one AG-UI event in Go.
  - `finish_beeper_ai_run`: calls Go writer finalization, returns final events and final content.
  - `error_beeper_ai_run`: finalizes as error or abort and returns final events/content.
  - `delete_beeper_ai_run`: releases native run state.
- Move final `com.beeper.ai` and `com.beeper.ai.metadata` construction to Go via `aistream.Run.FinalUIMessage()` and `Run.Metadata()`.
- Update native `publish_beeper_stream_message_part` to use `aistream.PackRunFromSeq` semantics for oversized events, so text/tool/snapshot payloads split into budget-safe envelopes while preserving seq.
- TypeScript remains responsible only for adapting OpenClaw callback/event payloads into canonical AG-UI event intents; Go owns validation, metadata, snapshots, final UI message construction, and carrier budget handling.

## Implementation Changes
- Replace `openclaw-extension.ts` custom registration with SDK entry helpers and `setRuntime(api.runtime)`.
- Replace `OpenClawGatewayRuntime` and `createOpenClawHostTransport` usage in Beeper-originated turns with OpenClaw plugin runtime/channel helpers.
- Replace `BeeperStreamPublisher` and `stream-map.ts` with the new coordinator plus Go-backed AI run bridge.
- Replace connector-local `/help`, `/tools`, `/models`, `/tasks`, `/stop`, approval command handling with OpenClaw SDK command and approval surfaces.
- Keep the Pickle bridge/appservice mechanics for Matrix transport, portals, contacts, appservice registration, media, reactions, receipts, and backfill where still needed.
- Preserve user work currently present in `packages/openclaw/src/connector.ts` and `packages/openclaw/src/connector.test.ts` only if it still applies after the rewrite; do not silently overwrite it.

## Test Plan
- Add plugin contract tests proving Beeper registers like Telegram:
  - `defineChannelPluginEntry` registration modes
  - channel metadata/capabilities
  - gateway start/stop lifecycle
  - runtime context registration
  - message/outbound/action/approval surfaces
- Add Go native tests for:
  - begin/append/finish/error/delete AI run operations
  - final UI content parity with `ai-bridge`
  - carrier splitting with large text, tool output, and `MESSAGES_SNAPSHOT`
  - seq continuity after split carriers
- Add TypeScript streaming tests for:
  - text and reasoning chunk streaming
  - tool args/progress/result/end ordering
  - approvals with response state
  - plan/state/source/document/file/data/custom events
  - multiple assistant messages producing multiple Beeper streams
  - abort/error terminal paths
- Add end-to-end-style plugin runtime tests using OpenClaw’s plugin test runtime:
  - inbound Beeper message dispatches through `runtime.channel.turn`
  - final delivery goes through Beeper message adapter
  - live AG-UI deltas arrive before final replacement
- Run:
  - `pnpm --filter @beeper/pickle test:go`
  - `pnpm --filter @beeper/pickle test`
  - `pnpm --filter @beeper/pickle-openclaw test`
  - `pnpm --filter @beeper/pickle-openclaw typecheck`
  - `pnpm check`

## Assumptions
- No migration means old internal APIs, tests, config modes, and stream finalization options may be deleted.
- Pickle native Matrix/Beeper transport remains the foundation; only missing `ai-bridge` run-state operations and carrier splitting are added.
- Live streaming fidelity is the highest priority; final content should be Go `ai-bridge` canonical even where that canonical final representation is less interleaved than live events.
