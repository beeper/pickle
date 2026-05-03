# Matrix SDK v1 Completion Plan

## Product Intention

Build `better-matrix-js` as a Node-first Matrix client SDK that is agents/bots-first but capable of becoming a full client SDK. The public API should feel like a Vercel SDK: synchronous factory, lazy async methods, plain serializable account objects, one live subscription primitive, pure helper functions, and no sync ceremony during construction.

The Chat SDK adapter must be a very thin translator over `better-matrix-js`. If Chat SDK needs Matrix behavior, the behavior belongs in core or a focused helper exported by core. The adapter should map Chat SDK concepts to Matrix calls, not maintain a parallel Matrix client model.

Non-standard Beeper features are first-class but must remain explicit under `client.beeper` or Beeper-namespaced event/content handling. Standard Matrix behavior should stay standard and portable.

No backward compatibility is required. Prefer deleting old API shapes and duplicated layers over preserving aliases.

## API Contract Target

- [x] `createMatrixClient(options)` is synchronous and inert.
- [x] First awaited Matrix method lazily boots runtime/core/store/crypto.
- [x] `client.boot()` exists for apps that want startup failure early.
- [x] Remove public `connect()`.
- [x] Use `MatrixAccount` as the serializable account/session object.
- [x] Make `deviceId` immutable identity from login/whoami, not a user-editable client option.
- [x] Keep `client.sync` minimal with only `applyResponse({ response, since })`.
- [x] Make `client.subscribe(filter, handler)` the only core live event primitive.
- [x] `subscribe` returns `{ stop, catchUp, done }`.
- [x] Default subscription delivery is future-only.
- [x] `catchUp()` explicitly replays missed events from stored cursor.
- [x] Move ergonomic event helpers to pure exports: `onMessage`, `onReaction`, `onInvite`, `onRawEvent`.
- [x] Add short namespaces that were still missing:
  - [x] `client.accountData.*`
  - [x] `client.toDevice.*`
  - [x] `client.receipts.*`
  - [x] `client.raw.request(...)`
- [ ] Confirm every public namespace has one canonical method name per operation and no aliases.
- [ ] Audit package exports so there are no convenience barrel imports inside package source.

## Boot, Account, And Login

- [x] `boot()` initializes runtime/account/store/crypto only.
- [x] Request methods work without sync for CLI usage.
- [x] `whoami()` boots if needed and confirms account identity.
- [x] Generic password/token login returns `MatrixAccount`.
- [x] Remove public login option for caller-selected `deviceId`.
- [x] Add logout helper.
- [x] Add token/JWT login coverage for returned `MatrixAccount`.
- [ ] Persist/use account metadata without making it required for runtime identity.
- [ ] Add Beeper signup/login flow object under `client.beeper` or a Beeper login helper package.
- [ ] Ensure no QA-specific secrets, OTP assumptions, or fixed Beeper test behavior ship in public code.

## Sync And Subscription Semantics

- [x] Sync starts only through `client.subscribe(...)`, pure handler helpers, or `sync.applyResponse(...)`.
- [x] Reused accounts do not replay backlog unless `catchUp()` is called.
- [x] Explicit pagination reads history independently of subscription delivery.
- [x] Stopping the last subscription stops the internal sync runner.
- [x] Make `sub.done` reject on unrecoverable sync loop errors from Go, not only subscription handler errors.
- [ ] Add subscription options for runtime sync tuning if needed without exposing `sync.start`.
- [x] Add tests for multiple subscribers sharing one sync runner.
- [x] Add tests for stopping one subscriber while another remains active.
- [x] Add tests for handler failures and `done` rejection behavior.
- [ ] Add tests that `boot()` does not emit app events.
- [ ] Add tests that default subscription is future-only with a reused stored cursor.
- [x] Add tests that `catchUp()` emits missed events and only through that subscription.

## Raw Event Access

- [x] `onRawEvent(...)` helper exists.
- [x] Raw helper currently exposes mapped events plus available raw payload.
- [ ] Implement true granular raw Matrix sync events from Go for:
  - [x] joined room timeline events
  - [x] invited room state
  - [x] left room timeline/state
  - [x] room state events
  - [x] ephemeral room events
  - [x] account data events
  - [x] to-device events
  - [ ] device list changes
  - [ ] presence events if supported
- [ ] Raw events must include unmodified Matrix payload and source metadata:
  - [x] sync cursor `since`
  - [x] next batch when available
  - [x] room id if applicable
  - [x] event class/source section
  - [x] event type
  - [ ] encrypted/decrypted status where applicable
- [x] Ensure raw event delivery shares the same subscription runner and filter path.
- [x] Add unit tests for raw event filtering and metadata.
- [ ] Add e2e coverage for raw encrypted timeline events.

## Normalized Event Model

