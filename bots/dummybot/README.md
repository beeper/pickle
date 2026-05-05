# dummybot

Dummy Matrix bridge bot for exercising Pickle streaming behavior.

## Usage

```sh
pnpm --dir bots/dummybot build

MATRIX_HOMESERVER_URL=https://matrix.example.org \
MATRIX_USERNAME=dummybot \
MATRIX_PASSWORD=... \
pnpm --dir bots/dummybot start
```

Invite the bot account to a room and send `help` to see the supported dummy stream commands.

## Environment

- `MATRIX_HOMESERVER_URL` or `MATRIX_HOMESERVER`: Matrix homeserver URL.
- `MATRIX_ACCESS_TOKEN`: Existing access token. If omitted, `MATRIX_USERNAME` and `MATRIX_PASSWORD` are required.
- `MATRIX_USER_ID`, `MATRIX_DEVICE_ID`: Optional session values used with `MATRIX_ACCESS_TOKEN`.
- `MATRIX_STATE_DIR`: State directory. Defaults to `.matrix-state` under the package root.
- `MATRIX_ALLOWED_USER_IDS`: Optional comma-separated allowlist.
- `MATRIX_REPLY_IN_THREADS`: Reply in threads when set to `1`. Defaults to `1`.
- `MATRIX_STREAM_MODE`: Pickle stream mode. Defaults to `auto`.
- `MATRIX_STREAM_UPDATE_MS`: Stream update interval. Defaults to `500`.
- `MATRIX_CATCH_UP_ON_START`: Catch up subscriptions on boot when set to `1`.
- `MATRIX_ENV_FILE`: Env file path. Defaults to `.env` under the package root.
