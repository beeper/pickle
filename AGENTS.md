# OpenClaw plugin

Use Crabpot for OpenClaw plugin and integration compatibility testing. Crabpot is the OpenClaw compatibility testbed for community plugins, plugin API seams, channel registration, lifecycle hooks, provider capabilities, cold imports, workspace planning, and static execution policy.

Expected sibling checkouts:

```sh
/Users/batuhan/Projects/pickle
/Users/batuhan/Projects/crabpot
/Users/batuhan/Projects/openclaw
```

If Crabpot is missing, set it up from the Pickle repo with:

```sh
git clone https://github.com/openclaw/crabpot.git ../crabpot
npm --prefix ../crabpot install
npm --prefix ../crabpot test
```

Crabpot defaults to `../openclaw` for source-mode OpenClaw checks. Clone `https://github.com/openclaw/openclaw.git` there when the checkout is missing, or set `CRABPOT_DIR=/path/to/crabpot` when Crabpot lives elsewhere.

Run the full Pickle and OpenClaw plugin compatibility suite with:

```sh
npm run full-test
```

That runs Pickle's existing `pnpm check` first, then `npm run check` in Crabpot through `scripts/openclaw-crabpot-full-test.mjs`.

Useful narrower commands:

```sh
npm run test:openclaw:plugins
npm --prefix ../crabpot run check
npm --prefix ../crabpot run report -- --check
npm --prefix ../crabpot run workspace:plan
```

Crabpot default checks are credential-free. Do not run opt-in isolated execution commands unless the task explicitly needs side effects, for example `CRABPOT_EXECUTE_ISOLATED=1 npm --prefix ../crabpot run workspace:execute -- --fixture <fixture>`.
