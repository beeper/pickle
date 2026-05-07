# @beeper/pickle-bridge

Bridge-building runtime for Pickle. This package is intentionally separate from
`@beeper/pickle`: Pickle owns the Matrix/WASM SDK, while this package owns
bridgev2-shaped connector interfaces and bridge runtime orchestration.

```ts
import { loginWithPassword } from "@beeper/pickle/auth";
import { createBeeperBridge } from "@beeper/pickle-bridge/node";
import type { BridgeConnector } from "@beeper/pickle-bridge/types";

const account = await loginWithPassword({
  username: process.env.BEEPER_USERNAME!,
  password: process.env.BEEPER_PASSWORD!,
});

// Replace this stub with your bridge's connector implementation.
const connector: BridgeConnector = {
  createLogin: async () => ({ cancel: async () => {}, start: async () => ({ type: "complete", complete: { userLoginId: "example-login" } }) }),
  getBridgeInfoVersion: () => ({ capabilities: 1, info: 1 }),
  getCapabilities: () => ({}),
  getConfig: () => ({}),
  getDBMetaTypes: () => ({}),
  getLoginFlows: () => [],
  getName: () => ({ displayName: "Example", networkId: "example" }),
  init: async () => {},
  loadUserLogin: async () => ({ connect: async () => {}, disconnect: async () => {} }),
  start: async () => {},
};

const bridge = await createBeeperBridge({
  account,
  bridge: "sh-example",
  connector,
});

await bridge.start();

const login = { id: "example-login" };
await bridge.loadUserLogin(login);
const portal = await bridge.createPortal(login, {
  id: "remote-room-id",
  info: { name: "Remote room" },
  sender: "alice",
});

await bridge.backfillPortal(login, portal);
await bridge.backfillPortal(login, "remote-room-id");

bridge.queue(login).message({
  id: "remote-message-id",
  portal: "remote-room-id",
  sender: "alice",
  text: "hello",
});

bridge.queue(login).message({
  id: "remote-rich-message-id",
  portal,
  sender: "alice",
  content: { msgtype: "m.notice", body: "custom Matrix content" },
});

bridge.queue(login).backfill({
  portal,
  messages: [
    { id: "old-message-1", sender: "alice", text: "older message" },
    { id: "old-message-2", sender: "alice", text: "newer message" },
  ],
});
```

The bridge package is Node-only and uses the same Pickle WASM mechanism as
`@beeper/pickle/node`. Bridge authors do not need to load `wasm_exec.js` or
`pickle.wasm`; the package loads the bundled runtime automatically.

## Bridge-manager helpers

`@beeper/pickle-bridge/beeper` exposes bridge-manager-compatible helpers:

- `createBeeperBridgeManagerClient({ token })`
- `fetchBeeperBridges({ token })`
- `createBeeperAppService({ token, bridge })`
- `createBeeperAppServiceInit({ token, bridge })`

These mirror the useful `bbctl whoami/register` pieces: fetch the user's
bridges from `https://api.<domain>/whoami`, then get or register the appservice
through Hungryserv at `/_matrix/asmux/mxauth/appservice/:user/:bridge`.
