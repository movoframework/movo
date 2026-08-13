# Contributing to Movo

Thank you for considering a contribution. Movo sits in a payment path, so this document is
more prescriptive than most. Please read the hard rules first.

## Hard rule 1 — the x402 narrow waist

**Only files under `packages/core/src/protocol/**` may import from `@x402/*`** — with one
exception: `tests/e2e/**` and `tests/conformance/**` import `@x402/*` directly, because those
suites deliberately act as an unmodified third-party buyer and are not part of Movo's internal
architecture. `tests/integration/**` is *not* exempt and follows the rule like everything else.

Everywhere else, import what you need from `@movoframework/core`, re-exporting through the
protocol module if it is not already exposed. Note that some re-exports live at a subpath
rather than the package root — `@movoframework/core/server`, for instance, carries the
`@x402/express`-derived exports specifically so that importing the pure, network-free root
entry never pulls in an HTTP framework. Check the package's `exports` map before assuming
something belongs at the root.

The rule is enforced by `style/noRestrictedImports` in `biome.jsonc` and is proven to fire by
`tests/unit/narrow-waist.test.ts`. It exists because `@x402/*` is the protocol source of truth,
ships roughly weekly, and pins its own cross-package dependencies tightly. Confining those
imports to one directory means an upstream breaking change is one file to read, one file to
edit and one diff to review — instead of compile errors scattered across seven packages with
no single place to absorb them. See [ADR-0004](docs/adr/0004-x402-narrow-waist.md).

A corollary: **Movo never reimplements an x402 or Stellar protocol primitive.** No XDR
construction, no signature verification, no header building, no asset-decimal arithmetic, no
network identifier constants. If `@x402/core` or `@x402/stellar` exports it, import it. If you
believe something is genuinely missing upstream, say so in the PR and cite the declaration
file you checked — `node_modules/@x402/*/dist/**/*.d.mts` is authoritative; documentation
snippets go stale.

## Hard rule 2 — prohibited licences

Movo ships under Apache-2.0 and **no AGPL, SSPL, GPL-2.0 or GPL-3.0 dependency may appear
anywhere in the dependency path**, direct or transitive. LGPL is warned about and needs a
reviewer's judgement.

This is not stylistic. A Movo facilitator (M6) is designed to be operated as a *network
service*, and the AGPL's network clause would extend source-provision obligations to every
third party that service serves.

Three packages are named explicitly because they are the obvious things to reach for and they
are all **AGPL-3.0-or-later**:

- **OpenZeppelin Relayer**
- **the x402 Facilitator Plugin** (`relayer-plugin-x402-facilitator`)
- **the OpenZeppelin Relayer SDK**

These must **never be vendored, forked, copied, imported or adapted**, in whole or in part.
Reading them as public documentation is fine. **Calling a hosted facilitator over HTTP is
explicitly permitted** — invoking a remote network service is not a derivative work — so
configuring `https://channels.openzeppelin.com/x402*` or any other facilitator as a URL is
allowed and is not affected by this rule.

`pnpm check:licenses` enforces this on every PR and on a schedule. It is tested against a
planted AGPL fixture so that the gate is known to fire rather than assumed to.

## Hard rule 3 — no gate ships without a proof-of-failure test

**Any check intended to block a merge — a lint rule, the licence gate, the isolation check, a
redaction assertion, the documentation compiler — must have a committed fixture that makes it
fail, and a test asserting it fails on that fixture.**

A gate that has never been observed to fail has not been shown to work. It has been shown to
report success, which is not the same thing and is considerably more reassuring than it deserves
to be.

This is not hypothetical. In M0, Biome parsed `biome.json` as strict JSON and silently truncated
the configuration at an explanatory comment. Lint reported success while the narrow-waist rule —
the most load-bearing gate in the repository — was not loaded at all. Only the proof-of-failure
test caught it. (Config files that accept comments now use the `.jsonc` extension.)

## Hard rule 4 — single-source every identifier

**A value with more than one consumer is exported from exactly one module. Every gate, every
gate fixture and every test imports it rather than writing it out.**

