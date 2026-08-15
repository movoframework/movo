# ADR-0011 — CLI scope: why there is no `build` and no `deploy`

- **Status:** Accepted
- **Date:** 2026-08-15
- **Milestone:** M5
- **Related:** ADR-0006 (config provenance), ADR-0009 (testing strategy), Spec Amendment 005 §1
- **Implements:** spec §5.12, §1.17

## Context

Every framework CLI accumulates the same four commands: `dev`, `build`, `test`, `deploy`. Two of
them are load-bearing for Movo and two of them would be liabilities.

## Decision

**Four commands: `dev`, `doctor`, `test`, `bazaar`.** No `build`. No `deploy`. No telemetry. No
plugin system.

### No `movo build`

A Movo app is TypeScript. `tsc` compiles it, and Node ≥22 runs it without compiling at all. A
`movo build` would be a wrapper around a compiler that already works, and it would immediately
acquire opinions — an output directory, a bundling decision, a sourcemap policy — that the
framework has no business holding. Every one of those opinions is a thing a user would eventually
need to override, and the override surface would be larger than the command.

The scaffolded projects have no build step in their happy path. `movo dev` runs `src/server.ts`
directly; `npm start` runs the same file. That is the point.

### No `movo deploy`

A deploy command implies a platform. Movo does not have one, and a command that shells out to
somebody else's platform is either a thin alias for their CLI or a leaky abstraction over it.
Neither earns a place in the surface area.

The honest version is documentation: a Movo app is a Node process, deploy it anywhere that runs
Node. `movo doctor` is what makes that safe, because it answers "is this environment actually
configured correctly" — which is the question a deploy command would have been used to dodge.

### No telemetry

Movo collects nothing. Not usage counts, not error reports, not an opt-out ping. This is stated
in the README, in both templates, and in `movo --help`, because a framework that handles payment
configuration and Stellar addresses has a higher bar than a framework that does not.

## `movo doctor` composes; it does not implement

**Every check `movo doctor` runs is already a library export.** `checkNodeVersion` and
`checkPinDrift` from `@movoframework/core`, the six preflight checks from
`@movoframework/stellar`, `attachDiscovery` from `@movoframework/bazaar`, and compilation's own
diagnostics from `compileApp`.

The reason is not tidiness. A check that lives only inside a CLI command **cannot be run by a
downstream project's CI**, and "fail our build when the payTo account loses its trustline" is the
first thing a team adopting this will want. Shelling out to `movo doctor --json` and parsing the
result is not an answer; it is a workaround for a boundary drawn in the wrong place.

`tests/integration/cli-dev-bazaar.test.ts` asserts the boundary mechanically: the doctor check
registry is derived from `ALL_CHECKS`, so a seventh preflight check cannot be added to the library
and silently stay unreachable from the CLI.

What the CLI does own is **sequencing and policy**. Which group runs first is a CLI decision —
a developer whose Node is too old should read that before six timeouts caused by it. And whether
a `warn` should fail a build is the caller's decision, which is why `--fail-on` is a flag and not
a library constant (spec §5.6).

### The two environment checks are pure functions

`checkNodeVersion(version)` and `checkPinDrift(comparisons)` take data and return a `Finding`.
The CLI reads `process.version`, resolves the installed manifests and parses
`docs/COMPATIBILITY.md`; the library judges. That split keeps `@movoframework/core` free of
filesystem I/O — which is what lets the unit suite stay hermetic and lets `compileApp` analyse a
project statically — while keeping the *judgement* reusable.

## `movo dev` spawns a runner the CLI ships

Amendment 005 §1 removed `"in-process"` and `"mock"` from `MountOptions.facilitator`, because
`@movoframework/server` resolving those strings would mean depending on `@movoframework/testing`
at runtime. Construction moved to the CLI, which may depend on the testing toolkit.

That creates a wrinkle: `node --watch` restarts the process it is given, and the process that
constructs the facilitator has to be the one that mounts. So `movo dev` spawns
`node --watch <cli>/dist/dev-runner.js` rather than the project's own `src/server.ts`. The runner
resolves the flag, constructs a `MockFacilitator` or an `InProcessFacilitator`, and passes the
constructed instance to `mountNodeHttp`. `@movoframework/server` never sees the string.

The project's `src/server.ts` remains the plain production path, unchanged and unreferenced by
`movo dev`. Pointing `--watch` at the CLI's own entry instead would re-parse arguments and
re-print the banner on every file save.

**The mainnet refusal is enforced in both places, and that duplication is deliberate.** The CLI
refuses before spawning anything, so the failure reads as an answer about the flag the developer
typed; the runner refuses again, so the guard holds if anything ever invokes it directly. It
carries its own code — `MOVO_E_FACILITATOR_PUBNET_REFUSED`, not `MOVO_E_PUBNET_NOT_ENABLED` —
because the latter's fix is "set `MOVO_ALLOW_PUBNET=1`", and this refusal fires *after* that has
been set. Handing a reader a remedy they have already applied is worse than handing them none.

## `movo test` is a Vitest wrapper and nothing else

It adds one thing: `--setupFiles @movoframework/testing/setup`, so the matchers are registered.
Every other argument is forwarded verbatim, including the absence of `run` — Vitest already
watches in a TTY and runs once outside one, and injecting `run` would make `movo test --watch`
mean something different from what every Vitest answer on the internet says it means.

Vitest is resolved from the **project**, not from the CLI's own dependencies, so a project
pinning a particular version gets that one.

## Templates are workspace members

Both templates live in `packages/create-movo-app/templates/` and are real pnpm workspace members.
CI compiles, lints and tests them alongside everything else.

The alternative — templates as string literals in the scaffolder, or as an untracked directory —
rots within weeks and rots *invisibly*, because nothing compiles it. A template is the first code
a user reads; shipping one that does not compile against the current API is the fastest available
way to lose them.

Three things cannot survive the copy and are rewritten at scaffold time:

| Rewritten | Why |
|---|---|
| `workspace:*` ranges | No registry can resolve one; `npm install` fails on the first dependency |
| `tsconfig.json` | The template's extends the monorepo base, which a generated project cannot see |
| `gitignore` → `.gitignore` | npm renames a published `.gitignore` to `.npmignore`, so it would arrive missing and a user's `.env` would be one `git add .` from a public repository |

`--link-workspace` rewrites the ranges to `file:` paths into the monorepo instead. That is what
makes the automated scaffold test check *this branch's* code rather than whatever is published.

## Consequences

- No argument-parsing dependency. `util.parseArgs` covers four commands and eleven flags, and a
  CLI whose pitch is that the toolchain should be small cannot open with a parser dependency.
- No table library and no colour library. `NO_COLOR`, `FORCE_COLOR`, `TERM=dumb` and TTY
  detection are about thirty lines, and the default is inverted from the usual: colour is off
  unless positively known to be safe, because doctor output gets pasted into bug reports.
- Commands take a `CommandContext` and return an exit code instead of calling `process.exit()`.
  That is what makes AC5.4's "zero bytes" claim checkable rather than arguable — a single
  `console.log` reaching the real stdout would be a hole in the assertion.
- `movo build` and `movo deploy` will be requested. The answer is in this file rather than in a
  maintainer's memory.
