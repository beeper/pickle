# @beeper/pickle-openclaw

Pickle bridge package for exposing OpenClaw Gateway sessions in Beeper/Matrix.

## What It Provides

- Beeper email-code login for existing accounts or account creation.
- Beeper appservice registration for the OpenClaw bridge.
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

Request Beeper account creation during the same email-code flow:

```sh
pickle-openclaw beeper-login \
  --config ~/.openclaw/pickle-bridge/config.json \
  --email you@example.com \
  --login-code 123456 \
  --create-account
```

Register the OpenClaw appservice with Beeper:

```sh
pickle-openclaw beeper-register \
  --config ~/.openclaw/pickle-bridge/config.json
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

The runtime exposes `OpenClawGatewayRuntime.call(method, params)` for the full Gateway RPC surface. Common bridge paths also have wrappers for agents, sessions, models, tools, tasks, artifacts, approvals, and feature snapshots.

## Protocol Coverage

`src/protocol-coverage.ts` tracks the upstream Gateway method and event families from `.upstream/openclaw/docs/gateway/protocol.md`. The manifest is tested so future changes can audit which families are streamed to Matrix, mapped to approvals, intentionally ignored as operational noise, or available through generic Gateway calls.