The npm scope lives in `packages/core/src/identity.ts` as `MOVO_SCOPE`. The error documentation
base URL lives in `packages/core/src/errors/registry.ts` as `DOCS_BASE_URL`. Both are enforced by
tests that fail if a literal reappears anywhere else — `tests/unit/scope-drift.test.ts` and
`tests/unit/single-source.test.ts`.

The reason is a specific near-miss. When the project changed npm scope, the track-isolation gate
held the old scope as a literal in its matching pattern, and its proof-of-failure fixtures held
it again independently. The rename updated the fixtures, so the fixture test stayed green — while
the gate's pattern no longer matched anything that existed in real code. The gate was reporting
success on a repository it had stopped inspecting.

Two copies of a value do not stay in step, and when they diverge it is the *checked* copy that
keeps reporting success. Import specifiers are the one unavoidable exception, since a specifier
must be a literal; `tests/unit/scope-drift.test.ts` covers that case by asserting every
`packages/*/package.json` name against `MOVO_SCOPE`.

Apply the rule to anything new. If you add a gate, derive its patterns from a constant and
generate its fixtures from the same constant.

## Hard rule 5 — a plausible fake is worse than a missing implementation

**Before implementing any check against real external state — a network call, a contract
read, a signed payload, a settled transaction — verify the check fails when the real thing is
genuinely absent. Passing when handed a plausible value is not sufficient evidence that it
works.**

A stub, a placeholder, or a fixture that typechecks or passes without doing the real thing is
more dangerous than no implementation at all, because its presence signals nothing is wrong.
Three separate instances of this shape were caught before merge across the project's first two
milestones: a resource-type alias that typechecked while its schema variance ran backwards,
breaking the ordinary multi-resource case that every existing test happened not to exercise; a
payment context object built from empty strings and a hardcoded network, which would have lied
silently to any handler that read it; and a decimals check that stubbed its contract read and
always returned `"unknown"`. None were caught by the mechanism they most resembled satisfying —
a type system, a test suite, a lint rule. Each was caught by a stricter downstream check or a
second look.

When you write a test for something that touches real state, write it so that removing the
real behaviour and leaving only a plausible-looking placeholder makes the test fail. If it
would still pass, the test is not testing what you think it is.

## Hard rule 6 — later milestones stay behind their gate

**If implementing something in the milestone you are working on would require building the HTTP
`verify`/`settle`/`supported` surface — parsing or serialising a facilitator request or
response — stop. That is the M6 facilitator service, regardless of which package the code
would live in or how small its intended audience is.**

M6 exists behind an explicit decision gate (spec §26) precisely so that Movo does not commit to
operating facilitator infrastructure by default. A convenience method added to a testing
utility that happens to expose the same three routes is the same commitment made silently,
without the licence review, the conformance discipline, or the non-custody testing that §24
requires of the real thing. This applies by analogy to any core-track milestone reaching for a
capability that a later, gated milestone (M6 or M7) exists specifically to decide whether to
build.

If your milestone's own specification appears to ask for this, that is a specification
conflict — apply Hard rule 7, not this one's exception.

## Hard rule 7 — on conflict, stop and report

**If you find a genuine conflict between what the specification says, what a prior amendment
says, or what upstream actually does, stop. Do not guess between two readings and do not
silently redesign around the conflict.** Report exactly what conflicts, what you verified from
the installed declarations or the amendments already on file, and what a resolution would need
to preserve. A short spec amendment, written once, is worth more than a plausible guess reached
independently by whoever hits the same seam next.

This has already caught three real issues before any code was written on top of a wrong
assumption — worth more each time than the session it cost to pause.

## Hard rule 5 — do not smuggle gated infrastructure into the core track

**Does this feature quietly build an M6/M7 deliverable inside an earlier milestone?** In
particular, core-track code must not parse or serialise HTTP request/response bodies for
facilitator `verify`, `settle`, or `supported` endpoints. That is a facilitator service even if
it is small or test-only, and belongs behind the M6 decision gate.

## Getting set up

