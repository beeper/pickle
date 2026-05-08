# @beeper/pickle-pi

`@beeper/pickle-pi` is the Beeper-first Matrix appservice bridge for remote-controlling Pi sessions from Beeper Desktop and mobile.

The day-one target is a headless appservice agent:

- one Matrix/Beeper room per Pi session
- one Matrix Space per cwd/project
- a Pi appservice ghost displayed as `Pi`
- normal Pi session files under `~/.pi/pickle-pi/sessions`
- Beeper Desktop native AI stream chunks instead of debounced message edits

## CLI

```sh
pickle-pi-agent init
pickle-pi-agent register ~/.pi/pickle-pi
pickle-pi-agent start
pickle-pi-agent status
```

## Configuration

Config lives at `~/.pi/pickle-pi/config.json` and is written with `0600` permissions.

Environment overrides:

- `PICKLE_PI_HOMESERVER`
- `PICKLE_PI_ACCESS_TOKEN`
- `PICKLE_PI_RECOVERY_KEY`
- `PICKLE_PI_PICKLE_KEY`
- `PICKLE_PI_STORE_PATH`

## Status

This package currently contains the phase-1 appservice skeleton: registration generation, config persistence, registry persistence, room/space helpers, and Desktop-compatible stream chunk mapping. The headless `AgentSession` runtime lands in the next phase.
