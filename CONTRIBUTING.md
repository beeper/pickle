# Contributing

pnpm workspaces, TypeScript, Go, and WebAssembly.

## Setup

```sh
pnpm install
pnpm build       # compiles TS + builds pickle.wasm via Go
```

Requires Node 22+, pnpm 9+, and a Go toolchain.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm test:go    # runs Pickle's Go tests with the goolm build tag
```

## Release

Add a changeset with each user-facing package change:

```sh
pnpm changeset
```

When changes land on `main`, GitHub Actions opens or updates a release PR.
Merging that release PR runs the full `pnpm check` gate, publishes changed
packages with `pnpm changeset publish`, and creates GitHub Releases.

Publishing uses npm Trusted Publishing through GitHub Actions OIDC. Each npm
package must configure this trusted publisher on npmjs.com:

- Organization/repository: `beeper/pickle`
- Workflow: `.github/workflows/release.yml`
- Environment: leave blank unless the workflow is later moved behind a GitHub
  deployment environment

After the first OIDC publish succeeds, disable token publishing for the package
on npmjs.com and revoke any old automation publish tokens.
