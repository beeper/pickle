# @beeper/openclaw

Pickle bridge package for exposing OpenClaw sessions in Beeper/Matrix as an OpenClaw-native channel plugin.

## OpenClaw Plugin Install

Install the Beeper channel plugin from ClawHub:

```sh
openclaw plugins install clawhub:@beeper/openclaw
```

For a pinned install:

```sh
openclaw plugins install clawhub:@beeper/openclaw@0.1.0
```

OpenClaw loads the runtime entry from `dist/plugin-entry.mjs` and the lightweight dashboard/setup entry from `dist/setup-entry.mjs`. Configure the channel from the OpenClaw dashboard or with `openclaw channels add beeper`; the setup surface writes `channels.beeper` settings for the bridge runtime.

## What It Provides

- Beeper email-code login for existing accounts, with username/password login available when needed.
- Beeper appservice registration for the OpenClaw bridge.
- OpenClaw channel metadata, setup entrypoint, runtime entrypoint, and ClawHub install metadata.
- Pickle bridgev2-style transport for Matrix portals, media, reactions, and receipts.
- Direct in-process OpenClaw plugin runtime access.
- Agent ghosts for OpenClaw agents.
- Beeper contact-list/search and create-DM provisioning for OpenClaw agents.
- Matrix parsing for text, formatted bodies, replies, edits, reactions, redactions, attachments, and thread/relation metadata.
- Native Beeper stream publishing for reasoning, text, tool input/output, approvals, errors, aborts, and final replacement messages.
- OpenClaw-native command discovery and approval surfaces.
- Non-federated Matrix room creation defaults through the generated appservice registration.

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
  readConfig,
} from "@beeper/openclaw/config";
import {
  createOpenClawBeeperBridge,
} from "@beeper/openclaw/appservice";

const config = await readConfig();

const bridge = await createOpenClawBeeperBridge({
  config,
});

await bridge.start();
```

For normal use, run `pickle-openclaw login --email you@example.com` and let setup persist the owned Beeper device credentials.

The runtime uses the in-process OpenClaw plugin context and exposes the Beeper bridge as an OpenClaw channel connector.

## Protocol Coverage

`src/protocol-coverage.ts` tracks the OpenClaw channel-turn and Beeper streaming protocol surface. The manifest is tested so future changes can audit which event families are streamed to Beeper, mapped to approvals, intentionally ignored as operational noise, or handled by OpenClaw-native channel APIs.
