# Contributing to Movo

Thank you for considering a contribution. Movo sits in a payment path, so this document is
more prescriptive than most. Please read the two hard rules first.

## Hard rule 1 — the x402 narrow waist

**Only files under `packages/core/src/protocol/**` may import from `@x402/*`.**

Everywhere else, import what you need from `@movoframework/core`, re-exporting through the protocol
module if it is not already exposed.

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

## Getting set up

Node.js ≥22 and pnpm 10.x.

```bash
pnpm install
pnpm check:licenses
pnpm check:track-isolation
pnpm typecheck
pnpm lint
pnpm build
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
`docs/context/MOVO_FINAL_ARCHITECTURE_SPEC.md` §10. **Work from a later milestone does not
belong in a PR for an earlier one**, even when it is small and obviously needed later. If you
hit a genuine conflict between the specification and reality, stop and open an issue
explaining it rather than redesigning around it.

## PR checklist

Every PR must satisfy all of these (spec §16.3):

- [ ] Tests added or updated
- [ ] Typecheck, lint, build, unit + integration tests pass
- [ ] Licence gate and track-isolation check pass
- [ ] No secrets; no new logging of payloads or headers
- [ ] No protocol behaviour invented; no upstream functionality duplicated (cite the upstream
      export if adjacent)
- [ ] Narrow-waist rule respected
- [ ] Documentation updated; every new code block compiles
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

## Reporting problems

- Bugs and features: use the issue templates.
- **Upstream protocol drift** — an `@x402/*` change in shape, behaviour or wire format — has
  its own `protocol-drift` template. Please use it; these are tracked deliberately rather than
  absorbed silently.
- Security vulnerabilities: **do not open an issue.** See [SECURITY.md](SECURITY.md).