- [x] Message events.
- [x] Reaction events.
- [x] Invite events.
- [x] Sync status events.
- [x] Crypto status events.
- [x] Decryption error events.
- [x] Redaction events as first-class normalized events.
- [x] Membership events as first-class normalized events.
- [x] Room state events as first-class normalized events.
- [x] Account data events as first-class normalized events.
- [x] To-device events as first-class normalized events.
- [x] Ephemeral events as first-class normalized events.
- [x] Receipt events as first-class normalized events.
- [ ] Typing events as first-class normalized events.
- [ ] Room summary/update events if needed for client UIs.
- [ ] Decryption lifecycle events for pending, retried, failed, and recovered decryptions.
- [x] Make event filter matching work consistently across `kind`, `roomId`, `type`, sender, relation, and thread root where available.
- [ ] Add unit tests for every normalized event mapper.
- [ ] Add Go tests for every event emitted from `/sync`.

## Core Matrix Capabilities

- [x] Messages: send, edit, redact, get, list, mark read.
- [x] Reactions: send, redact, cold-start removal state.
- [x] Media: upload/download encrypted and unencrypted media.
- [x] Rooms: create, join, leave, invite, ban, kick, unban, open DM.
- [x] Room state read/send.
- [x] Room power-level inspection.
- [x] Thread listing.
- [x] Profile get/set own display name/avatar.
- [x] Account data get/set helpers.
- [x] Room account data get/set helpers.
- [x] To-device send helper.
- [x] Receipt send helper.
- [x] Generic raw Matrix request helper with typed method/path/body/query.
- [ ] Account data delete helper if a homeserver-supported delete shape is needed.
- [ ] Receipt fetch helpers if a product need appears beyond sync receipt events.
- [ ] Pagination helpers that cleanly support old encrypted history.
- [ ] Room membership timeline/history helpers for full-client usage.
- [ ] Room summary cache exposed without becoming a gomuks-style timeline DB.
- [ ] Relation summary cache for reactions/threads/edit summaries.
- [ ] Bounded recent cache configuration and tests.

## E2EE

- [x] E2EE is initialized through mautrix/go crypto helper.
- [x] Durable crypto store support.
- [x] Recovery key support.
- [x] Crypto status query includes pending decryption count and backup status.
- [x] Pending decryptions are persisted/retried.
- [x] Encrypted media roundtrip test coverage exists.
- [ ] Fresh-device historical decryption via recovery key e2e.
- [ ] Existing-device reused account decrypts old encrypted history e2e.
- [ ] Existing accounts with old devices and old rooms e2e.
- [ ] Multi-device same account behavior tests.
- [ ] Multi-client same-process isolation tests.
- [ ] Missing room key behavior tests.
- [ ] Key backup unavailable/unverified behavior tests in JS unit coverage.
- [ ] Browser E2EE smoke once browser harness exists.
- [ ] Cloudflare E2EE smoke after API migration.

## Storage

- [x] Keep separate storage packages: memory, file, sqlite, indexeddb, cloudflare.
- [x] Store fast-boot state: crypto, cursor, pending decryptions, reaction summaries.
- [ ] Audit all stores against the new lazy lifecycle.
- [ ] Add shared conformance tests for all storage adapters.
- [ ] Confirm no store tries to model a full gomuks timeline DB.
- [ ] Persist room summaries needed for bot/client startup.
- [ ] Persist relation summaries needed for reactions/threads.
- [ ] Add bounded recent event cache and eviction tests.
- [ ] Document single-writer requirements per store.
- [ ] Cloudflare Durable Object store smoke after subscription API change.
- [ ] IndexedDB smoke after subscription API change.

## Beeper

- [x] Existing Beeper stream primitives under `client.beeper.streams`.
- [x] Existing Beeper ephemeral send under `client.beeper.ephemeral`.
- [x] Beeper stream auto mode for Beeper homeservers.
- [ ] Move all remaining non-standard Beeper APIs under `client.beeper`.
- [ ] Add Beeper capability discovery beyond hostname where possible.
- [ ] Add Beeper login/signup flow as stateless request functions.
- [ ] Add tests ensuring non-standard event/content keys remain namespaced.
- [ ] Document Beeper-first behavior and standard Matrix fallback behavior.

## Chat SDK Adapter

- [x] Adapter initializes with `whoami()` and no public `connect()`.
- [x] `sync.enabled: false` disables live subscription.
- [x] Live mode uses `client.subscribe(...)`.
- [x] Webhook/serverless mode uses `client.sync.applyResponse(...)`.
- [x] Streaming delegates to core `client.streams.send(...)`.
- [x] Ephemeral delegates to `client.beeper.ephemeral.send(...)`.
- [ ] Move remaining generic Matrix parsing/rendering from adapter to core:
  - [ ] content parsing
  - [ ] mentions
  - [ ] media normalization
  - [ ] relation/thread mapping
  - [ ] Beeper content primitives
- [ ] Audit cards/actions behavior:
  - [ ] text fallback only when no unsupported interactivity is implied
  - [ ] throw clearly for unsupported interactive cards/actions
  - [ ] tests for unsupported behavior
- [ ] Add tests for live subscription mode.
- [ ] Add tests for sync-disabled CLI/request mode.
- [ ] Add tests for webhook/apply mode with raw JSON payloads.
- [ ] Confirm adapter does not keep parallel Matrix event systems or stores.

