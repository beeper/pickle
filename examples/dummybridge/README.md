# Pickle DummyBridge

This is a minimal TypeScript bridge built on `@beeper/pickle-bridge`.

It demonstrates the bridge shape needed to:

- register a bridge connector
- start Pickle with the same WASM Matrix client
- initialize an appservice registration
- load a user login
- create or register a portal room
- backfill historical events
- receive Matrix messages and echo them back through appservice ghost users
- fetch/register Beeper appservice credentials from the Matrix login

Source lives in `src/*.ts`; the runnable files are built into `dist`.

## Smoke test

```sh
pnpm --filter @beeper/pickle-example-dummybridge smoke
```

The smoke test uses a fake Matrix client, so it does not need a homeserver.

## Live run

Copy `.env.example` to `.env`, then fill in `BEEPER_USERNAME` and `BEEPER_PASSWORD`:

```sh
pnpm --filter @beeper/pickle-example-dummybridge start
```

`loginWithPassword()` returns a standard Pickle Matrix account and defaults to Beeper unless a homeserver is provided. `createBeeperBridge()` takes that account, fetches/registers the Beeper appservice through the bridge-manager-compatible Hungryserv endpoints, uses the default file-backed state package, and starts the bridge runtime with the computed appservice registration.

To create a portal at startup:

```sh
DUMMYBRIDGE_CREATE_ROOM=1 pnpm --filter @beeper/pickle-example-dummybridge start
```

To attach to an existing portal room instead:

```sh
DUMMYBRIDGE_PORTAL_ROOM_ID='!room:example' pnpm --filter @beeper/pickle-example-dummybridge start
```
