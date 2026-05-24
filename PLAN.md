# Production OpenClaw Beeper Bridge

## Summary

Build a production ClawHub-installable OpenClaw channel plugin in Pickle that bridges OpenClaw sessions into Beeper through a self-hosted Beeper appservice. The plugin owns Beeper login, appservice registration, settings/setup, contact discovery, DM creation, Matrix event parsing, slash commands, native Beeper live streaming, approvals, reactions, replies, and opt-in session backfill.

The package remains in Pickle, but ships OpenClaw plugin metadata, setup entrypoints, and runtime entrypoints so users install it with `openclaw plugins install clawhub:<package>` and configure it from the OpenClaw dashboard.

## Key Changes

- Package and ClawHub shape:
  - Turn `packages/openclaw` into the public OpenClaw plugin package, with `openclaw.plugin.json`, `openclaw` package metadata, `setupEntry`, runtime entry, ClawHub install metadata, peer dependency on OpenClaw, and publish-ready docs.
  - Use channel id `beeper`, label `Beeper`, and keep Pickle bridge code as the transport/runtime layer inside the package.
  - Default import scope is opt-in per source: dashboard, TUI, channel-origin sessions, archived sessions.

- Beeper login, registration, and settings:
  - Add OpenClaw setup-entry support for dashboard-driven Beeper email/OTP login and self-hosted bridge/appservice registration.
  - Store settings under `plugins.entries.beeper.config` / `channels.beeper` as appropriate for OpenClaw channel config conventions.
  - Settings include Beeper env, registration URL, bridge manager token, gateway URL, import sources, backfill limit, non-federated rooms, contact visibility, stream/finalization behavior, and approval behavior.
  - CLI remains available for scripting, but dashboard setup is the primary path.

- Contacts, search, and DMs:
  - Sync all OpenClaw agents into Beeper ghosts with deterministic fixed MXIDs.
  - Expose agents through Pickle `resolveIdentifier` contact-list/search behavior and create one DM room per agent on demand.
  - `/new` creates a fresh OpenClaw session and Beeper room; existing agent DMs start a session on first user message.
  - Avoid bot-loop/cross-room forwarding: ignore Beeper self/bot-originated events and never forward messages between Beeper rooms.

- Matrix message parsing and commands:
  - Parse Matrix text, replies, threads, edits, reactions, redactions, attachments, emoji, formatted bodies, and relation chains into OpenClaw session input metadata.
  - Implement bridge slash commands in Matrix rooms: `/new`, `/agent`, `/sessions`, `/import`, `/backfill`, `/abort`, `/approve`, `/deny`, `/status`, `/settings`.
  - Reactions map to OpenClaw reactions where applicable, and approval reactions map to approval decisions.
  - Replies preserve target event/message ids and quoted context so OpenClaw can understand conversation references.

- Live streaming, approvals, and backfill:
  - Add the real default Beeper stream publisher using `client.beeper.streams.startMessage`, `publishPart`, and `finalizeMessage`.
  - Publish full AG-UI/Beeper native stream lifecycle: reasoning, text deltas, tool inputs, tool outputs, approval requests/responses, errors, aborts, and final replacement message.
  - Finalize streams as editable/replaced Beeper messages where supported; keep fallback final text for clients without native rendering.
  - Approval gates are end-to-end: Beeper approval UI/reactions/slash commands resolve OpenClaw exec/plugin approvals.
  - Backfill imports selected OpenClaw session sources only when enabled in settings, creates room bindings, preserves agent/user ghosts, and avoids duplicate imports via registry state.

## Test Plan

- Unit tests:
  - Beeper OTP/setup config, appservice registration, ClawHub/package metadata, settings schema, and dashboard setup adapters.
  - Agent contact sync/search/DM creation, fixed ghost MXIDs, bot-loop suppression, slash command parsing, and Matrix relation parsing.
  - Native stream publisher start/publish/finalize/error/abort behavior with AG-UI parts and final `com.beeper.ai` content.
  - Backfill opt-in source filtering, dedupe, registry persistence, and room binding.

- Integration-style tests:
  - Pickle bridge dispatch for messages, replies, reactions, edits, approvals, and backfill.
  - OpenClaw plugin setup-entry import safety using `.upstream/openclaw` channel plugin contracts.
  - Dashboard channel card/settings behavior via OpenClaw UI patterns where package-level tests can cover it without patching OpenClaw core.

- Verification gates:
  - `pnpm --filter @beeper/pickle-openclaw typecheck`
  - `pnpm --filter @beeper/pickle-openclaw test -- --run`
  - `pnpm --filter @beeper/pickle-openclaw build`
  - Focused Pickle bridge stream/appservice tests
  - Package validation for OpenClaw plugin manifest and ClawHub publish dry-run shape

## Assumptions

- Implementation stays in Pickle; OpenClaw core/dashboard are not patched.
- Users install from ClawHub, so dashboard integration must come from OpenClaw plugin metadata, setup entrypoints, config schema, channel metadata, and runtime methods.
- Default backfill/import is opt-in by source, not automatic.
- v1 must support at least contact search, create DM, full live streaming, approvals, replies, reactions, slash commands, Beeper login, bridge registration, dashboard setup/settings, and opt-in backfill.
