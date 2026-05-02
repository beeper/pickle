# Matrix SDK Alignment TODO

## API Alignment

- [x] Remove `recoveryCode`; keep only top-level `recoveryKey` in JS and Go contracts.
- [x] Keep `recoveryKey` top-level in `MatrixClientOptions` and adapter config.
- [x] Keep one sync ingestion primitive: `client.sync.applyResponse({ response, since })`.
- [x] Do not add a Matrix-client `applyEnvelope`; encrypted webhook envelopes belong to app/transport helpers.
- [x] Make `MatrixAdapter` explicitly satisfy Chat SDK adapter requirements.
- [x] Delete duplicated `MatrixRawMessage` in the Chat adapter; use the core `MatrixMessageEvent` as raw data.
- [ ] Collapse duplicated public/runtime/generated Matrix event types where possible.
- [x] Keep package public entrypoints, but stop internal imports from convenience barrels.
- [x] Normalize option naming to one public spelling for each concern.
- [x] Make Beeper-specific features explicit under `client.beeper`.

## Main Library Capabilities

- [x] Expose `client.beeper.ephemeral.send(...)` for Beeper homeservers.
- [x] Implement Chat SDK `postEphemeral` through Beeper ephemeral events when supported.
- [x] Make non-Beeper `postEphemeral` fail clearly instead of pretending to be portable Matrix.
- [x] Move generic streaming orchestration from `@better-matrix-js/chat-adapter` into `better-matrix-js`.
- [x] Expose `client.streams.send(...)` with automatic Beeper-native or edit-fallback mode.
- [x] Keep Beeper native streaming available under `client.beeper.streams`.
- [x] Move AI-specific stream conversion into `@better-matrix-js/ai-sdk`.
- [x] Expose `client.crypto.status()` or equivalent queryable E2EE status.
- [x] Expose pending decryption count/status.
- [x] Expose recovery/backup status after startup.
- [x] Add profile APIs: get/set own display name and avatar.
- [x] Add room creation API beyond DM creation.
- [x] Add room permission/power-level inspection.
- [x] Add generic room state read/send APIs for advanced users.
- [x] Add member listing and member event/profile APIs.
- [x] Add room alias resolution and optional directory lookup.
- [x] Add optional media thumbnail support.
- [x] Decide whether URL previews belong in scope; document unsupported if not.

## Go/Core Ownership

- [x] Move Matrix attachment extraction fully into Go/core event normalization.
- [x] Move mention detection fully into Go/core event normalization.
- [x] Move relation parsing fully into Go/core event normalization.
- [x] Normalize replies, threads, edits, annotations/reactions, and references in core.
- [x] Normalize inbound redactions in core.
- [x] Normalize inbound edits in core without Chat adapter raw-content inference.
- [x] Move reaction target/thread lookup into core state.
- [x] Make reaction removal work across cold starts.
- [x] Make `openDM(userId)` reuse existing `m.direct` rooms by default.
- [x] Add an option to force creating a new DM when needed.
- [x] Use `m.direct` account data for DM detection before member-count fallback.
- [x] Make Beeper sync options conditional instead of setting `BeeperStreaming: true` for every homeserver.
- [x] Add Beeper capability detection beyond hostname fallback.
- [x] Keep encrypted media behavior in Go; remove duplicate TS parsing paths.
- [x] Ensure fetch-message pagination always returns chronological page order.
- [x] Ensure sync response replay is idempotent at the emitted event level.

## Serverless

- [x] Document two modes: live sync and serverless apply-response.
- [x] Make cursor ownership explicit for Cloudflare DO syncer versus core `nextBatch`.
- [x] Ensure serverless `applyResponse` works with E2EE cold starts and durable crypto state.
- [x] Add a single-writer story for E2EE stores.
- [x] Recommend Durable Objects or other serialized storage for encrypted bots.
- [x] Warn against concurrent KV writes for active E2EE devices.
- [x] Add optional Cloudflare encrypted webhook helper outside the Matrix client sync API.
- [x] Add webhook replay/idempotency guidance.

## Chat SDK Adapter

- [x] Make the Chat adapter a thin translator over `better-matrix-js`.
- [x] Delete old Chat adapter streaming drivers; keep streaming delegated to core plus the public `MatrixStream` type/helper exports.
- [x] Remove Chat adapter Matrix attachment parser after core emits normalized attachments.
- [x] Remove Chat adapter Matrix mention parser after core emits normalized mentions.
- [x] Remove Chat adapter Matrix relation parser after core emits normalized relations.
- [x] Remove Chat adapter in-memory reaction/thread authority.
- [x] Keep only Chat message construction, formatting conversion, slash dispatch, and Chat SDK method mapping.
- [x] Wire Chat SDK streaming to `client.streams.send(...)`.
- [x] Wire Chat SDK ephemeral messages to `client.beeper.ephemeral.send(...)`.

## Code Organization

- [x] Split `packages/core/src/client.ts` public interfaces into `client-types.ts`.
- [x] Split `packages/core/src/client.ts` event normalization into `events.ts`.
- [x] Split `packages/core/src/client.ts` streaming orchestration into `streams.ts`.
- [x] Continue shrinking `packages/core/src/client.ts` by moving media byte helpers if it keeps growing.
- [x] Keep card/action support fallback-only unless Beeper interactive product scope is explicitly added.
- [x] Document unsupported Chat SDK features: native modals and native scheduled messages.

## E2EE

- [x] Require or strongly recommend explicit `pickleKey` for durable E2EE bot deployments.
- [x] Reconsider access-token fallback as pickle key before release.
- [x] Provide a clear bot onboarding flow: login, device ID, store persistence, recovery key restore.
- [ ] Test fresh-device historical decryption via recovery key.
- [x] Test missing backup/recovery status behavior.
- [x] Test encrypted media upload/download roundtrip.
- [x] Test decryption retry and pending queue persistence.

## Tests And Verification

- [x] Add compile-time Chat SDK adapter conformance test.
- [x] Add Go relation parsing tests.
- [x] Add Go redaction/edit normalization tests.
- [x] Add reaction removal after cold start test.
- [x] Add `openDM` reuse test.
- [ ] Add serverless encrypted-room `applyResponse` test.
- [x] Add serverless replay/idempotency test.
- [x] Add core streaming tests for Beeper-native and edit-fallback modes.
- [x] Add Cloudflare Worker smoke with Durable Object store and WASM.
- [ ] Add browser smoke with IndexedDB and WASM.
- [x] Add Node smoke with file/sqlite store and E2EE.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm test`.
- [x] Run `pnpm test:go`.
- [x] Run `pnpm build`.
- [x] Run package consumer and Cloudflare smoke tests.

## Documentation

- [x] Document browser setup.
- [x] Document Node setup.
- [x] Document Cloudflare Worker setup.
- [x] Document serverless sync apply-response flow.
- [x] Document E2EE bot storage requirements.
- [x] Document recovery key usage.
- [x] Document Beeper-only ephemeral support.
- [x] Document Beeper-native streaming and edit-fallback streaming.
- [x] Document feature support matrix.
