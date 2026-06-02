# OpenClaw Beeper Handoff

Date: 2026-06-02
Workspace: `/Users/batuhan/Projects/pickle`

## Installed Locations

- Pickle/OpenClaw bridge workspace: `/Users/batuhan/Projects/pickle`
- Live installed OpenClaw plugin: `/Users/batuhan/.openclaw/extensions/beeper`
- OpenClaw app source for reference: `/Users/batuhan/Projects/openclaw`
- ai-bridge source for reference and shared-package changes: `/Users/batuhan/Projects/ai-bridge`
- mautrix bridge examples/reference: `/Users/batuhan/Projects/mautrix`
- plugin validation harness: `/Users/batuhan/Projects/crabpot`

Live channel status at handoff:

```sh
openclaw channels status
```

Reports:

- Gateway reachable.
- Beeper default: enabled, configured, running.
- Telegram default: enabled, configured, running, connected. This is unrelated to the Beeper/OpenClaw bridge work.

## Original Product Goal

Build `@beeper/openclaw` as a first-class Beeper plugin backed by Pickle and bridgev2 semantics.

Target model:

- `UserLogin`: one Beeper/OpenClaw account/device.
- `Ghost`: one global OpenClaw agent user.
- `Portal`: one Matrix/Beeper conversation.
- `Session`: OpenClaw runtime state attached to a portal only after the first real user turn.

Expected behavior:

- Each configured OpenClaw agent gets a stable global ghost:
  `@<bridge_id>_agent_<agent_id>:<server>`.
- Each agent gets one welcome DM portal on connect.
- Users can start new DMs/groups with those ghost users.
- A new DM/group creates or claims a portal.
- The first real user message in that portal creates an OpenClaw session and persists `sessionKey` on the portal binding.
- Importing old OpenClaw sessions is explicitly later work and should not shape the core bridge.

Constraints from Batuhan:

- Use bridgev2/mautrix mental model as much as possible.
- Move as much logic as possible into Go and generated Go contracts.
- Reuse ai-bridge packages heavily, but do not import ai-bridge `internal` or connector-specific code.
- Keep code simple: no fake layers, no duplicate types, no barrel exports for convenience, no backcompat, no legacy migration baggage.
- Prefer deleting/collapsing code over preserving AI-generated parallel paths.
- Beeper-only setup. Do not expose homeserver/domain/token/appservice id as ordinary user settings.
- Product intent beats current code shape.

## Current Implementation Status

Important current git state:

```sh
git status --short
```

At handoff, modified files include:

- `packages/bridge/src/bridge.ts`
- `packages/bridge/src/bridge.test.ts`
- `packages/bridge/src/index.ts`
- `packages/openclaw/src/bridge-agent.ts`
- `packages/openclaw/src/connector.ts`
- `packages/openclaw/src/connector.test.ts`
- `packages/openclaw/src/openclaw-runtime.ts`

Do not assume all modifications are from the last agent turn. The tree has been evolving across multiple turns.

### ai-bridge Dependency

Pickle native Go helpers are pinned to the latest local ai-bridge commit we used:

```text
github.com/beeper/ai-bridge v0.0.0-20260602005818-ab83be648105
```

Local ai-bridge HEAD:

```text
ab83be648105 / ab83be64 Preserve tool metadata in final AI parts
```

This is in `packages/pickle/native/go.mod`. `go.sum` still contains the older pseudo-version too, which is normal unless cleaned by `go mod tidy`.

### Streaming / Beeper AI

Main stream logic lives in:

- Go/native: `packages/pickle/native/internal/core/beeper_ai_run.go`
- TS bridge stream adapter: `packages/bridge/src/beeper-stream.ts`
- OpenClaw runtime mapper: `packages/openclaw/src/openclaw-runtime.ts`
- OpenClaw channel runtime: `packages/openclaw/src/beeper-channel-runtime.ts`

Current state:

- Native Go path uses ai-bridge writer/projection/finalization.
- Finalization and large final parts upload are in Go through ai-bridge projection helpers.
- Semantic parts include text, reasoning, tool start/input/result, activity, state, raw/custom events.
- Tool result mapping now prefers actual stdout/stderr/response over status wrapper objects.
- Working placeholder suppression exists in both text and activity paths. The latest edit suppresses activity events whose visible text is exactly `Working...`.
- Pending tools are waited on before finalization in the TS runtime path.
- Final projection clears ai-bridge `Working...` fallback bodies for empty streams.

Known streaming gaps:

- Need live Beeper Desktop confirmation that rotating progress verbs render exactly like ai-bridge.
- Reasoning/thinking tokens depend on what OpenClaw emits. The bridge now maps reasoning events, but if OpenClaw emits no reasoning stream, Beeper will show none.
- The current rich stream mapper is still partly TypeScript. The long-term direction is more generated Go contracts and less TS mapping.
- Need compare against ai-bridge stream semantics again before calling this done, especially sequence ordering and final replacement behavior.

### Ghosts / Portals / Sessions

Main files:

- `packages/openclaw/src/connector.ts`
- `packages/openclaw/src/bridge-agent.ts`
- `packages/openclaw/src/registry.ts`
- `packages/openclaw/src/rooms.ts`

Current state:

- Agent ghosts are registered globally from OpenClaw agents.
- Agent contacts are exposed through contact list / identifier resolving.
- Each agent gets a welcome DM portal on connect.
- Welcome portal bindings are `kind: "agent"` with placeholder `sessionKey: "agent:<id>"`.
- On first real user turn, `OpenClawMatrixBridgeAgent.ensureSession()` creates a real OpenClaw session and now changes the binding to `kind: "session"`.
- The first user message in a welcome room therefore transitions from agent/welcome binding to a real session binding.
- Users can resolve agent ghosts and create fresh DMs.

Known portal/session gaps:

- Need deeper audit against bridgev2 examples in WhatsApp/Telegram/Signal for exact portal claiming, invite/group handling, and room metadata lifecycle.
- Need live test starting a new DM/group with an agent ghost from Beeper Desktop.
- Need ensure reconnect does not create duplicate welcome DMs after an agent binding has become a session binding. Current code uses the agent binding as the welcome-room marker, so this area needs attention after the new transition.
- Need improve ghost avatar/name syncing from OpenClaw agent metadata and verify desktop displays them correctly.

### Slash Commands

ai-bridge handles slash commands before the AI turn and replies with a command notice. OpenClaw previously parsed slash commands but still passed the slash text to the agent as prompt text.

Current state:

- `packages/openclaw/src/matrix-parser.ts` parses slash commands.
- `packages/openclaw/src/connector.ts` now intercepts OpenClaw `/help` and `/session`.
- `/session` is sent as an `m.notice` from the agent ghost or service bot, not as an AI turn.
- `/session` in a welcome room reports that no real session has started yet and does not create one.
- Unknown slash commands still fall through to OpenClaw as agent text for now.

Known command gaps:

- Need implement real `/stop`/`/abort` only after finding or adding a real OpenClaw cancellation primitive. Do not fake cancellation.
- Need decide which commands belong to OpenClaw channel runtime vs bridge control.
- Need richer formatting if Beeper Desktop supports a better command-result surface than `m.notice` HTML.

### Config / Setup

Current public Beeper channel settings are intentionally minimal:

- `enabled`
- `beeperEnv` with production as default

Public schema:

- `packages/openclaw/src/beeper-channel-config.schema.json`
- `packages/openclaw/openclaw.plugin.json`

Hidden persisted setup still includes appservice/homeserver/tokens/device data under channel settings. Do not expose these as normal user settings.

Login/setup direction:

- Email login is default.
- Username/password is optional.
- Token auth should be removed from user-facing setup.
- The bridge owns and persists its Beeper device.
- Appservice / bridge id should be derived per device. Do not ask for values that can be derived.
- `mode: "self-hosted-appservice"` and `registrationUrl: "websocket"` should be hardcoded through bridgev2/Pickle defaults, not user-configurable.

## Bridge Manager / Appservice Flow

Bridge-manager helper code:

- `packages/bridge/src/beeper.ts`
- Exports from `packages/bridge/src/index.ts`

The helper mirrors useful `bbctl whoami/register` pieces:

- `createBeeperBridgeManagerClient({ token })`
- `fetchBeeperBridges({ token })`
- `createBeeperAppService({ token, bridge })`
- `createBeeperAppServiceInit({ token, bridge })`

Flow:

1. Call Beeper API `https://api.<domain>/whoami`.
2. Get username and bridge-manager/Hungryserv metadata.
3. Register or fetch appservice through Hungryserv:
   `/_matrix/asmux/mxauth/appservice/:user/:bridge`.
4. Register with `self_hosted: true`, `receive_ephemeral: true`.
5. Post bridge state back to Beeper bridgebox with state events like `STARTING`, `RUNNING`, etc.
6. Produce `MatrixAppserviceInitOptions` with homeserver, homeserver domain, and registration tokens.

