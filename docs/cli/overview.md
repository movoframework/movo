# The `movo` CLI

Four commands.

| Command | What it is for |
|---|---|
| [`movo doctor`](doctor.md) | Every diagnostic Movo can run, each with a fix. Run it first. |
| [`movo dev`](dev.md) | The development server, printing resolved configuration and every paid route |
| [`movo test`](#movo-test) | Your tests. A thin Vitest wrapper. |
| [`movo bazaar`](bazaar.md) | Discovery metadata and catalog queries |

There is no `movo build` and no `movo deploy`. A Movo app is TypeScript — `tsc` compiles it and
Node ≥22 runs it without compiling at all — and a deploy command would imply a platform Movo does
not have. See [ADR-0011](../adr/0011-cli-scope.md).

**Movo collects no telemetry.** No usage counts, no error reports, no opt-out ping.

## Installation

The CLI arrives with a scaffolded project, so `npx movo` works from the project directory with
nothing else installed:

```bash
npm create movo-app my-api
cd my-api
npm install
npx movo doctor
```

To add it to an existing project:

```bash
npm install --save-dev @movoframework/cli
```

## Where commands look for your project

Every command walks **up** from the working directory looking for `movo.config.ts`, so being
three directories deep in `src/` is fine.

It then loads, in order:

1. `movo.config.ts` — `export default` or `export const config`
2. the app — the first of `src/app.ts`, `src/app.js`, `app.ts`, `src/index.ts` that exists,
   exporting `export default` or `export const app`

Both are loaded as **TypeScript**, using the type stripping built into Node 22 and later. There is
no build step, which is why Node 22 is a real floor rather than a recommendation.

Because Node does not rewrite module specifiers, relative imports in your project must name the
file that exists: `./resources/weather.ts`, not `./resources/weather.js`. The generated
`tsconfig.json` sets `allowImportingTsExtensions` so TypeScript agrees.

## Output

Colour is emitted only when stdout is a terminal. `NO_COLOR` disables it when **present at all**,
including when set to an empty string. `FORCE_COLOR` enables it outside a terminal but never
overrides `NO_COLOR`. `TERM=dumb` disables it.

Every `MovoError` renders as a code, a message, its safe context, its cause chain, a fix and a
documentation link:

```text
MOVO_E_PAYTO_MISSING  GET /weather/:city has no payTo, and neither configuration nor
                      MOVO_PAY_TO supplies one. There is no account to be paid.

  routeKey  GET /weather/:city

  fix   Set payTo in movo.config.ts, or MOVO_PAY_TO in the environment.
  docs  https://movoframework.github.io/movo/errors/MOVO_E_PAYTO_MISSING
```

**Nothing the CLI prints can be a credential.** `MovoError` redacts at construction rather than at
output (spec §1.5 P6), so there is no unredacted form of a secret held anywhere for an unexpected
output path to reach. `facilitator.authHeaders` is the one value redaction cannot help with — it
is a *function*, closing over the credential rather than containing it under a sensitive-looking
key — so it renders from its presence alone, as `configured (hidden)`, and is never invoked.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | The command ran and found a problem, or threw |
| `2` | The command line itself was wrong — unknown command, unknown check id, bad flag value |

`2` is distinct on purpose: a typo in `--check stellar.trustlien` must not report a clean bill of
health for a check that never ran.

## `movo test`

```bash
movo test                     # your project's tests
movo test --watch
movo test src/weather.test.ts
movo test -t "settles"
```

A thin wrapper. It preloads `@movoframework/testing/setup`, which registers the matchers
(`toBePaymentRequired`, `toBeSettled`, `toBeRejectedWithReason`), and forwards every other
argument to Vitest untouched — so every Vitest answer you find elsewhere is correct here.

Vitest is resolved from **your** project, so a version you pinned is the version that runs. If it
is not installed you get a message saying so rather than a fallback to something else.

## Using the checks without the CLI

Every check `movo doctor` runs is a library export, because a check that only a CLI can run
cannot be run by your CI:

```ts no-check
import { checkNodeVersion, checkPinDrift } from "@movoframework/core";
import { preflight } from "@movoframework/stellar";
import { attachDiscovery } from "@movoframework/bazaar";
```

See [doctor.md](doctor.md) for what each one does.
