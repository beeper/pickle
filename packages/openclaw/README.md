# @beeper/pickle-openclaw

`@beeper/pickle-openclaw` is the Pickle package for bridging OpenClaw sessions into Beeper/Matrix.

The bridge is appservice-first: it creates non-federated Matrix rooms on the homeserver, represents every OpenClaw agent as a bridge-owned ghost contact, and streams OpenClaw runs into Beeper Desktop's native AI message UI.

Current package surface:

- OpenClaw session and agent binding types.
- Desktop-compatible stream chunk builders.
- OpenClaw SDK event to Beeper stream mapping for assistant text, thinking, tools, run finalization, and approvals.

Planned appservice modules will add Beeper account setup/provisioning, bridge registration, room and Space management, terminal/mac app backfill, and live OpenClaw gateway session control.