Runtime startup:

- OpenClaw channel startup is in `packages/openclaw/src/setup.ts`.
- It calls `startOpenClawBeeperBridge()` from `packages/openclaw/src/appservice.ts`.
- `startOpenClawBeeperBridge()` creates the Pickle bridge, starts it, and marks bridge state running.
- `packages/bridge/src/bridge.ts` boots Matrix, initializes appservice, loads persisted portals/logins, subscribes Matrix events, and starts websocket appservice transaction handling.
- If appservice registration URL is websocket/self-hosted, `AppserviceWebsocket` receives appservice transactions and feeds Matrix events into the bridge connector.

## Restart / Live Sync Commands

After changing `packages/openclaw`, rebuild and sync the installed plugin:

```sh
pnpm --filter @beeper/openclaw build
rsync -a --delete --exclude node_modules /Users/batuhan/Projects/pickle/packages/openclaw/ /Users/batuhan/.openclaw/extensions/beeper/
openclaw plugins registry --refresh
openclaw gateway restart
openclaw channels status
```

If native Go/Pickle code changes, build Pickle too:

```sh
pnpm --filter @beeper/pickle build
pnpm --filter @beeper/openclaw build
rsync -a --delete --exclude node_modules /Users/batuhan/Projects/pickle/packages/openclaw/ /Users/batuhan/.openclaw/extensions/beeper/
openclaw plugins registry --refresh
openclaw gateway restart
openclaw channels status
```

The `rsync --delete` command overwrites the live installed plugin from the workspace package while preserving `node_modules`.

## Useful Validation Commands

Focused tests that passed most recently:

```sh
pnpm --filter @beeper/openclaw test -- src/connector.test.ts src/openclaw-runtime.test.ts
```

Result: 16 files passed, 129 tests passed.

Native Go tests used earlier:

```sh
cd /Users/batuhan/Projects/pickle/packages/pickle/native
go test ./internal/core -run 'TestBeeperAIRun|TestAppservice'
```

OpenClaw broader tests used earlier:

```sh
pnpm --filter @beeper/openclaw test -- src/openclaw-extension.test.ts src/setup.test.ts src/config.test.ts src/beeper-setup.test.ts src/appservice.test.ts
pnpm --filter @beeper/openclaw build
```

Current warning:

```sh
pnpm --filter @beeper/openclaw typecheck
```

Currently fails in `packages/bridge/src/bridge.ts` and `packages/bridge/src/events.ts` with exact optional property/type errors. This was observed after the latest slash/stream edits. Do not treat the typecheck baseline as clean until those bridge-package errors are handled.

## Recent Decisions

- Do not include Beeper account secrets in repo docs or config. Credentials were only provided in chat for live login.
- Do not expose homeserver, domain, hs/as token, appservice id, bridge id, Matrix device id, import/backfill, or approval behavior as public OpenClaw channel settings.
- Keep `additionalProperties: true` in the channel schema for hidden setup state, but public schema and manifest only advertise user-facing settings.
- Slash commands that are bridge commands should not enter the agent prompt.
- Do not implement `/stop` as a fake bridge notice. It needs a real OpenClaw cancel API.
- Preserve ai-bridge semantics for streaming and finalization; if behavior differs from ai-bridge, treat that as a bug unless product intent says otherwise.
- Use actual tool output in Beeper UI, not wrapper/status-only payloads.
- Welcome room is not a session until first real user turn.
- Reasoning is enabled for Beeper sessions by patching OpenClaw sessions with `reasoningLevel: "on"` where supported.

## Highest Priority Next Gaps

1. Fix `@beeper/openclaw typecheck` by cleaning the bridge package type errors.
2. Re-run build and sync live plugin.
3. Live-test from Beeper Desktop:
   - fresh welcome DM per agent;
   - first real message creates one session;
   - `/session` is a notice and not an AI prompt;
   - no visible `Working...` flash;
   - tool parts stream in order;
   - command output shows actual stdout/response;
   - search/fetch/source results render with rich parts.
4. Compare connector lifecycle against `/Users/batuhan/Projects/mautrix` WhatsApp/Telegram/Signal examples and bridgev2 expectations.
5. Move more stream/finalization/contract logic into Go and generated types.
6. Add real cancellation support if OpenClaw exposes or can expose an active-run abort method.
7. Revisit welcome-room marker logic after `kind: "agent"` transitions to `kind: "session"` so reconnect does not create duplicate welcome rooms.
