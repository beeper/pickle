# @beeper/pickle-openclaw

Pickle bridge package for exposing OpenClaw sessions in Beeper/Matrix as an OpenClaw-native channel plugin.

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
- Direct in-process OpenClaw plugin runtime access.
- Agent ghosts for OpenClaw agents and user ghosts for imported one-to-one sessions.
- Beeper contact-list/search and create-DM provisioning for OpenClaw agents.
- Matrix parsing for text, formatted bodies, replies, edits, reactions, redactions, attachments, and thread/relation metadata.
- Matrix slash commands: `/new`, `/agent`, `/sessions`, `/import`, `/backfill`, `/stop`, `/approve`, `/deny`, `/status`, and `/settings`. `/abort` is accepted as a compatibility alias for `/stop`.
- Native Beeper stream publishing for reasoning, text, tool input/output, approvals, errors, aborts, and final replacement messages.
- Native approval UI parsing first, with reactions and `/approve`/`/deny` as escape hatches.
- Non-federated Matrix room creation defaults through the generated appservice registration.
- Opt-in backfill/import helpers for dashboard, TUI, channel-origin, and archived one-to-one OpenClaw sessions.

## CLI

Log in to an existing Beeper account and register the OpenClaw appservice:

```sh
pickle-openclaw login \
  --config ~/.openclaw/pickle-bridge/config.json \
  --email you@example.com
```

The login command requests the email login first, then prompts for the Beeper code. It does not support account registration; users need an existing Beeper account.

Print the saved Beeper bridge identity:

```sh
pickle-openclaw whoami --config ~/.openclaw/pickle-bridge/config.json
```

The bridge runtime itself is started by OpenClaw when the installed channel plugin is enabled.

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

The runtime uses the in-process OpenClaw plugin context and exposes wrappers for agents, sessions, models, tools, tasks, artifacts, approvals, and feature snapshots.

## Protocol Coverage

`src/protocol-coverage.ts` tracks the upstream Gateway method and event families from `.upstream/openclaw/docs/gateway/protocol.md`. The manifest is tested so future changes can audit which families are streamed to Matrix, mapped to approvals, intentionally ignored as operational noise, or available through generic Gateway calls.
