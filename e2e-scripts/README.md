# E2E Scripts

These scripts were moved from the private E2E harness so we can keep the test
coverage close to the SDK. They intentionally do not include Beeper QA account
creation, fixed OTP flows, private tokens, or any account provisioning logic.

They are not CI tests by default. They require reusable Matrix/Beeper accounts
with access tokens and, for encrypted-history coverage, recovery keys.

## Account File

Create `e2e-scripts/.out/accounts.json` yourself:

```json
{
  "accounts": [
    {
      "homeserverUrl": "https://example.com",
      "userId": "@user:example.com",
      "deviceId": "DEVICEID",
      "accessToken": "ACCESS_TOKEN",
      "recoveryKey": "OPTIONAL_RECOVERY_KEY",
      "loginToken": "OPTIONAL_JWT_LOGIN_TOKEN_FOR_FRESH_DEVICE_TESTS",
      "username": "stable-label"
    }
  ]
}
```

The test suite reuses accounts and stores by default so old history, old devices,
and recovery behavior stay exercised. Use `MATRIX_E2E_RESET_STORES=1` when you
want to force a clean local store. Use `MATRIX_E2E_FRESH_DEVICE=1` only when the
accounts include reusable Matrix JWT login tokens.

## Running

Build the SDK first:

```sh
pnpm build
```

Then run from this directory or from the repo root:

```sh
cd e2e-scripts
MATRIX_E2E_SDK_ROOT=.. npm run test:surface
MATRIX_E2E_SDK_ROOT=.. npm test
```

The Chat SDK adapter test requires the upstream `chat` package to be resolvable
in Node, for example by installing/linking it in your local environment.
