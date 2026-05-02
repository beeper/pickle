# Matrix SDK Alignment TODO

## API Alignment

- [x] Remove `recoveryCode`; keep only top-level `recoveryKey` in JS and Go contracts.
- [x] Keep `recoveryKey` top-level in `MatrixClientOptions` and adapter config.
- [x] Keep one sync ingestion primitive: `client.sync.applyResponse({ response, since })`.
- [x] Do not add a Matrix-client `applyEnvelope`; encrypted webhook envelopes belong to app/transport helpers.
- [x] Make `MatrixAdapter` explicitly satisfy Chat SDK adapter requirements.
- [ ] Delete duplicated `MatrixRawMessage` in the Chat adapter; use the core `MatrixMessageEvent` as raw data.
- [ ] Collapse duplicated public/runtime/generated Matrix event types where possible.
- [ ] Keep package public entrypoints, but stop internal imports from convenience barrels.
- [ ] Normalize option naming to one public spelling for each concern.
- [x] Make Beeper-specific features explicit under `client.beeper`.

## Main Library Capabilities

- [x] Expose `client.beeper.ephemeral.send(...)` for Beeper homeservers.
- [x] Implement Chat SDK `postEphemeral` through Beeper ephemeral events when supported.
- [x] Make non-Beeper `postEphemeral` fail clearly instead of pretending to be portable Matrix.
- [x] Move generic streaming orchestration from `@better-matrix-js/chat-adapter` into `better-matrix-js`.
- [x] Expose `client.streams.send(...)` with automatic Beeper-native or edit-fallback mode.
- [x] Keep Beeper native streaming available under `client.beeper.streams`.
- [x] Move AI-specific stream conversion into `@better-matrix-js/ai-sdk`.
- [ ] Expose `client.crypto.status()` or equivalent queryable E2EE status.
- [ ] Expose pending decryption count/status.
- [ ] Expose recovery/backup status after startup.
- [ ] Add profile APIs: get/set own display name and avatar.
- [ ] Add room creation API beyond DM creation.
- [ ] Add room permission/power-level inspection.
- [ ] Add generic room state read/send APIs for advanced users.
- [ ] Add member listing and member event/profile APIs.
- [ ] Add room alias resolution and optional directory lookup.
- [ ] Add optional media thumbnail support.
- [ ] Decide whether URL previews belong in scope; document unsupported if not.

## Go/Core Ownership

- [ ] Move Matrix attachment extraction fully into Go/core event normalization.
- [ ] Move mention detection fully into Go/core event normalization.
- [ ] Move relation parsing fully into Go/core event normalization.
- [ ] Normalize replies, threads, edits, annotations/reactions, and references in core.
- [ ] Normalize inbound redactions in core.
- [ ] Normalize inbound edits in core without Chat adapter raw-content inference.
- [ ] Move reaction target/thread lookup into core state.
- [ ] Make reaction removal work across cold starts.
- [ ] Make `openDM(userId)` reuse existing `m.direct` rooms by default.
- [ ] Add an option to force creating a new DM when needed.
- [ ] Use `m.direct` account data for DM detection before member-count fallback.
- [ ] Make Beeper sync options conditional instead of setting `BeeperStreaming: true` for every homeserver.
- [ ] Add Beeper capability detection beyond hostname fallback.
- [ ] Keep encrypted media behavior in Go; remove duplicate TS parsing paths.
- [ ] Ensure fetch-message pagination always returns chronological page order.
- [ ] Ensure sync response replay is idempotent at the emitted event level.

## Serverless

- [ ] Document two modes: live sync and serverless apply-response.
- [ ] Make cursor ownership explicit for Cloudflare DO syncer versus core `nextBatch`.
- [ ] Ensure serverless `applyResponse` works with E2EE cold starts and durable crypto state.
- [ ] Add a single-writer story for E2EE stores.
- [ ] Recommend Durable Objects or other serialized storage for encrypted bots.
- [ ] Warn against concurrent KV writes for active E2EE devices.
- [ ] Add optional Cloudflare encrypted webhook helper outside the Matrix client sync API.
- [ ] Add webhook replay/idempotency guidance.

## Chat SDK Adapter

- [ ] Make the Chat adapter a thin translator over `better-matrix-js`.
- [x] Delete old Chat adapter streaming drivers; keep streaming delegated to core plus the public `MatrixStream` type/helper exports.
- [ ] Remove Chat adapter Matrix attachment parser after core emits normalized attachments.
- [ ] Remove Chat adapter Matrix mention parser after core emits normalized mentions.
- [ ] Remove Chat adapter Matrix relation parser after core emits normalized relations.
- [ ] Remove Chat adapter in-memory reaction/thread authority.
- [ ] Keep only Chat message construction, formatting conversion, slash dispatch, and Chat SDK method mapping.
- [x] Wire Chat SDK streaming to `client.streams.send(...)`.
- [x] Wire Chat SDK ephemeral messages to `client.beeper.ephemeral.send(...)`.

## Code Organization

- [x] Split `packages/core/src/client.ts` public interfaces into `client-types.ts`.
- [x] Split `packages/core/src/client.ts` event normalization into `events.ts`.
- [x] Split `packages/core/src/client.ts` streaming orchestration into `streams.ts`.
- [ ] Continue shrinking `packages/core/src/client.ts` by moving media byte helpers if it keeps growing.
- [ ] Keep card/action support fallback-only unless Beeper interactive product scope is explicitly added.
- [ ] Document unsupported Chat SDK features: native modals and native scheduled messages.

## E2EE

- [ ] Require or strongly recommend explicit `pickleKey` for durable E2EE bot deployments.
- [ ] Reconsider access-token fallback as pickle key before release.
- [ ] Provide a clear bot onboarding flow: login, device ID, store persistence, recovery key restore.
- [ ] Test fresh-device historical decryption via recovery key.
- [ ] Test missing backup/recovery status behavior.
- [ ] Test encrypted media upload/download roundtrip.
- [ ] Test decryption retry and pending queue persistence.

## Tests And Verification

- [ ] Add compile-time Chat SDK adapter conformance test.
- [ ] Add Go relation parsing tests.
- [ ] Add Go redaction/edit normalization tests.
- [ ] Add reaction removal after cold start test.
- [ ] Add `openDM` reuse test.
- [ ] Add serverless encrypted-room `applyResponse` test.
- [ ] Add serverless replay/idempotency test.
- [x] Add core streaming tests for Beeper-native and edit-fallback modes.
- [ ] Add Cloudflare Worker smoke with Durable Object store and WASM.
- [ ] Add browser smoke with IndexedDB and WASM.
- [ ] Add Node smoke with file/sqlite store and E2EE.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm test`.
- [x] Run `pnpm test:go`.
- [x] Run `pnpm build`.
- [x] Run package consumer and Cloudflare smoke tests.

## Documentation

- [ ] Document browser setup.
- [ ] Document Node setup.
- [ ] Document Cloudflare Worker setup.
- [ ] Document serverless sync apply-response flow.
- [ ] Document E2EE bot storage requirements.
- [ ] Document recovery key usage.
- [ ] Document Beeper-only ephemeral support.
- [ ] Document Beeper-native streaming and edit-fallback streaming.
- [ ] Document feature support matrix.
