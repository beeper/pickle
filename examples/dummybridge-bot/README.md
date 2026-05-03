# DummyBridge bot

A Node Matrix bot built on the core SDK (no Chat SDK). Auto-joins invites, replies to every message, streams synthetic agent output, and demonstrates tools/approvals/artifacts.

```sh
pnpm build
cd examples/dummybridge-bot

# Token login
MATRIX_HOMESERVER_URL=https://matrix.example.org \
MATRIX_ACCESS_TOKEN=... \
MATRIX_RECOVERY_KEY='optional recovery key' \
pnpm start

# Or password login
MATRIX_HOMESERVER_URL=https://matrix.example.org \
MATRIX_USERNAME=@bot:example.org \
MATRIX_PASSWORD=... \
pnpm start
```

## Try it

Send any of these in a room the bot has joined:

- `help`
- `stream-lorem 4096 --reasoning=1200 --steps=3 --sources=4 --documents=3 --files=2 --meta --chunk-chars=48:160`
- `stream-tools 2500 search#delta#prelim approval#deny weather#provider --reasoning=800 --steps=3`
- `stream-random --actions=24 --profile=artifacts`
- `stream-chaos 4 --max-actions=16`
- `error`