## Serverless

- [x] `client.sync.applyResponse({ response, since })` accepts externally supplied raw `/sync`.
- [x] Serverless encrypted sync payload decryption is intentionally outside core sync API.
- [ ] Add optional stateless helper in adapter or companion package for encrypted webhook payloads.
- [ ] Add replay/idempotency tests for serverless apply.
- [ ] Add encrypted-room `applyResponse` fixture test with matching crypto store.
- [ ] Document cursor ownership in live, webhook, and Durable Object modes.
- [ ] Document how to avoid concurrent writers for encrypted devices.
- [ ] Cloudflare Worker smoke using current subscription/apply APIs.

## Node, Browser, Cloudflare Compatibility

- [x] Node entrypoint lazily loads packaged WASM.
- [x] Generic entrypoint still accepts `wasmBytes`, `wasmModule`, or `wasmUrl`.
- [ ] Node smoke against packaged build after API migration.
- [ ] Browser smoke with IndexedDB and WASM asset.
- [ ] Cloudflare Worker smoke with Durable Object store and WASM.
- [ ] Confirm no Node-only imports leak into browser/core entrypoint.
- [ ] Confirm Node helper exports are available from `better-matrix-js/node`.
- [ ] Confirm package exports support direct helper imports if needed.

## AI Streaming

- [x] Core accepts generic async iterable text/delta input.
- [x] AI-specific helper package exists separately.
- [ ] Confirm optional AI helper has no required runtime dependency on AI SDK.
- [ ] Add type-only/dev import audit.
- [x] Add streaming tests for generic string chunks, text deltas, markdown chunks, and empty streams.

## Public Documentation

- [x] README updated away from old `connect/events/sync.start` API.
- [x] Core README updated away from old API.
- [x] Add a dedicated API overview with:
  - [x] inert factory and lazy boot
  - [x] `MatrixAccount`
  - [x] CLI usage without sync
  - [x] live subscription usage
  - [x] `catchUp()`
  - [x] serverless `applyResponse`
  - [x] raw event helper
  - [x] E2EE store/recovery guidance
- [ ] Add migration note stating no backward compatibility is intended pre-release.
- [ ] Add Chat SDK adapter usage docs for live, disabled-sync, and webhook modes.
- [ ] Add Beeper-specific docs.
- [x] Add unsupported features docs for cards/actions/modals/scheduled messages.
- [x] Add e2e README explaining external Beeper setup and cached account reuse.

## E2E Test Plan

- [ ] Move public e2e tests into this repo with a README.
- [x] Keep e2e out of default CI.
- [x] Reuse cached Beeper accounts by default.
- [ ] Scenario: lazy client can send/fetch without sync.
- [ ] Scenario: `boot()` initializes but does not emit app events.
- [ ] Scenario: `whoami()` confirms account/device identity.
- [ ] Scenario: `client.subscribe(...)` returns `{ stop, catchUp, done }`.
- [ ] Scenario: default subscription receives future events only.
- [ ] Scenario: `catchUp()` replays missed events.
- [ ] Scenario: `onRawEvent(...)` receives raw granular Matrix payloads.
- [ ] Scenario: encrypted messages.
- [ ] Scenario: edits.
- [ ] Scenario: reactions and reaction removals.
- [ ] Scenario: media upload/download.
- [ ] Scenario: threads.
- [ ] Scenario: invites and auto-join.
- [ ] Scenario: room state.
- [ ] Scenario: account data.
- [ ] Scenario: to-device.
- [ ] Scenario: receipts.
- [ ] Scenario: reused accounts paginate and decrypt old encrypted history.
- [ ] Scenario: fresh and existing devices behave correctly.
- [ ] Scenario: multi-client same-process isolation.
- [ ] Scenario: Chat SDK live subscription mode.
- [ ] Scenario: Chat SDK sync-disabled mode.
- [ ] Scenario: Chat SDK webhook/apply mode.

## Unit And Type Test Plan

- [x] Core lazy boot behavior.
- [x] Subscription controller lifecycle basics.
- [x] Chat adapter type conformance.
- [x] Subscription multi-subscriber lifecycle.
- [x] Subscription handler error behavior.
- [x] Pure helper behavior for `onMessage`, `onReaction`, `onInvite`, `onRawEvent`.
- [ ] Normalized event mapping for every event kind.
- [ ] Raw event path.
- [ ] Storage adapter conformance.
- [ ] Unsupported Chat SDK card/action behavior.
- [ ] `raw.request` request construction and error handling.
- [x] Account data/to-device/receipt helper tests.
- [x] Raw request helper tests.

## Release Readiness

- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm test:go`
- [ ] `pnpm build`
- [ ] Package consumer smoke.
- [ ] Cloudflare smoke.
- [ ] Browser smoke.
- [ ] Node live e2e with cached accounts.
- [ ] Review public exports for duplicate or fake layers.
- [ ] Review code for duplicate types and adapters owning core logic.
- [ ] Review docs for stale old API references.
