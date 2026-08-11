# ADR-0002 — Package boundaries, and why no `@movoframework/x402` package exists

- **Status:** Accepted
- **Date:** 2026-08-09
- **Milestone:** M0
- **Relates to:** spec §3.1, §4, §1.8 D1/D8, ADR-0001, ADR-0004

## Context

Movo needs a package layout that survives two forces: weekly upstream churn in `@x402/*`, and
a second, RFP-driven workstream (a facilitator service and a discovery catalog) whose
requirements are much larger than the framework's own thesis.

The obvious first instinct — a `@movoframework/x402` package that owns "the protocol abstraction" for
the rest of the monorepo — deserves an explicit rejection rather than a silent omission,
because it is what most people would reach for.

## Decision

**Eight core-track packages, three gated SCF-track packages, and no `@movoframework/x402`.**

### Core track — ships v0.1.0 regardless

| Package | Responsibility | Notably *not* its job |
|---|---|---|
| `@movoframework/core` | Config, resource model, compilation, errors, redaction, and the protocol narrow waist | Depending on any other `@movoframework/*` package; knowing about Express or the Stellar SDK |
| `@movoframework/server` | Compile Movo resources into an x402 `RoutesConfig` and mount it | Writing header encoding, 402 construction, or a lifecycle state machine |
| `@movoframework/stellar` | Preflight diagnostics and remediation hints | Defining Stellar constants, addresses, decimals or validators |
| `@movoframework/bazaar` | Derive discovery declarations; escalate upstream's soft-drop findings to build-time errors | Implementing its own validators |
| `@movoframework/client` | Stateful budget accounting, typed clients, outcome decoding | Generating or storing a key of any kind |
| `@movoframework/testing` | Facilitator fixtures, the failure matrix, harness, matchers | Being a runtime dependency of anything |
| `@movoframework/cli` | Commands; composition only | Containing check logic not exported by a library package |
| `create-movo-app` | Scaffolding | Runtime dependencies |

### SCF track — gated after M5, ships v0.2.0 or not at all

`@movoframework/facilitator`, `@movoframework/catalog`, `@movoframework/mcp`, and the deployable `apps/facilitator`.
These do not exist at M0 and are deliberately absent from the workspace.

### The dependency direction is one-way and machine-checked

No package in `packages/{core,server,stellar,bazaar,client,testing,cli}` may import from
`packages/{facilitator,catalog,mcp}` — by module specifier, by relative path, or by declared
dependency. `pnpm check:track-isolation` enforces all three and is tested against a fixture
that violates each.

### No `@movoframework/x402`

`@x402/core` **is** the protocol abstraction. Movo does not mirror it. All protocol types and
primitives are reached through one internal module, `packages/core/src/protocol/`, which is the
only place in the monorepo permitted to import `@x402/*` (ADR-0004).

A published `@movoframework/x402` façade would:

- create a second set of type names for the same wire objects, so that two names must be kept
  in correspondence forever;
- double the version-coupling surface — every upstream release becomes a Movo release
  decision, at roughly weekly cadence;
- add no capability whatsoever, since the façade's entire content would be re-exports.

The narrow waist achieves the same isolation goal at a fraction of the cost, because it is a
*directory* rather than a *package*: it needs no version, no publish, no changelog and no
compatibility promise.

## Consequences

- A Movo consumer who wants an unaliased x402 type imports it from `@x402/core` themselves.
  This is correct — protocol semantics stay visible — but it must be documented, because it is
  the one place where Movo's abstraction deliberately stops.
- `@movoframework/core` depends on no other `@movoframework/*` package. This keeps the dependency graph acyclic
  by construction rather than by discipline.
- The repository can lose the entire SCF track at the M5 gate and still release a coherent
  product. That is the property the track-isolation gate exists to protect.
- Two audiences in one repository requires partitioned documentation. Accepted; the
  alternative (a second repository) would duplicate CI, licence tooling and docs while still
  needing the core packages.

### Dependency placement at M0 — a deliberate deviation, recorded

Spec §3.1's "Depends on" column assigns `@x402/stellar` to `@movoframework/stellar`,
`@x402/extensions` to `@movoframework/bazaar`, and so on. At M0 those packages contain no code, and
under ADR-0004 they may not import `@x402/*` directly in any case — §3.1 itself notes for
`@movoframework/server` that its access is "via core waist re-export".

Therefore, at M0:

- `packages/core` declares `@x402/core` exactly (`2.21.0`), matching §3.1 precisely.
- `@x402/express`, `@x402/extensions`, `@x402/fetch` and `@x402/stellar` are exact-pinned as
  **root dev dependencies**, so that `pnpm generate:compat`, `pnpm check:licenses` and the
  conformance probe see the whole protocol surface. The root is not a published package, so
  this makes no architectural claim.
- Each moves to the package §3.1 assigns it to at the milestone where that package gains code.

This is recorded rather than done quietly because a reader comparing the manifests against
§3.1 would otherwise reasonably think the specification had been ignored.

### Dependency justification at M0

Every dependency added at M0, with its licence, as required by CONTRIBUTING.md:

| Dependency | Version | Licence | Why |
|---|---|---|---|
| `@x402/core` | 2.21.0 (exact) | Apache-2.0 | The protocol source of truth; the only reason Movo can claim to reimplement nothing |
| `@x402/stellar` | 2.21.0 (exact) | Apache-2.0 | The Stellar `exact` scheme, signers, constants and validators |
| `@x402/express` | 2.21.0 (exact) | Apache-2.0 | The mount point for `@movoframework/server` |
| `@x402/extensions` | 2.21.0 (exact) | Apache-2.0 | Bazaar declaration and validation |
| `@x402/fetch` | 2.21.0 (exact) | Apache-2.0 | The buyer client foundation |
| `typescript` | 7.0.2 (exact) | Apache-2.0 | Compiler; pinned rather than ranged (spec §1.8 D10) |
| `@biomejs/biome` | 2.5.7 | MIT OR Apache-2.0 | Lint and format in one tool; hosts the narrow-waist rule |
| `vitest` | 4.1.10 | MIT | Test runner; its project model maps onto the four testing layers |
| `@changesets/cli` | 2.31.1 | MIT | Release automation |
| `@types/node` | 24.10.1 | MIT | Node type definitions |

No runtime dependency was added beyond `@x402/core`. The three compliance scripts use only
Node built-ins (`node:fs`, `node:path`, `node:url`, `node:util`), which is why they can run
under Node's native TypeScript execution with no loader.

## Alternatives rejected

**A published `@movoframework/x402` façade package.** Rejected as pure cost — see above.

**Unrestricted direct `@x402/*` imports everywhere, with no waist at all.** Rejected: an
upstream breaking change would then produce compile errors in dozens of files across seven
packages with no single place to absorb them.

**A separate repository for the SCF track.** Rejected: the catalog needs the resource model
and the testing harness, and a split would duplicate CI, licence tooling and documentation
while making the shared parts harder to change.

**Merging `@movoframework/stellar` into `@movoframework/core`, since it is only diagnostics.** Rejected for now:
`@movoframework/core` must not depend on `@stellar/stellar-sdk`, and preflight does. A rename to
`@movoframework/preflight` remains open (spec OQ-3) and must be decided before v0.1.0, since renaming
after publish is a breaking change.
