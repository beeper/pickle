# better-matrix-js-sdk

`better-matrix-js-sdk` is a small compatibility facade for applications that currently import `matrix-js-sdk`.

It is backed by `better-matrix-js` and targets the high-traffic Matrix SDK surface first: client creation, login, sync lifecycle events, room lookup, sending/editing/redacting messages, reactions, receipts, typing, joined rooms, room membership, profile lookup, and media helpers.

## Drop-in usage

Alias `matrix-js-sdk` to this package in your package manager or bundler:

```json
{
  "dependencies": {
    "matrix-js-sdk": "npm:better-matrix-js-sdk@^0.1.0"
  }
}
```

Then keep existing imports:

```ts
import * as sdk from "matrix-js-sdk";

const client = sdk.createClient({
  baseUrl: "https://matrix.example.org",
  accessToken,
  userId,
});

await client.startClient();
await client.sendTextMessage("!room:example.org", "hello");
```

This package is intentionally not a full reimplementation of upstream `matrix-js-sdk`. Unsupported methods throw a clear error so migrations fail loudly instead of silently diverging.
