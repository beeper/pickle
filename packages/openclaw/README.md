# @beeper/pickle-openclaw

Pickle bridge package for exposing OpenClaw Gateway sessions in Beeper/Matrix.

## OpenClaw Plugin Install

Install the Beeper channel plugin from ClawHub:

```sh
openclaw plugins install clawhub:@beeper/pickle-openclaw@0.1.0
```

OpenClaw loads the runtime entry from `dist/plugin-entry.mjs` and the lightweight dashboard/setup entry from `dist/setup-entry.mjs`. Configure the channel from the OpenClaw dashboard or with `openclaw channels add beeper`; the setup surface writes `channels.beeper` settings for the bridge runtime.

## What It Provides

- Beeper email-code login for existing accounts.
- Beeper appservice registration for the OpenClaw bridge.
- OpenClaw channel metadata, setup entrypoint, runtime entrypoint, and ClawHub install metadata.
- Pickle bridgev2-style connector for OpenClaw agents, sessions, approvals, and backfill.
- OpenClaw WebSocket Gateway transport using protocol v4 `req`/`res`/`event` frames.
- Compatibility HTTP/SSE transport for gateway-like test or proxy deployments.
- Agent ghosts for OpenClaw agents and user ghosts for imported one-to-one sessions.
- Non-federated Matrix room creation defaults through the generated appservice registration.
- Backfill helpers for terminal, mac app, and external one-to-one OpenClaw sessions.

## CLI

Write a local config:

```sh
pickle-openclaw init \
  --config ~/.openclaw/pickle-bridge/config.json \
  --gateway-url ws://127.0.0.1:18789
```

Log in to an existing Beeper account:

```sh
pickle-openclaw beeper-login \
  --config ~/.openclaw/pickle-bridge/config.json \
  --email you@example.com \
  --login-code 123456
```

Register the OpenClaw appservice with Beeper:

```sh
pickle-openclaw beeper-register \
  --config ~/.openclaw/pickle-bridge/config.json \
  --bridge-manager-token "$BEEPER_BRIDGE_MANAGER_TOKEN"
```

Do login and appservice registration in one step:

```sh
pickle-openclaw beeper-setup \
  --config ~/.openclaw/pickle-bridge/config.json \
  --email you@example.com \
  --login-code 123456 \
  --gateway-url ws://127.0.0.1:18789
```

Start the bridge:

```sh
pickle-openclaw start --config ~/.openclaw/pickle-bridge/config.json
```

Start the bridge and import discovered one-to-one OpenClaw sessions from terminal, mac app, and channel surfaces:

```sh
pickle-openclaw start \
  --config ~/.openclaw/pickle-bridge/config.json \
  --backfill \
  --backfill-limit 500
```

Probe or call the Gateway surface directly:

```sh
pickle-openclaw features --config ~/.openclaw/pickle-bridge/config.json

pickle-openclaw rpc \
  --config ~/.openclaw/pickle-bridge/config.json \
  config.schema.lookup \
  --params-json '{"path":["agents"]}'
```

## Programmatic Runtime

```ts
import {
  accountFromOpenClawConfig,
  backfillAllOpenClawSessions,
  createDefaultConfig,
  createOpenClawBeeperBridge,
} from "@beeper/pickle-openclaw";

const config = createDefaultConfig({
  accessToken: process.env.BEEPER_ACCESS_TOKEN,
  gatewayUrl: "ws://127.0.0.1:18789",
  homeserver: "https://matrix.beeper.com",
  matrixDeviceId: process.env.BEEPER_DEVICE_ID,
  matrixUserId: process.env.BEEPER_USER_ID,
});

const bridge = await createOpenClawBeeperBridge({
  account: accountFromOpenClawConfig(config),
  config,
});

await bridge.start();
```

The runtime exposes `OpenClawGatewayRuntime.call(method, params)` and the CLI exposes `pickle-openclaw rpc <method> --params-json <json>` for the full Gateway RPC surface. Common bridge paths also have wrappers for agents, sessions, models, tools, tasks, artifacts, approvals, and feature snapshots.

## Protocol Coverage

`src/protocol-coverage.ts` tracks the upstream Gateway method and event families from `.upstream/openclaw/docs/gateway/protocol.md`. The manifest is tested so future changes can audit which families are streamed to Matrix, mapped to approvals, intentionally ignored as operational noise, or available through generic Gateway calls.