Node.js ≥22 and pnpm 10.x.

```bash
pnpm install
pnpm check:licenses
pnpm check:track-isolation
pnpm typecheck
pnpm lint
pnpm build
pnpm check:errors        # docs/reference/errors.md matches the error registry
pnpm check:docs          # every TypeScript block in docs/ compiles
pnpm test
```

`pnpm test` runs the `unit` and `integration` projects and performs no network I/O. The `e2e`
and `conformance` projects require `MOVO_E2E=1`; they depend on third-party services and never
block the PR gate.

## Branches and commits

- `main` is always releasable, protected, and merged into with squash commits.
- Work on `feat/*`, `fix/*`, `docs/*`, `chore/*` — short-lived, one milestone task each.
- `spike/*` branches are throwaway. They are **never merged** and **must be deleted** once
  their report is filed.
- [Conventional Commits](https://www.conventionalcommits.org): `feat`, `fix`, `docs`, `test`,
  `refactor`, `chore`, `security`, `perf`, `build`, `ci`. Scopes match package names —
  `feat(core):`, `fix(stellar):`. Breaking changes use `!` and require a changeset with a
  major bump and a migration note.

Contributions are accepted under Apache-2.0 with a DCO sign-off (`git commit -s`). There is no
CLA.

## Milestone discipline

Movo is built one milestone at a time and the milestones are specified in
`docs/context/MOVO_FINAL_ARCHITECTURE_SPEC.md` §10, as corrected by the spec amendments in
`docs/context/`. **Work from a later milestone does not belong in a PR for an earlier one**,
even when it is small and obviously needed later — see Hard rule 6. If you hit a genuine
conflict between the specification and reality, stop and open an issue explaining it rather
than redesigning around it — see Hard rule 7.

## PR checklist

Every PR must satisfy all of these (spec §16.3):

- [ ] Tests added or updated
- [ ] Typecheck, lint, build, unit + integration tests pass
- [ ] Licence gate and track-isolation check pass
- [ ] No secrets; no new logging of payloads or headers
- [ ] No protocol behaviour invented; no upstream functionality duplicated (cite the upstream
      export if adjacent)
- [ ] Narrow-waist rule respected
- [ ] Any new gate has a proof-of-failure fixture and a test asserting it fires (hard rule 3)
- [ ] No identifier written out twice; new constants are single-sourced and tested (hard rule 4)
- [ ] Any check against real external state fails when the real thing is absent, not only when
      handed a plausible value (hard rule 5)
- [ ] No code parses or serialises the facilitator `verify`/`settle`/`supported` HTTP surface
      outside M6 (hard rule 6)
- [ ] Documentation updated; every new code block compiles (`pnpm check:docs`)
- [ ] Public API changes documented and a changeset added
- [ ] Security implications stated
- [ ] Any new dependency justified in writing, with its licence named
- [ ] Milestone scope respected — no work from a later milestone

Two approvals are required for anything touching `packages/core`, `packages/facilitator`, or
the licence/CI tooling. One approval otherwise.

## Adding a dependency

Every runtime dependency needs written justification in the PR description, naming its licence
and why a Node built-in will not do. Prefer `node:util`'s `parseArgs`, `node:sqlite`,
`node --watch` and similar over a package. `@x402/*` dependencies are **exact-pinned** — no
`^`, no `~`. Caret ranges are fine for everything else.

A package's `dependencies` list is itself governed by the boundaries in the spec's package
register (§3.1) — for example, `@movoframework/server` must never depend on
`@movoframework/testing`, even in service of a convenience method. If a dependency you want to
add would violate a stated boundary, that is very likely Hard rule 6 or Hard rule 7, not a
reason to add an exception.

## Reporting problems

- Bugs and features: use the issue templates.
- **Upstream protocol drift** — an `@x402/*` change in shape, behaviour or wire format — has
  its own `protocol-drift` template. Please use it; these are tracked deliberately rather than
  absorbed silently.
- Security vulnerabilities: **do not open an issue.** See [SECURITY.md](SECURITY.md).
