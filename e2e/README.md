# Matrix Live E2E

Live E2E tests are intentionally not part of default CI. They require real Matrix/Beeper accounts, durable stores, and recovery material for encrypted-history coverage.

## Account Strategy

Prefer cached Beeper accounts and stable device stores by default. Reusing accounts is required to catch the cases bots usually break:

- old encrypted rooms
- old Megolm sessions
- existing devices
- recovery after process and store reload
- history pagination across encrypted events
- multi-client same-process isolation

Fresh-device tests should be explicit opt-in scenarios because they create new Matrix devices.

## Required Environment

Use separate accounts for bot and peer:

```sh
export MATRIX_HOMESERVER_URL=https://matrix.beeper.com
export MATRIX_BOT_ACCESS_TOKEN=...
export MATRIX_PEER_ACCESS_TOKEN=...
export MATRIX_BOT_RECOVERY_KEY=...
export MATRIX_PEER_RECOVERY_KEY=...
export MATRIX_LIVE_E2E_STORE_DIR=.matrix-e2e-store
```

`MATRIX_LIVE_E2E_STORE_DIR` should be reused between runs unless a test explicitly validates fresh-device behavior.

## Required Scenarios

- lazy client can send/fetch without sync
- `boot()` initializes but does not emit app events
- `whoami()` confirms immutable account/device identity
- `client.subscribe(...)` returns `{ stop, catchUp, done }`
- default subscription receives future events only
- `catchUp()` replays missed events
- `onRawEvent(...)` receives granular Matrix payloads
- encrypted messages
- edits
- reactions and reaction removals
- media upload/download
- threads
- invites and auto-join
- room state
- account data
- to-device
- receipts
- reused accounts paginate and decrypt old encrypted history
- fresh and existing devices behave correctly
- multi-client same-process isolation
- Chat SDK live subscription mode
- Chat SDK sync-disabled mode
- Chat SDK webhook/apply mode

## Running

The current live smoke entrypoint is:

```sh
pnpm build
pnpm test:live -- --keep-store
```

Do not add this to default CI until the account provisioning and secret handling are automated.
