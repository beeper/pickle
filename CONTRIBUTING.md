# Contributing

pnpm workspaces, TypeScript, Go, and WebAssembly.

## Setup

```sh
pnpm install
pnpm build       # compiles TS + builds matrix-core.wasm via Go
```

Requires Node 22+, pnpm 9+, and a Go toolchain.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build
go test ./...   # run from packages/core/native
```

## Release

Always publish with pnpm so workspace dependency ranges get rewritten:

```sh
pnpm check
pnpm publish:packages
```

Don't run `npm publish` from a package directory — npm doesn't rewrite `workspace:*` ranges.
