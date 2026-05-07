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
- fetch/register Beeper appservice credentials with bridge-manager-compatible helpers

Source lives in `src/*.ts`; the runnable files are built into `dist`.

## Smoke test

```sh
pnpm --filter @beeper/pickle-example-dummybridge smoke
```

The smoke test uses a fake Matrix client, so it does not need a homeserver.

## Live run

Copy `.env.example` to `.env`, fill in a homeserver, token, server name, and appservice registration fields, then run:

```sh
pnpm --filter @beeper/pickle-example-dummybridge start
```

If `BEEPER_ACCESS_TOKEN` is set, the example uses `createBeeperAppServiceInit()` to fetch/register the appservice through Beeper's bridge-manager-compatible Hungryserv endpoints. Without it, the example uses the local `DUMMYBRIDGE_AS_*` registration fields.

To create a portal at startup:

```sh
DUMMYBRIDGE_CREATE_ROOM=1 pnpm --filter @beeper/pickle-example-dummybridge start
```

To attach to an existing portal room instead:

```sh
DUMMYBRIDGE_PORTAL_ROOM_ID='!room:example' pnpm --filter @beeper/pickle-example-dummybridge start
```
