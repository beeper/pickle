# Live E2E

Real-account smoke tests. Not part of default CI — they need actual Matrix/Beeper accounts and durable stores.

## Setup

Use **separate** accounts for bot and peer. Reuse stores between runs unless you're explicitly testing fresh-device behavior:

```sh
export MATRIX_HOMESERVER_URL=https://matrix.beeper.com
export MATRIX_BOT_ACCESS_TOKEN=...
export MATRIX_PEER_ACCESS_TOKEN=...
export MATRIX_BOT_RECOVERY_KEY=...
export MATRIX_PEER_RECOVERY_KEY=...
export MATRIX_LIVE_E2E_STORE_DIR=.matrix-e2e-store
```

## Run

```sh
pnpm build
pnpm test:live -- --keep-store
```

## What it covers

- Lazy client send/fetch with no sync
- `boot()`, `whoami()`, `client.subscribe(...)` lifecycle
- `catchUp()` replay
- Encrypted messages, edits, reactions, threads, media
- Invites and auto-join, room state, account data, to-device, receipts
- Reused accounts decrypting old encrypted history
- Multi-client same-process isolation
- Chat SDK adapter in live, sync-disabled, and webhook/apply modes

Why reuse accounts: the bugs that bite bots in production live in old encrypted rooms, old Megolm sessions, existing devices, and history pagination across reloads. Fresh-device runs are an explicit opt-in.
