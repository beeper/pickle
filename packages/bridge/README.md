# @beeper/pickle-bridge

Bridge-building runtime for Pickle. This package is intentionally separate from
`@beeper/pickle`: Pickle owns the Matrix/WASM SDK, while this package owns
bridgev2-shaped connector interfaces and bridge runtime orchestration.

```ts
import { createBridge, createRemoteMessage } from "@beeper/pickle-bridge/node";

const bridge = createBridge({
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
bridge.registerPortal({
  id: "remote-room-id",
  mxid: "!matrix-room:example.com",
  portalKey: { id: "remote-room-id", receiver: login.id },
});

bridge.queueRemoteEvent(login, createRemoteMessage({
  data: { text: "hello" },
  id: "remote-message-id",
  portalKey: { id: "remote-room-id", receiver: login.id },
  sender: { isFromMe: false, sender: "remote-user-id" },
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
