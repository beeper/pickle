# @beeper/pickle-bridge

Bridge-building runtime for Pickle. This package is intentionally separate from
`@beeper/pickle`: Pickle owns the Matrix/WASM SDK, while this package owns
bridgev2-shaped connector interfaces and bridge runtime orchestration.

```ts
import { createBeeperAppServiceInit, createBridge, createRemoteMessage } from "@beeper/pickle-bridge/node";

const appservice = process.env.BEEPER_ACCESS_TOKEN
  ? await createBeeperAppServiceInit({
    bridge: "sh-example",
    homeserver: process.env.MATRIX_HOMESERVER!,
    homeserverDomain: process.env.MATRIX_SERVER_NAME!,
    token: process.env.BEEPER_ACCESS_TOKEN,
  })
  : {
    homeserver: process.env.MATRIX_HOMESERVER!,
    homeserverDomain: process.env.MATRIX_SERVER_NAME!,
    registration,
  };

const bridge = createBridge({
  appservice,
  matrix: {
    homeserver: process.env.MATRIX_HOMESERVER!,
    token: process.env.MATRIX_ACCESS_TOKEN!,
    store,
  },
  connector,
});

await bridge.start();

const login = { id: "example-login" };
await bridge.loadUserLogin(login);
const portal = await bridge.createPortalRoom({
  name: "Remote room",
  portalKey: { id: "remote-room-id", receiver: login.id },
  userId: "@example_alice:example.com",
});

await bridge.backfill({
  roomId: portal.mxid!,
  events: [{
    sender: "@example_alice:example.com",
    timestamp: Date.now() - 60_000,
    content: { msgtype: "m.text", body: "historical hello" },
  }],
});

bridge.queueRemoteEvent(login, createRemoteMessage({
  data: { text: "hello" },
  id: "remote-message-id",
  portalKey: { id: "remote-room-id", receiver: login.id },
  sender: { isFromMe: false, sender: "@example_alice:example.com" },
  convert: (_ctx, _portal, _intent, data) => ({
    parts: [{
      type: "m.room.message",
      content: { msgtype: "m.text", body: data.text },
    }],
  }),
}));
```

The Node entrypoint uses the same Pickle WASM mechanism as `@beeper/pickle/node`.
Browser and worker callers can import from `@beeper/pickle-bridge` and provide
`wasmBytes`, `wasmModule`, or `wasmUrl`.

## Bridge-manager helpers

`@beeper/pickle-bridge` also exposes bridge-manager-compatible helpers:

- `createBeeperBridgeManagerClient({ token })`
- `fetchBeeperBridges({ token })`
- `createBeeperAppService({ token, bridge })`
- `createBeeperAppServiceInit({ token, bridge })`

These mirror the useful `bbctl whoami/register` pieces: fetch the user's
bridges from `https://api.<domain>/whoami`, then get or register the appservice
through Hungryserv at `/_matrix/asmux/mxauth/appservice/:user/:bridge`.
