# OpenClaw Beeper plugin

This package is the OpenClaw channel plugin for the Beeper bridge. Treat it as a
first-class OpenClaw network plugin backed by Pickle and bridgev2 semantics.

## Local development

From the Pickle repo root:

```sh
pnpm --filter @beeper/openclaw build
```

From this package directory:

```sh
pnpm build
```

OpenClaw loads the runtime entry from `dist/plugin-entry.mjs` and the setup
entry from `dist/setup-entry.mjs`, so rebuild before installing or restarting a
locally linked plugin.

## Install or update the plugin

For a published install:

```sh
openclaw plugins install clawhub:@beeper/openclaw
```

For local development from this package directory:

```sh
pnpm build
openclaw plugins install --link .
```

If working from the Pickle repo root, pass the package path instead:

```sh
pnpm --filter @beeper/openclaw build
openclaw plugins install --link packages/openclaw
```

Check that OpenClaw discovered the plugin:

```sh
openclaw plugins list
openclaw plugins inspect beeper
openclaw plugins doctor
```

Configure the channel through OpenClaw's setup UI or CLI:

```sh
openclaw channels add
```

If the installed OpenClaw version exposes plugin channels through the channel
CLI, `openclaw channels add --channel beeper` may also work.

## Restart and inspect runtime state

Restart the gateway after changing plugin code or configuration:

```sh
openclaw gateway restart
```

Inspect gateway and channel status:

```sh
openclaw gateway status
openclaw channels list
openclaw channels status --probe
openclaw channels logs --channel beeper
```

For runtime debugging, run the gateway in the foreground:

```sh
openclaw gateway run --verbose
```

Use raw stream logging only when investigating OpenClaw stream exposure:

```sh
openclaw gateway run --verbose --raw-stream
```

## Testing

Run focused package tests while iterating:

```sh
pnpm --filter @beeper/openclaw exec vitest run
pnpm --filter @beeper/openclaw typecheck
pnpm --filter @beeper/openclaw build
```

Run Pickle native tests when changing generated contracts, appservice behavior,
room state, or bridge transport:

```sh
cd packages/pickle/native
go test ./internal/core
cd -
pnpm --filter @beeper/pickle build:wasm
```

Run OpenClaw plugin compatibility through Crabpot from the Pickle repo root:

```sh
npm run test:openclaw:plugins
```

The full suite is:

```sh
npm run full-test
```

Do not run opt-in isolated execution checks unless the task explicitly requires
side effects:

```sh
CRABPOT_EXECUTE_ISOLATED=1 npm --prefix ../crabpot run workspace:execute -- --fixture <fixture>
```

## Product and integration rules

- This is a bridge, not an open Matrix client. Users talk to OpenClaw agents
  from the Beeper/OpenClaw bridge instance; do not add outside-world Matrix
  semantics unless bridgev2 requires them.
- Every configured OpenClaw agent is a global ghost with the agent's attributes,
  including display name and avatar when exposed.
- Each Beeper turn should correspond to one OpenClaw/Beeper stream turn. Do not
  emit extra progress messages except approval anchors or bridge-required state.
- Anything OpenClaw exposes through callbacks, hooks, or runtime events must be
  mapped and streamed. Pickle cannot recover drops that OpenClaw never exposes.
- Prefer bridgev2 and generated Pickle Go contracts over direct TypeScript
  Matrix writes. Direct Matrix client usage is acceptable only where it matches
  bridgev2/mautrix bridge practice and keeps the system simpler.
- Keep the code small and direct: no fake layers, no convenience barrel exports,
  no duplicated types, no compatibility aliases for unreleased shapes.
- Do not patch the host OpenClaw source while working in this package. Use
  OpenClaw as a reference checkout and validate plugin behavior through the
  plugin SDK, CLI, and Crabpot.
