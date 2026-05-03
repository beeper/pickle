# DummyBridge Bot Example

A Node-first Matrix bot example that mirrors the useful DummyBridge demo surface:
it accepts every invite, replies to all incoming messages, streams synthetic
agent output, demonstrates tools/approvals/artifacts in text, reacts to handled
messages, and keeps a small local state directory.

```sh
pnpm build
cd examples/dummybridge-bot
MATRIX_HOMESERVER_URL=https://matrix.example.org \
MATRIX_ACCESS_TOKEN=... \
MATRIX_RECOVERY_KEY='optional recovery key' \
pnpm start
```

Password login is also supported:

```sh
MATRIX_HOMESERVER_URL=https://matrix.example.org \
MATRIX_USERNAME=@bot:example.org \
MATRIX_PASSWORD=... \
pnpm start
```

Try these messages in any room the bot is invited to:

- `help`
- `stream-lorem 4096 --reasoning=1200 --steps=3 --sources=4 --documents=3 --files=2 --meta --chunk-chars=48:160`
- `stream-tools 2500 search#delta#prelim approval#deny weather#provider --reasoning=800 --steps=3`
- `stream-random --actions=24 --profile=artifacts`
- `stream-chaos 4 --max-actions=16`
- `error`

The example uses the core SDK directly, not the Chat SDK adapter.
