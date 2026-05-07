# Pickle Bridge TODO

This is the implementation map for `@beeper/pickle-bridge`. Interfaces are named
to match bridgev2 concepts while using TypeScript idioms.

## Runtime

- [x] `createBridge(options)` factory.
- [x] `PickleBridge` runtime interface.
- [x] `Bridge.start()` boots Pickle, initializes connector, starts connector.
- [x] `Bridge.stop()` stops subscriptions, connector, loaded network clients, and Matrix client.
- [x] `Bridge.queueRemoteEvent(login, event)` bridgev2-style remote event ingress.
- [x] `Bridge.flushRemoteEvents()` for tests and controlled drains.
- [x] Remote message drain to Matrix sends.
- [x] Appservice initialization at bridge startup.
- [x] Appservice portal room creation.
- [x] Appservice batch backfill.
- [x] Basic live Matrix subscription lifecycle.
- [x] In-memory portal registration and Matrix room fallback portal keys.
- [x] Remote event worker with retry/backoff.
- [ ] Persistent queue.
- [x] Background mode.
- [x] Command processor.
- [x] Bridge info/capabilities room state publishing.

## Matrix/WASM

- [x] Forward `wasmBytes`, `wasmModule`, `wasmUrl` to Pickle.
- [x] Node entrypoint delegates to `@beeper/pickle/node`.
- [x] Browser/worker examples for `wasmModule` and `wasmUrl`.
- [x] Direct media helper.
- [x] Appservice-mode Matrix primitives exposed by Pickle WASM.
- [ ] Full bridgev2 database-backed Matrix connector.

## Network Connector Interfaces

- [x] `BridgeConnector`.
- [x] `StoppableNetwork`.
- [x] `DirectMediableNetwork`.
- [x] `IdentifierValidatingNetwork`.
- [x] `TransactionIDGeneratingNetwork`.
- [x] `PortalBridgeInfoFillingNetwork`.
- [x] `ConfigValidatingNetwork`.
- [x] `MaxFileSizingNetwork`.
- [x] `NetworkResettingNetwork`.
- [x] `PushParsingNetwork`.
- [ ] Config loader/upgrader implementation.
- [ ] DB metadata registration/migrations.

## Network API Interfaces

- [x] `NetworkAPI`.
- [x] `PushableNetworkAPI`.
- [x] `BackgroundSyncingNetworkAPI`.
- [x] `ChatViewingNetworkAPI`.
- [x] `BackfillingNetworkAPI`.
- [x] `StickerImportingNetworkAPI`.
- [x] Matrix outbound handlers:
  - [x] message
  - [x] edit
  - [x] reaction
  - [x] reaction remove
  - [x] redaction
  - [x] read receipt
  - [x] typing
  - [x] poll
  - [x] disappearing timer
  - [x] membership
  - [x] room name/topic/avatar
  - [x] mute/tag/marked unread/delete chat
- [x] Dispatch Pickle message/reaction/redaction/typing events to outbound handlers.
- [x] Dispatch Pickle edit/read receipt/room state/account data events to outbound handlers.
- [x] Pending message echo matching.
- [x] No-echo/no-ack timeout handling.

## Login Interfaces

- [x] `LoginProcess`.
- [x] `LoginProcessWithOverride`.
- [x] `LoginProcessDisplayAndWait`.
- [x] `LoginProcessUserInput`.
- [x] `LoginProcessCookies`.
- [x] `LoginFlow`, `LoginStep`, `LoginStepType`.
- [x] Login session persistence.
- [x] Provisioning HTTP surface.
- [x] Reauth/override flow.

## Remote Event Interfaces

- [x] `RemoteEvent`.
- [x] `RemoteEventWithContextMutation`.
- [x] `RemoteEventWithUncertainPortalReceiver`.
- [x] `RemotePreHandler`.
- [x] `RemotePostHandler`.
- [x] `RemoteChatInfoChange`.
- [x] `RemoteChatResync`.
- [x] `RemoteChatResyncWithInfo`.
- [x] `RemoteChatResyncBackfill`.
- [x] `RemoteChatResyncBackfillBundle`.
- [x] `RemoteBackfill`.
- [x] `RemoteDeleteOnlyForMe`.
- [x] `RemoteChatDelete`.
- [x] `RemoteChatDeleteWithChildren`.
- [x] `RemoteEventThatMayCreatePortal`.
- [x] `RemoteEventWithTargetMessage`.
- [x] `RemoteEventWithBundledParts`.
- [x] `RemoteEventWithTargetPart`.
- [x] `RemoteEventWithTimestamp`.
- [x] `RemoteEventWithStreamOrder`.
- [x] `RemoteMessage`.
- [x] `RemoteMessageWithTransactionID`.
- [x] `RemoteMessageUpsert`.
- [x] `RemoteEdit`.
- [x] `RemoteReaction`.
- [x] `RemoteReactionRemove`.
- [x] `RemoteMessageRemove`.
- [x] `RemoteReadReceipt`.
- [x] `RemoteDeliveryReceipt`.
- [x] `RemoteMarkUnread`.
- [x] `RemoteTyping`.
- [x] Portal resolution and room creation from remote events.
- [x] Message conversion to Matrix event sends.
- [x] Basic remote message conversion to Matrix room sends.
- [x] Edit/reaction/redaction conversion to Matrix sends.
- [x] Backfill import.

## Storage Models

- [x] Type shells for `BridgeUser`, `UserLogin`, `Portal`, `Ghost`, `Message`, `Reaction`.
- [x] Persistent stores for users, logins, portals, ghosts, messages, reactions.
- [ ] Metadata codecs and migrations.
- [ ] ID helper utilities.

## Examples

- [x] `examples/echo-bridge`.
- [ ] Port `bots/dummybot` to `@beeper/pickle-bridge`.
- [x] Minimal QR login bridge example.
- [x] Minimal cookie login bridge example.

## Tests

- [x] Type conformance tests for golden bridge patterns.
- [x] Runtime start/stop tests in `bridge.test.ts`.
- [x] WASM option forwarding tests.
- [x] Remote event queue tests in `bridge.test.ts` for queued remote event draining.
- [x] Matrix sync dispatch tests in `bridge.test.ts` for Matrix event dispatch.
