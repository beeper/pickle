# E2E scripts

Standalone smoke scripts that exercise the SDK against a real Matrix homeserver. Not CI by default — bring your own accounts.

## Account file

Create `e2e-scripts/.out/accounts.json`:

```json
{
  "accounts": [
    {
      "homeserverUrl": "https://example.com",
      "userId": "@user:example.com",
      "deviceId": "DEVICEID",
      "accessToken": "ACCESS_TOKEN",
      "recoveryKey": "OPTIONAL_RECOVERY_KEY",
      "loginToken": "OPTIONAL_JWT_FOR_FRESH_DEVICE_TESTS",
      "username": "stable-label"
    }
  ]
}
```

Stores are reused between runs by default to keep encrypted-history coverage realistic.

| Env var | Effect |
| --- | --- |
| `MATRIX_E2E_RESET_STORES=1` | Wipe local stores before running |
| `MATRIX_E2E_FRESH_DEVICE=1` | Force fresh devices (requires `loginToken` per account) |

## Run

```sh
pnpm build
cd e2e-scripts

MATRIX_E2E_SDK_ROOT=.. npm run test:surface
MATRIX_E2E_SDK_ROOT=.. npm test
```

The Chat SDK adapter test needs the upstream `chat` package resolvable in Node.
