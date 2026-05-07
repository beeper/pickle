# @beeper/pickle-bridge

Bridge-building runtime for Pickle. This package is intentionally separate from
`@beeper/pickle`: Pickle owns the Matrix/WASM SDK, while this package owns
bridgev2-shaped connector interfaces and bridge runtime orchestration.

```ts
import { loginWithPassword } from "@beeper/pickle/auth";
import { createBeeperBridge, createRemoteMessage } from "@beeper/pickle-bridge";

const account = await loginWithPassword({
  username: process.env.BEEPER_USERNAME!,
  password: process.env.BEEPER_PASSWORD!,
});

const bridge = await createBeeperBridge({
  account,
  bridge: "sh-example",
  connector,
});

await bridge.start();

const login = { id: "example-login" };
await bridge.loadUserLogin(login);
const portal = await bridge.createPortalRoom({
  info: { name: "Remote room" },
  portalKey: { id: "remote-room-id", receiver: login.id },
  userId: "@example_alice:example.com",
});

await bridge.backfillMessages(login, { portal });

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

The bridge package is Node-only and uses the same Pickle WASM mechanism as
`@beeper/pickle/node`. Bridge authors do not need to load `wasm_exec.js` or
`pickle.wasm`; the package loads the bundled runtime automatically.

## Bridge-manager helpers

`@beeper/pickle-bridge` also exposes bridge-manager-compatible helpers:

- `createBeeperBridgeManagerClient({ token })`
- `fetchBeeperBridges({ token })`
- `createBeeperAppService({ token, bridge })`
- `createBeeperAppServiceInit({ token, bridge })`

These mirror the useful `bbctl whoami/register` pieces: fetch the user's
bridges from `https://api.<domain>/whoami`, then get or register the appservice
through Hungryserv at `/_matrix/asmux/mxauth/appservice/:user/:bridge`.
